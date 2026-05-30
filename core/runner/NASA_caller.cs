using System.Net.Http.Json;
using System.Text.Json.Serialization;
using runner.data;
using source.data;

namespace runner.data
{
    /// <summary>
    /// Downloads daily or hourly weather data from the NASA POWER API
    /// (https://power.larc.nasa.gov/) and converts it to the internal
    /// <see cref="input"/> format expected by the BREATH model.
    /// </summary>
    public static class NasaPower
    {
        private static readonly HttpClient http = new()
        {
            BaseAddress = new Uri("https://power.larc.nasa.gov/")
        };

        /// <summary>
        /// Entry point — dispatches to daily or hourly fetch depending on <paramref name="timestep"/>.
        /// </summary>
        /// <param name="lat">Latitude in decimal degrees.</param>
        /// <param name="lon">Longitude in decimal degrees.</param>
        /// <param name="startYear">First year of the requested period.</param>
        /// <param name="endYear">Last year of the requested period.</param>
        /// <param name="timestep">"hourly" for sub-daily data; anything else returns daily data.</param>
        public static async Task<Dictionary<DateTime, input>> GetWeatherAsync(
            double lat, double lon, int startYear, int endYear, string timestep)
        {
            timestep = timestep.ToLower().Trim();
            return timestep switch
            {
                "hourly" => await GetHourlyAsync(lat, lon, startYear, endYear),
                _        => await GetDailyAsync(lat, lon, startYear, endYear)
            };
        }

        // ── Daily path ────────────────────────────────────────────────────────────
        /// <summary>
        /// Fetches daily NASA POWER variables and reconstructs diurnal cycles
        /// using the physical disaggregation in <see cref="weatherReader.estimateHourly"/>.
        /// </summary>
        private static async Task<Dictionary<DateTime, input>> GetDailyAsync(
            double lat, double lon, int startYear, int endYear)
        {
            // Request from October of startYear to cover the preceding growing season
            string startDate = $"{startYear}1001";
            string endDate   = $"{endYear}1231";

            string parameters = string.Join(",", new[]
            {
                "T2M_MAX", "T2M_MIN", "PRECTOTCORR", "ALLSKY_SFC_SW_DWN"
            });

            string url = $"api/temporal/daily/point?parameters={parameters}" +
                         $"&start={startDate}&end={endDate}" +
                         $"&latitude={lat}&longitude={lon}" +
                         $"&community=AG&format=JSON";

            var json = await http.GetFromJsonAsync<NasaResponse>(url);
            var data = json?.Properties?.Parameter;
            if (data == null)
                return new Dictionary<DateTime, input>();

            var allDates    = data.Values.First().Keys;
            var results     = new Dictionary<DateTime, input>();
            var weatherReader = new weatherReader();

            foreach (var dateKey in allDates)
            {
                if (!DateTime.TryParseExact(dateKey, "yyyyMMdd", null,
                        System.Globalization.DateTimeStyles.None, out var date))
                    continue;

                // Build a daily summary used to drive the hourly disaggregation
                var inputDaily = new input
                {
                    date                  = date,
                    latitude              = (float)lat,
                    airTemperatureMaximum = GetVal(data, "T2M_MAX",           dateKey),
                    airTemperatureMinimum = GetVal(data, "T2M_MIN",           dateKey),
                    precipitation         = GetVal(data, "PRECTOTCORR",       dateKey),
                    solarRadiation        = GetVal(data, "ALLSKY_SFC_SW_DWN", dateKey),
                    // PAR ≈ 50.5 % of incoming shortwave (Meek et al. 1984)
                    PAR                   = GetVal(data, "ALLSKY_SFC_SW_DWN", dateKey) * 0.505f
                };

                // Disaggregate to 24-hour profiles using physical relationships
                results[date] = weatherReader.estimateHourly(inputDaily);
            }

            return results;
        }

