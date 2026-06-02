using Microsoft.AspNetCore.Mvc;
using System.Collections.Concurrent;
using System.IO.Compression;

namespace api.Controllers;

/// <summary>
/// Serves ESA WorldCover 2021 tiles by reading COG files from AWS S3.
/// S3: https://esa-worldcover.s3.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_{lat}{lon}_Map.tif
/// </summary>
[ApiController]
[Route("api/landcover")]
public class LandCoverController : ControllerBase
{
    private const string S3 = "https://esa-worldcover.s3.amazonaws.com/v200/2021/map";

    private static readonly HttpClient _http = new()
    {
        Timeout = TimeSpan.FromSeconds(25),
        DefaultRequestHeaders = { { "User-Agent", "BREATH-API/1.0" } }
    };

    // WorldCover class value (0-255) → RGBA (opaque where class > 0)
    private static readonly (byte R, byte G, byte B, byte A)[] _cm = BuildColormap();

    // Transparent 1×1 PNG fallback
    private static readonly byte[] _empty = Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQ" +
        "AABjkB6QAAAABJRU5ErkJggg==");

    // COG header cache: S3 url → parsed IFD list (overview levels)
    private static readonly ConcurrentDictionary<string, CogMeta> _cogCache = new();

    // ── Public endpoint ─────────────────────────────────────────────────────

    [HttpGet("tile/{z}/{x}/{y}.png")]
    [ResponseCache(Duration = 86400 * 7, Location = ResponseCacheLocation.Any)]
    public async Task<IActionResult> Tile(int z, int x, int y)
    {
        try   { return File(await RenderTile(z, x, y), "image/png"); }
        catch { return File(_empty, "image/png"); }
    }

    // ── Tile rendering ───────────────────────────────────────────────────────

    private async Task<byte[]> RenderTile(int z, int x, int y)
    {
        // Geographic bounds of this XYZ map tile (EPSG:4326)
        var (w, s, e, n) = TileBounds(x, y, z);

        // 256×256 RGBA output (transparent = no data)
        var rgba = new byte[256 * 256 * 4];

        // WorldCover uses 3°×3° files; enumerate overlapping COG files
        int lonMin = (int)Math.Floor(w / 3.0) * 3;
        int lonMax = (int)Math.Floor((e - 1e-9) / 3.0) * 3;
        int latMin = (int)Math.Floor(s / 3.0) * 3;
        int latMax = (int)Math.Floor((n - 1e-9) / 3.0) * 3;

        for (int cogLat = latMin; cogLat <= latMax; cogLat += 3)
        for (int cogLon = lonMin; cogLon <= lonMax; cogLon += 3)
        {
            if (cogLat < -60 || cogLat >= 90) continue;
            var url = CogUrl(cogLon, cogLat);
            await BlitCog(url, cogLon, cogLat, w, s, e, n, z, rgba);
        }

        return WritePng(rgba, 256, 256);
    }

    private async Task BlitCog(string url,
        int cogLon, int cogLat,            // COG lower-left corner
        double tileW, double tileS, double tileE, double tileN,  // tile bounds
        int zoom, byte[] rgba)
    {
        var meta = await GetCogMeta(url);
        if (meta == null) return;

        // Pick the overview IFD whose pixel density is best for this zoom
        var ifd = PickIfd(meta, zoom);
        if (ifd == null) return;

        double cogN = cogLat + 3.0, cogE = cogLon + 3.0;
        double pxW  = (cogE - cogLon) / ifd.Width;   // degrees per source pixel
        double pxH  = (cogN - cogLat) / ifd.Height;

        // Source pixel region that overlaps the map tile
        int srcX0 = (int)Math.Floor(Math.Max(tileW - cogLon, 0) / pxW);
        int srcX1 = (int)Math.Ceiling(Math.Min(tileE - cogLon, cogE - cogLon) / pxW);
        int srcY0 = (int)Math.Floor(Math.Max(cogN - tileN, 0) / pxH);
        int srcY1 = (int)Math.Ceiling(Math.Min(cogN - tileS, cogN - cogLat) / pxH);

        srcX0 = Math.Clamp(srcX0, 0, ifd.Width  - 1);
        srcX1 = Math.Clamp(srcX1, 0, ifd.Width);
        srcY0 = Math.Clamp(srcY0, 0, ifd.Height - 1);
        srcY1 = Math.Clamp(srcY1, 0, ifd.Height);
        if (srcX1 <= srcX0 || srcY1 <= srcY0) return;

        // Fetch and decompress the needed COG tiles
        int tileColMin = srcX0 / ifd.TileW, tileColMax = (srcX1 - 1) / ifd.TileW;
        int tileRowMin = srcY0 / ifd.TileH, tileRowMax = (srcY1 - 1) / ifd.TileH;

        for (int tr = tileRowMin; tr <= tileRowMax; tr++)
        for (int tc = tileColMin; tc <= tileColMax; tc++)
        {
            int ti = tr * ifd.TilesAcross + tc;
            if (ti >= ifd.Offsets.Length) continue;
            long off = ifd.Offsets[ti]; long cnt = ifd.Counts[ti];
            if (off == 0 || cnt == 0) continue;

            byte[] raw = await FetchRange(url, off, cnt);
            byte[] pixels = Inflate(raw);
            if (pixels.Length < ifd.TileW * ifd.TileH) continue;

            // Blit source tile pixels onto the output 256×256 RGBA
            for (int sy = 0; sy < ifd.TileH; sy++)
            {
                int absY = tr * ifd.TileH + sy;
                if (absY < srcY0 || absY >= srcY1) continue;
                for (int sx = 0; sx < ifd.TileW; sx++)
                {
                    int absX = tc * ifd.TileW + sx;
                    if (absX < srcX0 || absX >= srcX1) continue;

                    byte cls = pixels[sy * ifd.TileW + sx];
                    if (cls == 0) continue;
                    var (r, g, b, a) = _cm[cls];
                    if (a == 0) continue;

                    // Map source pixel to output pixel
                    double lon = cogLon + (absX + 0.5) * pxW;
                    double lat = cogN  - (absY + 0.5) * pxH;
                    int ox = (int)((lon - tileW) / (tileE - tileW) * 256);
                    int oy = (int)((tileN - lat)  / (tileN - tileS) * 256);
                    if (ox < 0 || ox >= 256 || oy < 0 || oy >= 256) continue;
                    int idx = (oy * 256 + ox) * 4;
                    rgba[idx] = r; rgba[idx+1] = g; rgba[idx+2] = b; rgba[idx+3] = a;
                }
            }
        }
    }

    // ── COG metadata reader ──────────────────────────────────────────────────

    private async Task<CogMeta?> GetCogMeta(string url)
    {
        if (_cogCache.TryGetValue(url, out var cached)) return cached;

        // Fetch the first 64 KB — enough for all IFD metadata in a WorldCover COG
        byte[] hdr;
        try { hdr = await FetchRange(url, 0, 65536); }
        catch { return null; }

        if (hdr.Length < 8) return null;
        bool le = hdr[0] == 'I';
        if (ReadU16(hdr, 2, le) != 42) return null;  // classic TIFF only

        var meta = new CogMeta();
        var toVisit = new Queue<long>();
        toVisit.Enqueue(ReadU32(hdr, 4, le));

        while (toVisit.Count > 0)
        {
            long ifdOff = toVisit.Dequeue();
            if (ifdOff == 0 || ifdOff + 2 > hdr.Length) continue;
            var ifd = ParseIfd(hdr, ifdOff, le, toVisit);
            if (ifd != null) meta.Ifds.Add(ifd);
        }

        // Sort by descending width: index 0 = full res, last = lowest res
        meta.Ifds.Sort((a, b) => b.Width.CompareTo(a.Width));
        _cogCache[url] = meta;
        return meta;
    }

    private static IfdInfo? ParseIfd(byte[] buf, long off, bool le, Queue<long> toVisit)
    {
        if (off + 2 > buf.Length) return null;
        int count = ReadU16(buf, off, le);
        var ifd = new IfdInfo();

        for (int i = 0; i < count; i++)
        {
            long eOff = off + 2 + i * 12L;
            if (eOff + 12 > buf.Length) break;
            int  tag    = ReadU16(buf, eOff,     le);
            int  type   = ReadU16(buf, eOff + 2, le);
            long n      = ReadU32(buf, eOff + 4, le);
            long valOff = eOff + 8;

            switch (tag)
            {
                case 256: ifd.Width    = (int)ReadVal(buf, valOff, type, le); break;
                case 257: ifd.Height   = (int)ReadVal(buf, valOff, type, le); break;
                case 322: ifd.TileW    = (int)ReadVal(buf, valOff, type, le); break;
                case 323: ifd.TileH    = (int)ReadVal(buf, valOff, type, le); break;
                case 324: // TileOffsets
                    ifd.Offsets = ReadLongArray(buf, valOff, (int)n, type, le);
                    break;
                case 325: // TileByteCounts
                    ifd.Counts = ReadLongArray(buf, valOff, (int)n, type, le);
                    break;
                case 330: // SubIFDs (overview pointers)
                    var subOffsets = ReadLongArray(buf, valOff, (int)n, type, le);
                    if (subOffsets != null)
                        foreach (var s in subOffsets) toVisit.Enqueue(s);
                    break;
            }
        }

        // Follow next-IFD pointer
        long nextOff = off + 2 + count * 12L;
        if (nextOff + 4 <= buf.Length)
        {
            long next = ReadU32(buf, nextOff, le);
            if (next > 0) toVisit.Enqueue(next);
        }

        if (ifd.Width <= 0 || ifd.TileW <= 0 || ifd.Offsets == null || ifd.Counts == null)
            return null;

        ifd.TilesAcross = (ifd.Width  + ifd.TileW - 1) / ifd.TileW;
        ifd.TilesDown   = (ifd.Height + ifd.TileH - 1) / ifd.TileH;
        return ifd;
    }

    private static IfdInfo? PickIfd(CogMeta meta, int zoom)
    {
        if (meta.Ifds.Count == 0) return null;
        // At zoom Z a tile spans 360/2^Z degrees.
        // We want ~256 source pixels per tile width.
        // Source pixels per degree for a given IFD: ifd.Width / 3.0 (WorldCover = 3° wide).
        // Target: ifd.Width/3 * (360/2^Z) / 256 ≈ 1  → ifd.Width ≈ 256*3*2^Z/360
        double target = 256.0 * 3.0 * Math.Pow(2, zoom) / 360.0;
        // Pick smallest IFD whose width is >= target (nearest above)
        IfdInfo? best = meta.Ifds[^1]; // lowest res
        foreach (var ifd in meta.Ifds)
            if (ifd.Width >= target) best = ifd;
        return best;
    }

    // ── TIFF binary helpers ───────────────────────────────────────────────────

    private static int ReadU16(byte[] b, long off, bool le)
    {
        int o = (int)off;
        return le ? b[o] | (b[o+1] << 8) : (b[o] << 8) | b[o+1];
    }
    private static long ReadU32(byte[] b, long off, bool le)
    {
        int o = (int)off;
        if (le) return b[o] | (b[o+1]<<8) | (b[o+2]<<16) | ((long)b[o+3]<<24);
        return ((long)b[o]<<24) | ((long)b[o+1]<<16) | ((long)b[o+2]<<8) | b[o+3];
    }
    private static long ReadVal(byte[] b, long off, int type, bool le) => type switch
    {
        3 => ReadU16(b, off, le),
        _ => ReadU32(b, off, le),
    };

    private static long[]? ReadLongArray(byte[] buf, long valOff, int n, int type, bool le)
    {
        int typeSize = type == 3 ? 2 : 4;
        long dataOff;
        if (n * typeSize <= 4) dataOff = valOff;
        else dataOff = ReadU32(buf, valOff, le);

        if (dataOff < 0 || dataOff + (long)n * typeSize > buf.Length) return null;
        var arr = new long[n];
        for (int i = 0; i < n; i++)
            arr[i] = ReadVal(buf, dataOff + i * typeSize, type, le);
        return arr;
    }

    // ── HTTP helpers ──────────────────────────────────────────────────────────

    private static async Task<byte[]> FetchRange(string url, long start, long length)
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        req.Headers.Range = new System.Net.Http.Headers.RangeHeaderValue(start, start + length - 1);
        using var resp = await _http.SendAsync(req);
        resp.EnsureSuccessStatusCode();
        return await resp.Content.ReadAsByteArrayAsync();
    }

    private static byte[] Inflate(byte[] data)
    {
        using var ms = new MemoryStream(data);
        using var zlib = new ZLibStream(ms, CompressionMode.Decompress);
        using var out_ = new MemoryStream();
        zlib.CopyTo(out_);
        return out_.ToArray();
    }

    // ── Geometry helpers ──────────────────────────────────────────────────────

    private static (double W, double S, double E, double N) TileBounds(int x, int y, int z)
    {
        double n = Math.Pow(2, z);
        double w = x / n * 360.0 - 180.0;
        double e = (x + 1) / n * 360.0 - 180.0;
        double latN = Math.Atan(Math.Sinh(Math.PI * (1 - 2.0 * y / n))) * 180 / Math.PI;
        double latS = Math.Atan(Math.Sinh(Math.PI * (1 - 2.0 * (y + 1) / n))) * 180 / Math.PI;
        return (w, latS, e, latN);
    }

    private static string CogUrl(int lon, int lat)
    {
        string latStr = lat >= 0 ? $"N{lat:D2}" : $"S{-lat:D2}";
        string lonStr = lon >= 0 ? $"E{lon:D3}" : $"W{-lon:D3}";
        return $"{S3}/ESA_WorldCover_10m_2021_v200_{latStr}{lonStr}_Map.tif";
    }

    // ── Colormap ──────────────────────────────────────────────────────────────

    private static (byte R, byte G, byte B, byte A)[] BuildColormap()
    {
        var cm = new (byte R, byte G, byte B, byte A)[256];
        void C(int cls, byte r, byte g, byte b)
            { if (cls < 256) cm[cls] = (r, g, b, 210); }
        C(10,  0,   100,   0);   // Tree cover     — dark green
        C(20,  255, 187,  34);   // Shrubland       — amber
        C(30,  255, 255,  76);   // Grassland       — yellow
        C(40,  240, 150, 255);   // Cropland        — lilac
        C(50,  250,   0,   0);   // Built-up        — red
        C(60,  180, 180, 180);   // Bare/sparse     — grey
        C(70,  240, 240, 240);   // Snow/ice        — light grey
        C(80,    0, 100, 200);   // Water           — blue
        C(90,    0, 150, 160);   // Wetland         — teal
        C(95,    0, 207, 117);   // Mangroves       — bright green
        C(100, 250, 230, 160);   // Moss/lichen     — tan
        return cm;
    }

    // ── Minimal PNG encoder ───────────────────────────────────────────────────

    private static byte[] WritePng(byte[] rgba, int w, int h)
    {
        using var ms = new MemoryStream();

        // Signature
        ms.Write(new byte[] { 137,80,78,71,13,10,26,10 });

        // IHDR
        WriteChunk(ms, "IHDR", Concat(
            U32Be(w), U32Be(h),
            new byte[] { 8, 6, 0, 0, 0 }  // 8-bit RGBA, deflate, no filter, no interlace
        ));

        // IDAT: filter-0 rows, then zlib-compress
        var raw = new byte[h * (1 + w * 4)];
        for (int y = 0; y < h; y++)
        {
            raw[y * (1 + w * 4)] = 0; // filter type None
            Buffer.BlockCopy(rgba, y * w * 4, raw, y * (1 + w * 4) + 1, w * 4);
        }
        using var compr = new MemoryStream();
        using (var zl = new ZLibStream(compr, CompressionLevel.Fastest, leaveOpen: true))
            zl.Write(raw);
        WriteChunk(ms, "IDAT", compr.ToArray());

        // IEND
        WriteChunk(ms, "IEND", Array.Empty<byte>());

        return ms.ToArray();
    }

    private static void WriteChunk(Stream s, string type, byte[] data)
    {
        s.Write(U32Be(data.Length));
        byte[] typeB = System.Text.Encoding.ASCII.GetBytes(type);
        s.Write(typeB);
        s.Write(data);
        s.Write(U32Be((int)Crc32(Concat(typeB, data))));
    }

    private static uint Crc32(byte[] data)
    {
        uint c = 0xFFFFFFFF;
        foreach (byte b in data) { c ^= b; for (int k = 0; k < 8; k++) c = (c >> 1) ^ (0xEDB88320 & (uint)-(int)(c & 1)); }
        return ~c;
    }

    private static byte[] U32Be(int v)
        => new[] { (byte)(v>>24), (byte)(v>>16), (byte)(v>>8), (byte)v };

    private static byte[] Concat(params byte[][] arrs)
    {
        var r = new byte[arrs.Sum(a => a.Length)];
        int p = 0; foreach (var a in arrs) { Buffer.BlockCopy(a, 0, r, p, a.Length); p += a.Length; }
        return r;
    }

    // ── Internal types ────────────────────────────────────────────────────────

    private class CogMeta { public List<IfdInfo> Ifds { get; } = new(); }

    private class IfdInfo
    {
        public int Width, Height, TileW, TileH, TilesAcross, TilesDown;
        public long[]? Offsets, Counts;
    }
}
