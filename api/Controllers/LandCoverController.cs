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
        Timeout = TimeSpan.FromSeconds(30),
        DefaultRequestHeaders = { { "User-Agent", "BREATH-API/1.0" } }
    };

    // WorldCover class value → RGBA
    private static readonly (byte R, byte G, byte B, byte A)[] _cm = BuildColormap();

    // Transparent 256×256 PNG fallback (1×1 transparent)
    private static readonly byte[] _empty = Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQ" +
        "AABjkB6QAAAABJRU5ErkJggg==");

    // COG header cache: S3 url → parsed IFD list
    private static readonly ConcurrentDictionary<string, CogMeta?> _cogCache = new();

    // Disk tile cache directory (set once at first request)
    private static string? _cacheDir;
    private static string CacheDir
    {
        get
        {
            if (_cacheDir != null) return _cacheDir;
            // Prefer /tmp (Render ephemeral FS) over wwwroot to avoid git conflicts
            var dir = Path.Combine(Path.GetTempPath(), "lc-tiles");
            Directory.CreateDirectory(dir);
            return _cacheDir = dir;
        }
    }

    // Deduplicate concurrent renders for the same tile
    private static readonly ConcurrentDictionary<string, Task<byte[]>> _inflight = new();

    // ── Public endpoints ─────────────────────────────────────────────────────

    [HttpGet("tile/{z}/{x}/{y}.png")]
    public async Task<IActionResult> Tile(int z, int x, int y)
    {
        // Only cache zoom levels that are worth keeping (overview levels)
        string key  = $"{z}/{x}/{y}";
        string path = Path.Combine(CacheDir, z.ToString(), x.ToString(), $"{y}.png");

        // Serve from disk cache if available
        if (System.IO.File.Exists(path))
        {
            Response.Headers["Cache-Control"] = "public, max-age=604800";
            return File(System.IO.File.ReadAllBytes(path), "image/png");
        }

        // Deduplicate concurrent requests for the same tile
        var task = _inflight.GetOrAdd(key, _ => RenderAndCache(path, z, x, y));
        byte[] png;
        try   { png = await task; }
        catch { png = _empty; }
        finally { _inflight.TryRemove(key, out _); }

        Response.Headers["Cache-Control"] = "public, max-age=604800";
        return File(png, "image/png");
    }

    private async Task<byte[]> RenderAndCache(string path, int z, int x, int y)
    {
        byte[] png;
        try   { png = await RenderTile(z, x, y); }
        catch { return _empty; }

        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            await System.IO.File.WriteAllBytesAsync(path, png);
        }
        catch { /* cache write failure is non-fatal */ }
        return png;
    }

    /// <summary>
    /// Diagnostic endpoint: GET /api/landcover/debug?lat=48&amp;lon=9
    /// Returns JSON with S3 reachability, BigTIFF detection, IFD list.
    /// </summary>
    [HttpGet("debug")]
    public async Task<IActionResult> Debug([FromQuery] int lat = 48, [FromQuery] int lon = 9)
    {
        int cogLat = (int)Math.Floor(lat / 3.0) * 3;
        int cogLon = (int)Math.Floor(lon / 3.0) * 3;
        string url = CogUrl(cogLon, cogLat);

        var result = new System.Text.StringBuilder();
        result.AppendLine($"url: {url}");

        byte[]? hdr = null;
        try
        {
            hdr = await FetchRange(url, 0, 524288);
            result.AppendLine($"fetch_ok: true, bytes: {hdr.Length}");
        }
        catch (Exception ex)
        {
            result.AppendLine($"fetch_ok: false, error: {ex.Message}");
            return Content(result.ToString(), "text/plain");
        }

        if (hdr.Length < 8) { result.AppendLine("too_short"); return Content(result.ToString(), "text/plain"); }

        bool le    = hdr[0] == 'I';
        int  magic = (le ? hdr[2] | (hdr[3]<<8) : (hdr[2]<<8)|hdr[3]);
        result.AppendLine($"byte_order: {(le?"little":"big")}-endian");
        result.AppendLine($"magic: {magic} ({(magic==42?"ClassicTIFF":magic==43?"BigTIFF":"UNKNOWN")})");

        var meta = await GetCogMeta(url);
        if (meta == null)
        {
            result.AppendLine("meta: null (parse failed)");
        }
        else
        {
            result.AppendLine($"bigtiff: {meta.BigTiff}");
            result.AppendLine($"ifd_count: {meta.Ifds.Count}");
            foreach (var ifd in meta.Ifds)
                result.AppendLine($"  ifd {ifd.Width}x{ifd.Height} tile={ifd.TileW}x{ifd.TileH} ntiles={ifd.Offsets?.Length}");
        }

        return Content(result.ToString(), "text/plain");
    }

    // ── Tile rendering ───────────────────────────────────────────────────────

    private async Task<byte[]> RenderTile(int z, int x, int y)
    {
        var (w, s, e, n) = TileBounds(x, y, z);

        var rgba = new byte[256 * 256 * 4];

        // WorldCover files are 3°×3°; enumerate overlapping COG files
        int lonMin = (int)Math.Floor(w / 3.0) * 3;
        int lonMax = (int)Math.Floor((e - 1e-9) / 3.0) * 3;
        int latMin = (int)Math.Floor(s / 3.0) * 3;
        int latMax = (int)Math.Floor((n - 1e-9) / 3.0) * 3;

        var tasks = new List<Task>();
        for (int cogLat = latMin; cogLat <= latMax; cogLat += 3)
        for (int cogLon = lonMin; cogLon <= lonMax; cogLon += 3)
        {
            if (cogLat < -90 || cogLat >= 90) continue;
            int cl = cogLon, ct = cogLat;
            tasks.Add(BlitCog(CogUrl(cl, ct), cl, ct, w, s, e, n, z, rgba));
        }
        await Task.WhenAll(tasks);

        return WritePng(rgba, 256, 256);
    }

    private async Task BlitCog(string url,
        int cogLon, int cogLat,
        double tileW, double tileS, double tileE, double tileN,
        int zoom, byte[] rgba)
    {
        var meta = await GetCogMeta(url);
        if (meta == null) return;

        var ifd = PickIfd(meta, zoom);
        if (ifd == null) return;

        double cogN = cogLat + 3.0, cogE = cogLon + 3.0;
        double pxW = (cogE - cogLon) / ifd.Width;
        double pxH = (cogN - cogLat) / ifd.Height;

        int srcX0 = (int)Math.Floor(Math.Max(tileW - cogLon, 0) / pxW);
        int srcX1 = (int)Math.Ceiling(Math.Min(tileE - cogLon, cogE - cogLon) / pxW);
        int srcY0 = (int)Math.Floor(Math.Max(cogN - tileN, 0) / pxH);
        int srcY1 = (int)Math.Ceiling(Math.Min(cogN - tileS, cogN - cogLat) / pxH);

        srcX0 = Math.Clamp(srcX0, 0, ifd.Width  - 1);
        srcX1 = Math.Clamp(srcX1, 0, ifd.Width);
        srcY0 = Math.Clamp(srcY0, 0, ifd.Height - 1);
        srcY1 = Math.Clamp(srcY1, 0, ifd.Height);
        if (srcX1 <= srcX0 || srcY1 <= srcY0) return;

        int tileColMin = srcX0 / ifd.TileW, tileColMax = (srcX1 - 1) / ifd.TileW;
        int tileRowMin = srcY0 / ifd.TileH, tileRowMax = (srcY1 - 1) / ifd.TileH;

        var fetchTasks = new List<Task<(int tr, int tc, byte[]? pixels)>>();
        for (int tr = tileRowMin; tr <= tileRowMax; tr++)
        for (int tc = tileColMin; tc <= tileColMax; tc++)
        {
            int ti = tr * ifd.TilesAcross + tc;
            if (ti >= ifd.Offsets.Length) continue;
            long off = ifd.Offsets[ti], cnt = ifd.Counts[ti];
            if (off == 0 || cnt == 0) continue;
            int trr = tr, tcc = tc;
            fetchTasks.Add(Task.Run(async () => {
                try {
                    byte[] raw = await FetchRange(url, off, cnt);
                    return (trr, tcc, Inflate(raw));
                } catch { return (trr, tcc, (byte[]?)null); }
            }));
        }
        var results = await Task.WhenAll(fetchTasks);

        lock (rgba)
        {
            foreach (var (tr, tc, pixels) in results)
            {
                if (pixels == null || pixels.Length < ifd.TileW * ifd.TileH) continue;
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

                        double lon = cogLon + (absX + 0.5) * pxW;
                        double lat = cogN   - (absY + 0.5) * pxH;
                        int ox = (int)((lon - tileW) / (tileE - tileW) * 256);
                        int oy = (int)((tileN - lat)  / (tileN - tileS) * 256);
                        if (ox < 0 || ox >= 256 || oy < 0 || oy >= 256) continue;
                        int idx = (oy * 256 + ox) * 4;
                        rgba[idx] = r; rgba[idx+1] = g; rgba[idx+2] = b; rgba[idx+3] = a;
                    }
                }
            }
        }
    }

    // ── COG metadata reader ──────────────────────────────────────────────────

    private async Task<CogMeta?> GetCogMeta(string url)
    {
        if (_cogCache.TryGetValue(url, out var cached)) return cached;

        // Fetch 512 KB — enough for all IFD metadata + tile offset arrays
        byte[] hdr;
        try { hdr = await FetchRange(url, 0, 524288); }
        catch { _cogCache[url] = null; return null; }

        if (hdr.Length < 16) { _cogCache[url] = null; return null; }

        bool le = hdr[0] == 'I';
        int magic = ReadU16(hdr, 2, le);
        bool bigTiff = magic == 43;
        if (magic != 42 && magic != 43) { _cogCache[url] = null; return null; }

        long firstIfdOff = bigTiff
            ? (long)ReadU64(hdr, 8, le)
            : (long)ReadU32(hdr, 4, le);

        var meta = new CogMeta { BigTiff = bigTiff };
        var toVisit = new Queue<long>();
        toVisit.Enqueue(firstIfdOff);

        int maxIter = 40;
        while (toVisit.Count > 0 && maxIter-- > 0)
        {
            long ifdOff = toVisit.Dequeue();
            if (ifdOff <= 0 || ifdOff + 2 > hdr.Length) continue;
            var ifd = ParseIfd(hdr, ifdOff, le, bigTiff, toVisit);
            if (ifd != null) meta.Ifds.Add(ifd);
        }

        if (meta.Ifds.Count == 0) { _cogCache[url] = null; return null; }

        // Sort descending by width: [0] = full res, [^1] = lowest res overview
        meta.Ifds.Sort((a, b) => b.Width.CompareTo(a.Width));
        _cogCache[url] = meta;
        return meta;
    }

    private static IfdInfo? ParseIfd(byte[] buf, long off, bool le, bool bigTiff, Queue<long> toVisit)
    {
        var ifd = new IfdInfo();
        long afterEntries;

        if (bigTiff)
        {
            if (off + 8 > buf.Length) return null;
            long count = (long)ReadU64(buf, off, le);
            if (count < 0 || count > 1000) return null;

            for (long i = 0; i < count; i++)
            {
                long eOff = off + 8 + i * 20L;
                if (eOff + 20 > buf.Length) break;
                int  tag  = ReadU16(buf, eOff,     le);
                int  type = ReadU16(buf, eOff + 2, le);
                long n    = (long)ReadU64(buf, eOff + 4, le);
                long vOff = eOff + 12;

                switch (tag)
                {
                    case 256: ifd.Width  = (int)ReadValBig(buf, vOff, type, le); break;
                    case 257: ifd.Height = (int)ReadValBig(buf, vOff, type, le); break;
                    case 322: ifd.TileW  = (int)ReadValBig(buf, vOff, type, le); break;
                    case 323: ifd.TileH  = (int)ReadValBig(buf, vOff, type, le); break;
                    case 324: ifd.Offsets = ReadLongArrayBig(buf, vOff, (int)n, type, le); break;
                    case 325: ifd.Counts  = ReadLongArrayBig(buf, vOff, (int)n, type, le); break;
                    case 330:
                        var subs = ReadLongArrayBig(buf, vOff, (int)n, type, le);
                        if (subs != null) foreach (var s in subs) toVisit.Enqueue(s);
                        break;
                }
            }
            afterEntries = off + 8 + count * 20L;
            if (afterEntries + 8 <= buf.Length)
            {
                long next = (long)ReadU64(buf, afterEntries, le);
                if (next > 0) toVisit.Enqueue(next);
            }
        }
        else
        {
            if (off + 2 > buf.Length) return null;
            int count = ReadU16(buf, off, le);

            for (int i = 0; i < count; i++)
            {
                long eOff = off + 2 + i * 12L;
                if (eOff + 12 > buf.Length) break;
                int  tag  = ReadU16(buf, eOff,     le);
                int  type = ReadU16(buf, eOff + 2, le);
                long n    = (long)ReadU32(buf, eOff + 4, le);
                long vOff = eOff + 8;

                switch (tag)
                {
                    case 256: ifd.Width  = (int)ReadVal(buf, vOff, type, le); break;
                    case 257: ifd.Height = (int)ReadVal(buf, vOff, type, le); break;
                    case 322: ifd.TileW  = (int)ReadVal(buf, vOff, type, le); break;
                    case 323: ifd.TileH  = (int)ReadVal(buf, vOff, type, le); break;
                    case 324: ifd.Offsets = ReadLongArray(buf, vOff, (int)n, type, le); break;
                    case 325: ifd.Counts  = ReadLongArray(buf, vOff, (int)n, type, le); break;
                    case 330:
                        var subs = ReadLongArray(buf, vOff, (int)n, type, le);
                        if (subs != null) foreach (var s in subs) toVisit.Enqueue(s);
                        break;
                }
            }
            afterEntries = off + 2 + count * 12L;
            if (afterEntries + 4 <= buf.Length)
            {
                long next = (long)ReadU32(buf, afterEntries, le);
                if (next > 0) toVisit.Enqueue(next);
            }
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
        double target = 256.0 * 3.0 * Math.Pow(2, zoom) / 360.0;
        IfdInfo best = meta.Ifds[^1];
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
        return le
            ? b[o] | (b[o+1]<<8) | (b[o+2]<<16) | ((long)b[o+3]<<24)
            : ((long)b[o]<<24) | ((long)b[o+1]<<16) | ((long)b[o+2]<<8) | b[o+3];
    }
    private static ulong ReadU64(byte[] b, long off, bool le)
    {
        int o = (int)off;
        if (le)
            return b[o] | ((ulong)b[o+1]<<8) | ((ulong)b[o+2]<<16) | ((ulong)b[o+3]<<24)
                 | ((ulong)b[o+4]<<32) | ((ulong)b[o+5]<<40) | ((ulong)b[o+6]<<48) | ((ulong)b[o+7]<<56);
        return ((ulong)b[o]<<56) | ((ulong)b[o+1]<<48) | ((ulong)b[o+2]<<40) | ((ulong)b[o+3]<<32)
             | ((ulong)b[o+4]<<24) | ((ulong)b[o+5]<<16) | ((ulong)b[o+6]<<8) | b[o+7];
    }

    // Classic TIFF: type 3=SHORT(2B), 4=LONG(4B)
    private static long ReadVal(byte[] b, long off, int type, bool le) => type switch
    {
        3 => ReadU16(b, off, le),
        _ => ReadU32(b, off, le),
    };
    // BigTIFF: additionally type 16=LONG8(8B), 18=IFD8(8B)
    private static long ReadValBig(byte[] b, long off, int type, bool le) => type switch
    {
        3  => ReadU16(b, off, le),
        4  => ReadU32(b, off, le),
        16 or 18 => (long)ReadU64(b, off, le),
        _  => ReadU32(b, off, le),
    };

    private static long[]? ReadLongArray(byte[] buf, long valOff, int n, int type, bool le)
    {
        int sz = type == 3 ? 2 : 4;
        long dataOff = n * sz <= 4 ? valOff : ReadU32(buf, valOff, le);
        if (dataOff < 0 || dataOff + (long)n * sz > buf.Length) return null;
        var arr = new long[n];
        for (int i = 0; i < n; i++)
            arr[i] = ReadVal(buf, dataOff + i * sz, type, le);
        return arr;
    }

    private static long[]? ReadLongArrayBig(byte[] buf, long valOff, int n, int type, bool le)
    {
        int sz = type switch { 3 => 2, 4 => 4, _ => 8 }; // SHORT=2, LONG=4, LONG8/IFD8=8
        long dataOff = (long)(n * sz <= 8 ? valOff : (long)ReadU64(buf, valOff, le));
        if (dataOff < 0 || dataOff + (long)n * sz > buf.Length) return null;
        var arr = new long[n];
        for (int i = 0; i < n; i++)
            arr[i] = ReadValBig(buf, dataOff + i * sz, type, le);
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
        using var ms   = new MemoryStream(data);
        using var zlib = new ZLibStream(ms, CompressionMode.Decompress);
        using var out_ = new MemoryStream();
        zlib.CopyTo(out_);
        return out_.ToArray();
    }

    // ── Geometry helpers ──────────────────────────────────────────────────────

    private static (double W, double S, double E, double N) TileBounds(int x, int y, int z)
    {
        double n  = Math.Pow(2, z);
        double w  = x / n * 360.0 - 180.0;
        double e  = (x + 1) / n * 360.0 - 180.0;
        double latN = Math.Atan(Math.Sinh(Math.PI * (1 - 2.0 * y       / n))) * 180 / Math.PI;
        double latS = Math.Atan(Math.Sinh(Math.PI * (1 - 2.0 * (y + 1) / n))) * 180 / Math.PI;
        return (w, latS, e, latN);
    }

    private static string CogUrl(int lon, int lat)
    {
        // WorldCover filenames use the SOUTH-WEST corner of each 3°×3° tile
        string latStr = lat >= 0 ? $"N{lat:D2}" : $"S{-lat:D2}";
        string lonStr = lon >= 0 ? $"E{lon:D3}" : $"W{-lon:D3}";
        return $"{S3}/ESA_WorldCover_10m_2021_v200_{latStr}{lonStr}_Map.tif";
    }

    // ── Colormap ──────────────────────────────────────────────────────────────

    private static (byte R, byte G, byte B, byte A)[] BuildColormap()
    {
        var cm = new (byte R, byte G, byte B, byte A)[256];
        void C(int cls, byte r, byte g, byte b) { if (cls < 256) cm[cls] = (r, g, b, 210); }
        C(10,   0, 100,   0);  // Tree cover    — dark green
        C(20, 255, 187,  34);  // Shrubland     — amber
        C(30, 255, 255,  76);  // Grassland     — yellow
        C(40, 240, 150, 255);  // Cropland      — lilac
        C(50, 250,   0,   0);  // Built-up      — red
        C(60, 180, 180, 180);  // Bare/sparse   — grey
        C(70, 240, 240, 240);  // Snow/ice      — light grey
        C(80,   0, 100, 200);  // Water         — blue
        C(90,   0, 150, 160);  // Wetland       — teal
        C(95,   0, 207, 117);  // Mangroves     — bright green
        C(100,250, 230, 160);  // Moss/lichen   — tan
        return cm;
    }

    // ── Minimal PNG encoder ───────────────────────────────────────────────────

    private static byte[] WritePng(byte[] rgba, int w, int h)
    {
        using var ms = new MemoryStream();
        ms.Write(new byte[] { 137,80,78,71,13,10,26,10 });
        WriteChunk(ms, "IHDR", Concat(U32Be(w), U32Be(h), new byte[] { 8,6,0,0,0 }));

        var raw = new byte[h * (1 + w * 4)];
        for (int y = 0; y < h; y++)
        {
            raw[y * (1 + w * 4)] = 0;
            Buffer.BlockCopy(rgba, y * w * 4, raw, y * (1 + w * 4) + 1, w * 4);
        }
        using var compr = new MemoryStream();
        using (var zl = new ZLibStream(compr, CompressionLevel.Fastest, leaveOpen: true))
            zl.Write(raw);
        WriteChunk(ms, "IDAT", compr.ToArray());
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
        foreach (byte b in data) { c ^= b; for (int k = 0; k < 8; k++) c = (c>>1) ^ (0xEDB88320u & (uint)-(int)(c&1)); }
        return ~c;
    }

    private static byte[] U32Be(int v) => new[] { (byte)(v>>24),(byte)(v>>16),(byte)(v>>8),(byte)v };

    private static byte[] Concat(params byte[][] arrs)
    {
        var r = new byte[arrs.Sum(a => a.Length)];
        int p = 0; foreach (var a in arrs) { Buffer.BlockCopy(a, 0, r, p, a.Length); p += a.Length; }
        return r;
    }

    // ── Internal types ────────────────────────────────────────────────────────

    private class CogMeta { public bool BigTiff; public List<IfdInfo> Ifds { get; } = new(); }

    private class IfdInfo
    {
        public int   Width, Height, TileW, TileH, TilesAcross, TilesDown;
        public long[]? Offsets, Counts;
    }
}
