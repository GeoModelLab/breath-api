using System.Collections.Concurrent;
using System.Globalization;
using System.IO.Compression;
using System.Net;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace runner
{
    /// <summary>
    /// Downloads MODIS EVI 16-day composites from the ORNL DAAC REST API
    /// (https://modis.ornl.gov/rst/), caches raw responses as gzip files,
    /// and produces 8-day maximum-value composites in the [0, 1] range.
    ///
    /// Both Terra (MOD13Q1) and Aqua (MYD13Q1) tiles are requested in parallel
    /// and then merged to maximise temporal coverage.
    /// </summary>
    public static class ModisEviPoint
    {
        // ── HTTP client ───────────────────────────────────────────────────────────
        private static readonly SocketsHttpHandler handler = new()
        {
            AutomaticDecompression     = DecompressionMethods.All,
            AllowAutoRedirect          = true,
            PooledConnectionLifetime   = TimeSpan.FromMinutes(10),
            PooledConnectionIdleTimeout = TimeSpan.FromMinutes(5),
            MaxConnectionsPerServer    = 128,
            EnableMultipleHttp2Connections = true
        };

        private static readonly HttpClient http = new(handler)
        {
            DefaultRequestVersion = HttpVersion.Version20,
            Timeout = TimeSpan.FromSeconds(45)
        };

        /// <summary>Absolute path to the directory used for on-disk EVI caches.</summary>
        public static string CacheDirectory { get; set; } =
            Path.Combine(Path.GetTempPath(), "breath_modis_cache");

        /// <summary>In-memory LRU-style cache to avoid re-parsing the same chunk twice.</summary>
        private static readonly ConcurrentDictionary<string, List<(DateTime, float)>> memCache = new();

        private static readonly JsonSerializerOptions jsonOptsFast = new()
        {
            AllowTrailingCommas          = true,
            PropertyNameCaseInsensitive  = true,
            NumberHandling               = JsonNumberHandling.AllowReadingFromString
        };

        static ModisEviPoint()
        {
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            http.DefaultRequestHeaders.UserAgent.ParseAdd(
                "Mozilla/5.0 (compatible; MODISFetcher/Fast; +https://modis.ornl.gov)");
            http.DefaultRequestHeaders.Accept.ParseAdd("application/json, text/plain, */*");
        }

        // ── Public API ────────────────────────────────────────────────────────────
        /// <summary>
        /// Returns a dictionary of EVI values keyed by the start date of each
        /// 8-day composite window, scaled to [0, 1].
        /// </summary>
        /// <param name="lat">Latitude in decimal degrees.</param>
        /// <param name="lon">Longitude in decimal degrees.</param>
        /// <param name="startYear">First year of the requested period.</param>
        /// <param name="endYear">Last year of the requested period.</param>
        /// <param name="progress">Optional callback receiving fraction [0, 1] completed.</param>
        public static async Task<Dictionary<DateTime, float>> GetEviMultiYearAsync(
            double lat, double lon, int startYear, int endYear,
            Action<float>? progress = null)
        {
            string latStr = lat.ToString("F5", CultureInfo.InvariantCulture);
            string lonStr = lon.ToString("F5", CultureInfo.InvariantCulture);
            const string band  = "250m_16_days_EVI";
            const int    CHUNK = 160; // days per API request (keeps payloads manageable)

            Directory.CreateDirectory(CacheDirectory);

            // Build list of chunk jobs not yet cached on disk
            var jobs = new List<(string product, int year, int start, int end)>();
            for (int year = startYear; year <= endYear; year++)
            {
                int days = DateTime.IsLeapYear(year) ? 366 : 365;
                for (int d = 1; d <= days; d += CHUNK)
                {
                    int end = Math.Min(d + CHUNK - 1, days);
                    foreach (var prod in new[] { "MOD13Q1", "MYD13Q1" })
                    {
                        string cacheFile = Path.Combine(CacheDirectory,
                            $"{prod}_{year}_{latStr}_{lonStr}_{d}_{end}.gz");
                        if (!File.Exists(cacheFile))
                            jobs.Add((prod, year, d, end));
                    }
                }
            }

            var results   = new ConcurrentBag<(DateTime, float)>();
            // Limit concurrency to avoid hammering the ORNL server
            var sem       = new SemaphoreSlim(Math.Min(16, Environment.ProcessorCount * 2));
            int totalJobs = jobs.Count == 0 ? 1 : jobs.Count;
            int completed = 0;

            var fetchTasks = jobs.Select(async job =>
            {
                await sem.WaitAsync();
                try
                {
                    var chunk = await FetchChunkAsync(latStr, lonStr, band,
                        job.product, job.year, job.start, job.end);
                    foreach (var x in chunk)
                        results.Add(x);
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"⚠️ Fetch error {job.product} {job.year} " +
                                      $"{job.start}-{job.end}: {ex.Message}");
                }
                finally
                {
                    int done  = Interlocked.Increment(ref completed);
                    float ratio = MathF.Min(1f, (float)done / totalJobs);
                    progress?.Invoke(ratio);
                    sem.Release();
                }
            });

            try   { await Task.WhenAll(fetchTasks); }
            catch (Exception ex) { Console.WriteLine($"❌ Parallel fetch error: {ex.Message}"); }

            // Merge cached chunks that were already on disk before this call
            try
            {
                var cachedFiles  = Directory.EnumerateFiles(CacheDirectory,
                    $"*_{latStr}_{lonStr}_*.gz");
                var cachedTasks  = cachedFiles.Select(ReadCacheAsync);
                var cachedChunks = await Task.WhenAll(cachedTasks);
                foreach (var chunk in cachedChunks)
                    foreach (var val in chunk)
                        results.Add(val);
            }
            catch (Exception ex) { Console.WriteLine($"⚠️ Cache read error: {ex.Message}"); }

            progress?.Invoke(1f);

            if (results.IsEmpty)
                return new();

            // ── Build 8-day maximum-value composite ───────────────────────────────
            var ordered = results.ToList();
            ordered.Sort((a, b) => a.Item1.CompareTo(b.Item1));

            var composite   = new Dictionary<DateTime, float>(ordered.Count / 8);
            DateTime winStart = ordered[0].Item1;
            int i = 0;
            while (i < ordered.Count)
            {
                DateTime winEnd = winStart.AddDays(8);
                float max = float.MinValue;
                while (i < ordered.Count && ordered[i].Item1 < winEnd)
                {
                    if (ordered[i].Item2 > max) max = ordered[i].Item2;
                    i++;
                }
                if (max > float.MinValue)
                    composite[winStart] = max;
                winStart = winEnd;
            }

            return composite;
        }

        // ── Private helpers ───────────────────────────────────────────────────────
        private static async Task<List<(DateTime, float)>> FetchChunkAsync(
            string lat, string lon, string band,
            string product, int year, int start, int end)
        {
            string key       = $"{product}_{year}_{lat}_{lon}_{start}_{end}";
            string cacheFile = Path.Combine(CacheDirectory, $"{key}.gz");

            if (memCache.TryGetValue(key, out var cached))
                return cached;

            if (File.Exists(cacheFile))
            {
                var data = await ReadCacheAsync(cacheFile);
                memCache[key] = data;
                return data;
            }

            // Julian day-of-year → MODIS date string (e.g. A2020001)
            string startStr = $"A{year}{start:D3}";
            string endStr   = $"A{year}{end:D3}";
            string url =
                $"https://modis.ornl.gov/rst/api/v1/{product}/subset?" +
                $"latitude={lat}&longitude={lon}&band={band}" +
                $"&startDate={startStr}&endDate={endStr}" +
                $"&kmAboveBelow=0&kmLeftRight=0&subset=point";

            try
            {
                using var response = await http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead);
                if (!response.IsSuccessStatusCode)
                    return new();

                // Write directly to compressed cache without intermediate buffering
                await using var netStream = await response.Content.ReadAsStreamAsync();
                await using var fs        = File.Create(cacheFile);
                await using (var gz       = new GZipStream(fs, CompressionLevel.Fastest))
                    await netStream.CopyToAsync(gz);

                var parsed = await ReadCacheAsync(cacheFile);
                memCache[key] = parsed;
                return parsed;
            }
            catch { return new(); }
        }

        private static async Task<List<(DateTime, float)>> ReadCacheAsync(string path)
        {
            try
            {
                using var fs = File.OpenRead(path);
                using var gz = new GZipStream(fs, CompressionMode.Decompress);
                return await JsonToEviAsync(gz);
            }
            catch { return new(); }
        }

        /// <summary>
        /// Parses the ORNL DAAC JSON response and returns a flat list of
        /// (date, EVI) pairs scaled from raw DN (×10 000) to [0, 1].
        /// Invalid fill values (≤ −3000) are excluded.
        /// </summary>
        private static async Task<List<(DateTime, float)>> JsonToEviAsync(Stream jsonStream)
        {
            var list = new List<(DateTime, float)>(16);
            try
            {
                var resp = await JsonSerializer.DeserializeAsync<JsonElement>(jsonStream, jsonOptsFast);
                if (!resp.TryGetProperty("subset", out var subset)) return list;

                foreach (var rec in subset.EnumerateArray())
                {
                    if (!rec.TryGetProperty("calendar_date", out var dateEl)) continue;
                    if (!DateTime.TryParse(dateEl.GetString(), out var date))  continue;
                    if (!rec.TryGetProperty("data", out var arr))              continue;

                    float sum = 0;
                    int   n   = 0;
                    foreach (var v in arr.EnumerateArray())
                    {
                        float val;
                        try { val = v.GetSingle(); } catch { continue; }
                        if (val > -3000f) { sum += val; n++; }
                    }

                    if (n > 0)
                        list.Add((date, (sum / n) / 10_000f));
                }
            }
            catch { }

            return list;
        }
    }
}
