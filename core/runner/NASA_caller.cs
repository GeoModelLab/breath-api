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
                        // NASA POWER hourly PRECTOTCORR = mm/day (daily total, repeated in every hour slot)
                        // divide by 24 to obtain mm/h for each hourly slot
                        float precMmDay = GetVal(data, "PRECTOTCORR", timestamp);
                        inp.precipitationH[i]    = float.IsNaN(precMmDay) ? 0f : precMmDay / 24f;

                        // NASA POWER hourly gives W/m² — convert to MJ/m²/h (×3.6e-3)
                        // so that the ×544 factor in exchanges.cs correctly yields µmol PAR/m²/s
                        float radWm2 = GetVal(data, "ALLSKY_SFC_SW_DWN", timestamp);
                        inp.solarRadiationH[i] = float.IsNaN(radWm2) ? 0f : radWm2 * 3.6e-3f;

                        tVals.Add(inp.airTemperatureH[i]);
                        rhVals.Add(inp.relativeHumidityH[i]);
                        radVals.Add(inp.solarRadiationH[i]);  // now in MJ/m²/h
                        precVals.Add(inp.precipitationH[i]);

                        i++;
                    }

                    // Aggregate daily scalars — filter NaN before Max/Min so a single
                    // missing hourly value does not propagate NaN into the daily stats
                    var validT   = tVals.Where(v => !float.IsNaN(v)).ToList();
                    var validRad = radVals.Where(v => !float.IsNaN(v)).ToList();
                    inp.airTemperatureMaximum = validT.Count > 0 ? validT.Max() : float.NaN;
                    inp.airTemperatureMinimum = validT.Count > 0 ? validT.Min() : float.NaN;
                    inp.solarRadiation        = validRad.Sum();   // MJ/m²/day
                    inp.PAR                   = inp.solarRadiation * 0.45f;
                    inp.precipitation         = precVals.Sum();   // mm/day

                    // Compute VPD and hourly ET₀ (Priestley–Taylor) for each hour
                    // using the actual measured hourly T and radiation
                    float gamma  = 0.066f;  // psychrometric constant, kPa °C⁻¹
                    float alpha  = 1.26f;   // Priestley–Taylor coefficient
                    float lambda = 2.45f;   // latent heat of vaporisation, MJ kg⁻¹
                    float et0Sum = 0f;
                    for (int h = 0; h < i; h++)
                    {
                        float t  = inp.airTemperatureH[h];
                        float rh = inp.relativeHumidityH[h];
                        if (float.IsNaN(t) || float.IsNaN(rh)) continue;

                        float svp = 0.6108f * (float)Math.Exp(17.27f * t / (t + 237.3f));
                        float avp = svp * rh / 100f;
                        inp.vaporPressureDeficitH[h] = Math.Max(0f, svp - avp);

                        // Priestley–Taylor ET₀ (mm h⁻¹) from hourly radiation
                        float rs = inp.solarRadiationH[h];   // MJ m⁻² h⁻¹
                        if (!float.IsNaN(rs) && rs > 0f)
                        {
                            float delta = 4098f * svp / (float)Math.Pow(t + 237.3f, 2f);
                            float et0h  = alpha * (delta / (delta + gamma)) * (rs / lambda);
                            inp.referenceET0H[h] = Math.Max(0f, et0h);
                            et0Sum += inp.referenceET0H[h];
                        }
                    }

                    // Daily ET₀ = sum of hourly values; used by waterStressFunction
                    // Fall back to Hargreaves–Samani when radiation data are missing
                    if (et0Sum > 0f)
                    {
                        inp.referenceEvapotranspiration = et0Sum;
                    }
                    else if (!float.IsNaN(inp.airTemperatureMaximum) && !float.IsNaN(inp.airTemperatureMinimum))
                    {
                        var wr = new weatherReader();
                        wr.dayLength(inp, inp.airTemperatureMaximum, inp.airTemperatureMinimum);
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