        // ── Hourly path ───────────────────────────────────────────────────────────
        /// <summary>
        /// Fetches hourly NASA POWER variables year-by-year (API limit) and
        /// packs them into the <see cref="input"/> structure with both hourly arrays
        /// and aggregated daily scalars.
        /// </summary>
        private static async Task<Dictionary<DateTime, input>>
            GetHourlyAsync(double lat, double lon, int startYear, int endYear)
        {
            var results = new Dictionary<DateTime, input>();

            for (int year = startYear; year <= endYear; year++)
            {
                string startDate = $"{year}0101";
                string endDate   = $"{year}1231";

                string parameters = string.Join(",", new[]
                {
                    "T2M", "RH2M", "PRECTOTCORR", "ALLSKY_SFC_SW_DWN"
                });

                string url = $"api/temporal/hourly/point?parameters={parameters}" +
                             $"&start={startDate}&end={endDate}" +
                             $"&latitude={lat}&longitude={lon}" +
                             $"&community=RE&format=JSON";

                var json = await http.GetFromJsonAsync<NasaResponse>(url);
                var data = json?.Properties?.Parameter;
                if (data == null) continue;

                // Group hourly timestamps (yyyyMMddHH) by calendar day (yyyyMMdd)
                var allTimestamps = data.Values.First().Keys;
                var dailyGroups   = allTimestamps.GroupBy(ts => ts[..8]);

                foreach (var dayGroup in dailyGroups)
                {
                    if (!DateTime.TryParseExact(dayGroup.Key, "yyyyMMdd",
                        null, System.Globalization.DateTimeStyles.None, out var date))
                        continue;

                    var inp = new input { date = date, latitude = (float)lat };

                    int i = 0;
                    var tVals    = new List<float>();
                    var rhVals   = new List<float>();
                    var radVals  = new List<float>();
                    var precVals = new List<float>();

                    foreach (var timestamp in dayGroup.OrderBy(x => x))
                    {
                        if (i >= 24) break;

                        inp.airTemperatureH[i]   = GetVal(data, "T2M",               timestamp);
                        inp.relativeHumidityH[i] = GetVal(data, "RH2M",              timestamp);
                        inp.precipitationH[i]    = GetVal(data, "PRECTOTCORR",       timestamp);
                        inp.solarRadiationH[i]   = GetVal(data, "ALLSKY_SFC_SW_DWN", timestamp);

                        tVals.Add(inp.airTemperatureH[i]);
                        rhVals.Add(inp.relativeHumidityH[i]);
                        radVals.Add(inp.solarRadiationH[i]);
                        precVals.Add(inp.precipitationH[i]);

                        i++;
                    }

                    // Aggregate daily scalars from the hourly arrays
                    inp.airTemperatureMaximum = tVals.Count > 0 ? tVals.Max() : float.NaN;
                    inp.airTemperatureMinimum = tVals.Count > 0 ? tVals.Min() : float.NaN;
                    inp.solarRadiation        = radVals.Sum();
                    inp.PAR                   = inp.solarRadiation * 0.45f;
                    inp.precipitation         = precVals.Sum();

                    // Compute VPD and ET₀ for each filled hour
                    // (NASA POWER hourly path does not include these — derive from T and RH)
                    for (int h = 0; h < i; h++)
                    {
                        float t  = inp.airTemperatureH[h];
                        float rh = inp.relativeHumidityH[h];
                        if (float.IsNaN(t) || float.IsNaN(rh)) continue;

                        // Saturation vapour pressure (kPa) — Monteith & Unsworth 1990
                        float svp = 0.6108f * (float)Math.Exp(17.27f * t / (t + 237.3f));
                        float avp = svp * rh / 100f;
                        inp.vaporPressureDeficitH[h] = Math.Max(0f, svp - avp);

                        // ET₀ (polynomial regression from weatherReader)
                        double Rs  = inp.PAR;
                        double et0 = 0.1396
                                     - 3.019e-3  * rh
                                     - 1.2109e-3 * t
                                     + 1.626e-5  * rh * rh
                                     + 8.224e-5  * t  * t
                                     + 0.1842    * Rs
                                     + 0.5       * Rs * (-1.095e-3 * rh + 3.655e-3 * t)
                                     - 4.442e-3  * Rs * Rs;
                        inp.referenceET0H[h] = (float)Math.Max(0.0, et0);
                    }

                    results[date] = inp;
                }
            }

            return results;
        }

        // ── Helpers ───────────────────────────────────────────────────────────────
        private static float GetVal(Dictionary<string, Dictionary<string, float>> p,
            string key, string dateKey)
            => p.TryGetValue(key, out var inner) && inner.TryGetValue(dateKey, out var v)
                ? v
                : float.NaN;

        // ── JSON response DTOs ────────────────────────────────────────────────────
        public class NasaResponse
        {
            [JsonPropertyName("properties")]
            public NasaProperties Properties { get; set; }
        }

        public class NasaProperties
        {
            [JsonPropertyName("parameter")]
            public Dictionary<string, Dictionary<string, float>> Parameter { get; set; }
        }
    }
}
