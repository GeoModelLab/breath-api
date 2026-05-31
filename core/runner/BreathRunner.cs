using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using runner.data;
using source.data;
using source.functions;
using UNIMI.optimizer;

namespace runner
{
    /// <summary>
    /// High-level async entry point for the BREATH model.
    ///
    /// Responsibilities:
    ///   1. Parse the JSON configuration file.
    ///   2. Download or load cached weather data from NASA POWER.
    ///   3. Download or load cached MODIS EVI composites from ORNL DAAC.
    ///   4. Optionally run the multi-start simplex calibration.
    ///   5. Run the forward model and write hourly CSV output.
    ///
    /// The caller (BreathModel in the API layer) is responsible for resolving
    /// <paramref name="webRootPath"/> to the correct wwwroot directory before
    /// constructing this class.
    /// </summary>
    public class BreathRunner
    {
        private readonly Action<string>? _log;

        /// <summary>Absolute path to the ASP.NET Core wwwroot directory.</summary>
        private readonly string _webRootPath;

        /// <param name="logger">Optional delegate that receives progress log lines.</param>
        /// <param name="webRootPath">Absolute path of the wwwroot directory (from IWebHostEnvironment.WebRootPath).</param>
        public BreathRunner(Action<string>? logger, string webRootPath)
        {
            _log         = logger;
            _webRootPath = webRootPath;
        }

        // ── Public entry point ────────────────────────────────────────────────────
        /// <summary>
        /// Runs the full BREATH pipeline for every pixel listed in the config file.
        /// Returns a JSON string with Status, Message, OutputDir, and Timestamp.
        /// </summary>
        /// <param name="configPath">Absolute path to the BreathConfig.json file.</param>
        public async Task<string> RunAsync(string configPath)
        {
            try
            {
                if (!File.Exists(configPath))
                    return Err($"Config file not found: {configPath}");

                string jsonString = await File.ReadAllTextAsync(configPath);
                var config = JsonSerializer.Deserialize<root>(jsonString);
                if (config?.settings == null)
                    return Err("Invalid or empty configuration.");

                // ── Parse settings ────────────────────────────────────────────────
                bool   isCalibration       = bool.Parse(config.settings.calibration.ToString());
                string calibrationVariable = config.settings.calibrationVariable.ToString();
                var    pixelsRun           = config.settings.pixelsRun ?? new List<string>();
                int    simplexes           = int.Parse(config.settings.simplexes.ToString());
                int    iterations          = int.Parse(config.settings.iterations.ToString());
                string inputWeather        = config.settings.inputWeather.ToString();
                int    startYear           = int.Parse(config.settings.startYear.ToString());
                int    endYear             = int.Parse(config.settings.endYear.ToString());
                string parametersDataFile  = config.settings.parametersDataFile.ToString();
                // Map UI variant name → internal configuration string
                string modelVariantRaw    = config.settings.modelVariant?.ToString() ?? "Pheno";
                string modelConfiguration = modelVariantRaw.ToLower() switch
                {
                    "circadian" => "pheno_circ",
                    "baseline"  => "baseline",
                    _           => "pheno"       // default: Pheno
                };

                // ── Resolve paths relative to wwwroot ────────────────────────────
                string wwwRoot    = _webRootPath;
                string logsDir    = Path.Combine(wwwRoot, "output", "logs");
                string resultsDir = Path.Combine(wwwRoot, "output", "results");

                // Point MODIS cache to a persistent location inside wwwroot
                ModisEviPoint.CacheDirectory = Path.Combine(wwwRoot, "cache");

                if (!Path.IsPathRooted(parametersDataFile))
                {
                    string dataBase   = Path.Combine(wwwRoot, "data", "parametersData");
                    parametersDataFile = Path.Combine(dataBase, Path.GetFileName(parametersDataFile));
                }

                if (!File.Exists(parametersDataFile))
                    return Err($"Parameters file not found: {parametersDataFile}");

                Directory.CreateDirectory(logsDir);
                Directory.CreateDirectory(resultsDir);

                // Log to file as well as to the streaming delegate
                string logFile = Path.Combine(logsDir, "breath_log.txt");
                await File.WriteAllTextAsync(logFile,
                    $"[{DateTime.Now}] ✅ Simulation started...\n");

                // ── Build optimiser ───────────────────────────────────────────────
                var optimizer = new optimizer(resultsDir)
                {
                    startYear           = startYear,
                    endYear             = endYear,
                    isCalibration       = isCalibration,
                    calibrationVariable = calibrationVariable,
                    inputWeather        = inputWeather,
                    modelConfiguration  = modelConfiguration,
                };
                _log?.Invoke($"[{DateTime.Now:HH:mm:ss}] 🌿 {pixelsRun.Count} pixel(s) · {startYear}–{endYear} · variant: {modelVariantRaw}" + (isCalibration ? " · calibration ON" : ""));

                var paramReader = new paramReader();
                optimizer.nameParam = paramReader.read(parametersDataFile);

                // Apply any UI-supplied parameter overrides on top of the CSV defaults
                if (config.parameterOverrides != null)
                {
                    foreach (var kv in config.parameterOverrides)
                    {
                        if (optimizer.nameParam.TryGetValue(kv.Key, out var p))
                        {
                            _log?.Invoke($"[{DateTime.Now:HH:mm:ss}] ⚙ Parameter override: {kv.Key} = {kv.Value}");
                            p.value = kv.Value;
                        }
                    }
                }

                var msx = new MultiStartSimplex
                {
                    NofSimplexes = simplexes,
                    Ftol         = 0.000001,
                    Itmax        = iterations
                };

                // ── Pixel loop ────────────────────────────────────────────────────
                foreach (var pixel in pixelsRun)
                {
                    double lat = double.Parse(pixel.Split('_')[0], CultureInfo.InvariantCulture);
                    double lon = double.Parse(pixel.Split('_')[1], CultureInfo.InvariantCulture);

                    string pixelPrefix  = $"{lat}_{lon}";
                    string weatherFile  = Path.Combine(resultsDir, $"{pixelPrefix}_weather.csv");
                    string calibFile    = Path.Combine(resultsDir, $"calibParam_{pixelPrefix}.csv");

                    _log?.Invoke($"[{DateTime.Now:HH:mm:ss}] 📍 Processing pixel {pixelPrefix}…");

                    // ── Weather ───────────────────────────────────────────────────
                    bool needsWeather = true;
                    if (File.Exists(weatherFile))
                    {
                        int fileStart = GetStartYearFromWeather(weatherFile);
                        int fileEnd   = GetEndYearFromWeather(weatherFile);
                        // fileStart may be startYear-1 (spin-up); accept if it covers the needed range
                        if (fileStart <= startYear && fileEnd == endYear)
                        {
                            _log?.Invoke($"[{DateTime.Now:HH:mm:ss}] ☀️ Weather data loaded from cache.");
                            optimizer.weatherData = await ReadWeatherCsvAsync(weatherFile);
                            needsWeather = false;
                        }
                    }

                    if (needsWeather)
                    {
                        _log?.Invoke($"[{DateTime.Now:HH:mm:ss}] ☀️ Downloading weather from NASA POWER ({inputWeather})…");
                        int fetchStart = startYear > 1980 ? startYear - 1 : startYear;
                        var weatherData = await NasaPower.GetWeatherAsync(
                            lat, lon, fetchStart, endYear, inputWeather);
                        await WriteWeatherCsvAsync(weatherFile, weatherData);
                        optimizer.weatherData = weatherData;
                    }

                    optimizer.idPixel[pixel] = new pixel
                    {
                        id        = pixel,
                        latitude  = (float)lat,
                        longitude = (float)lon
                    };

                    // ── MODIS EVI ─────────────────────────────────────────────────
                    // Only needed when calibrating against observed EVI
                    if (isCalibration)
                    {
                        if (File.Exists(calibFile))
                        {
                            _log?.Invoke($"[{DateTime.Now:HH:mm:ss}] 📈 Calibrated parameters found — skipping MODIS download.");
                        }
                        else
                        {
                            _log?.Invoke($"[{DateTime.Now:HH:mm:ss}] 🛰 Downloading MODIS EVI composites for calibration…");
                            try
                            {
                                var eviDict = await ModisEviPoint.GetEviMultiYearAsync(
                                    lat, lon, startYear, endYear,
                                    p => _log?.Invoke($"PROGRESS_MODIS:{p * 100:F2}"));

                                if (eviDict == null || eviDict.Count == 0)
                                {
                                    _log?.Invoke($"[{DateTime.Now:HH:mm:ss}] ⚠️ No MODIS EVI data available — running with default parameters.");
                                    isCalibration = false;
                                }
                                else
                                {
                                    _log?.Invoke($"[{DateTime.Now:HH:mm:ss}] 🛰 MODIS EVI: {eviDict.Count} composites loaded.");
                                    optimizer.idPixel[pixel].dateVInorm = eviDict;
                                }
                            }
                            catch (Exception eviEx)
                            {
                                _log?.Invoke($"[{DateTime.Now:HH:mm:ss}] ⚠️ MODIS download failed — running with default parameters.");
                                isCalibration = false;
                            }
                        }
                    }
                    }

                    var paramCalibValue = new Dictionary<string, float>();

                    // ── Calibration ───────────────────────────────────────────────
                    if (isCalibration && !File.Exists(calibFile))
                    {
                        _log?.Invoke($"[{DateTime.Now:HH:mm:ss}] 🔬 Calibrating model parameters ({simplexes} restarts × {iterations} iterations)…");

                        int paramCalibrated = optimizer.nameParam.Count(
                            x => x.Value.calibration != "");
                        var limits = new double[paramCalibrated, 2];
                        var param_outCalibration = new Dictionary<string, float>();
                        int i = 0;

                        foreach (var name in optimizer.nameParam.Keys)
                        {
                            if (optimizer.nameParam[name].calibration != "")
                            {
                                limits[i, 1] = optimizer.nameParam[name].maximum;
                                limits[i, 0] = optimizer.nameParam[name].minimum;
                                i++;
                            }
                            else
                            {
                                param_outCalibration[name] = optimizer.nameParam[name].value;
                            }
                        }

                        optimizer.param_outCalibration = param_outCalibration;
                        msx.Multistart(optimizer, paramCalibrated, limits, out double[,] results);

                        var writeParam = new List<string> { "pixelID,ecoRegion,param,value" };
                        int count = 0;

                        foreach (var param in optimizer.nameParam.Keys)
                        {
                            if (optimizer.nameParam[param].calibration != "")
                            {
                                float val = (float)Math.Round(results[0, count], 3);
                                writeParam.Add($"{pixel},TEST,{param},{val}");
                                paramCalibValue[param]             = val;
                                optimizer.nameParam[param].value   = val;
                                count++;
                            }
                        }

                        File.WriteAllLines(calibFile, writeParam);
                        _log?.Invoke($"[{DateTime.Now:HH:mm:ss}] 💾 Best parameters saved.");
                    }
                    else
                    {
                        // Load existing calibrated parameters
                        _log?.Invoke($"[{DateTime.Now:HH:mm:ss}] 💾 Loading previously calibrated parameters.");
                        if (File.Exists(calibFile))
                        {
                            foreach (var line in File.ReadAllLines(calibFile).Skip(1))
                            {
                                var parts = line.Split(',');
                                if (parts.Length >= 4 &&
                                    float.TryParse(parts[3], NumberStyles.Float,
                                        CultureInfo.InvariantCulture, out float value))
                                {
                                    string param = parts[2];
                                    paramCalibValue[param] = value;
                                    if (optimizer.nameParam.ContainsKey(param))
                                        optimizer.nameParam[param].value = value;
                                }
                            }
                        }

                        var param_outCalibration = new Dictionary<string, float>();
                        foreach (var name in optimizer.nameParam.Keys)
                        {
                            if (!paramCalibValue.ContainsKey(name))
                                param_outCalibration[name] = optimizer.nameParam[name].value;
                        }

                        optimizer.param_outCalibration = param_outCalibration;
                        optimizer.isCalibration        = false;
                    }

                    // ── Forward run ───────────────────────────────────────────────
                    optimizer.isSWELLCalibrated = true;
                    optimizer.oneShot(paramCalibValue, out Dictionary<DateTime, output> dateOutputs);
                    _log?.Invoke($"[{DateTime.Now:HH:mm:ss}] ✅ Pixel {pixelPrefix} done.");

                    string outFile = Path.Combine(resultsDir, $"{pixelPrefix}.csv");
                    if (!File.Exists(outFile))
                        _log?.Invoke($"[{DateTime.Now:HH:mm:ss}] ⚠️ Output file not found for {pixelPrefix}.");
                }

                await File.AppendAllTextAsync(logFile,
                    $"[{DateTime.Now}] ✅ All pixels complete.\n");

                // Merge all per-pixel CSVs into a single latest_results.csv
                // so the results endpoint always returns the complete dataset
                string latestFile = Path.Combine(resultsDir, "latest_results.csv");
                await MergePixelCsvsAsync(pixelsRun, resultsDir, latestFile);
                _log?.Invoke($"[{DateTime.Now:HH:mm:ss}] 📊 All pixels complete — combined CSV ready ({pixelsRun.Count} pixel(s)).");

                return JsonSerializer.Serialize(new
                {
                    Status    = "OK",
                    Message   = "Simulation completed successfully",
                    OutputDir = resultsDir,
                    Timestamp = DateTime.Now
                });
            }
            catch (Exception ex)
            {
                _log?.Invoke($"[{DateTime.Now:HH:mm:ss}] ❌ Error: {ex.Message}");
                return JsonSerializer.Serialize(new
                {
                    Status  = "Error",
                    Message = ex.Message,
                    Stack   = ex.StackTrace
                });
            }
        }

        // ── Private helpers ───────────────────────────────────────────────────────

        /// <summary>
        /// Concatenates per-pixel CSV files into a single combined output file.
        /// The header row is taken from the first file; subsequent files skip their header.
        /// </summary>
        private static async Task MergePixelCsvsAsync(
            IEnumerable<string> pixels, string resultsDir, string outPath)
        {
            using var writer = new StreamWriter(outPath, append: false,
                encoding: System.Text.Encoding.UTF8);
            bool firstFile = true;
            foreach (var pixel in pixels)
            {
                string src = Path.Combine(resultsDir, $"{pixel}.csv");
                if (!File.Exists(src)) continue;
                using var reader = new StreamReader(src);
                bool firstLine = true;
                string? line;
                while ((line = await reader.ReadLineAsync()) != null)
                {
                    if (firstLine)
                    {
                        firstLine = false;
                        if (!firstFile) continue;   // skip duplicate header
                    }
                    await writer.WriteLineAsync(line);
                }
                firstFile = false;
            }
        }

        private static string Err(string msg) =>
            JsonSerializer.Serialize(new { Status = "Error", Message = msg });

        private static int GetStartYearFromWeather(string path)
        {
            var line = File.ReadLines(path).Skip(1).FirstOrDefault();
            return line != null &&
                   DateTime.TryParse(line.Split(',')[0], out var d) ? d.Year : 0;
        }

        private static int GetEndYearFromWeather(string path)
        {
            var line = File.ReadLines(path).LastOrDefault();
            return line != null &&
                   DateTime.TryParse(line.Split(',')[0], out var d) ? d.Year : 0;
        }

        private static async Task<Dictionary<DateTime, input>> ReadWeatherCsvAsync(string path)
        {
            var dict   = new Dictionary<DateTime, input>();
            var lines  = await File.ReadAllLinesAsync(path);
            if (lines.Length <= 1) return dict;

            var wr = new weatherReader();   // used to reconstruct hourly arrays from daily data

            foreach (var line in lines.Skip(1))
            {
                var p = line.Split(',');
                if (p.Length < 7) continue;
                if (!DateTime.TryParse(p[0], out var date)) continue;

                var daily = new input
                {
                    date                  = date,
                    PAR                   = float.Parse(p[1], CultureInfo.InvariantCulture),
                    airTemperatureMaximum = float.Parse(p[2], CultureInfo.InvariantCulture),
                    airTemperatureMinimum = float.Parse(p[3], CultureInfo.InvariantCulture),
                    solarRadiation        = float.Parse(p[4], CultureInfo.InvariantCulture),
                    dewPointTemperature   = p.Length > 5 ? float.Parse(p[5], CultureInfo.InvariantCulture) : 0f,
                    precipitation         = p.Length > 6 ? float.Parse(p[6], CultureInfo.InvariantCulture) : 0f,
                    latitude              = p.Length > 7 ? float.Parse(p[7], CultureInfo.InvariantCulture) : 0f,
                    vegetationIndex       = ""
                };

                // Reconstruct hourly arrays (airTemperatureH, solarRadiationH, etc.)
                // from the stored daily values — same as the daily NASA POWER path.
                dict[date] = wr.estimateHourly(daily);
            }
            return dict;
        }

        private static async Task WriteWeatherCsvAsync(string path,
            Dictionary<DateTime, input> weather)
        {
            var lines = new List<string>
            {
                "Date,PAR,airTemperatureMaximum,airTemperatureMinimum," +
                "solarRadiation,dewPointTemperature,precipitation,latitude"
            };

            lines.AddRange(weather.Select(w =>
                $"{w.Key:yyyy-MM-dd}," +
                $"{w.Value.PAR.ToString(CultureInfo.InvariantCulture)}," +
                $"{w.Value.airTemperatureMaximum.ToString(CultureInfo.InvariantCulture)}," +
                $"{w.Value.airTemperatureMinimum.ToString(CultureInfo.InvariantCulture)}," +
                $"{w.Value.solarRadiation.ToString(CultureInfo.InvariantCulture)}," +
                $"{w.Value.dewPointTemperature.ToString(CultureInfo.InvariantCulture)}," +
                $"{w.Value.precipitation.ToString(CultureInfo.InvariantCulture)}," +
                $"{w.Value.latitude.ToString(CultureInfo.InvariantCulture)}"));

            var dir = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                Directory.CreateDirectory(dir);

            await File.WriteAllLinesAsync(path, lines);
        }
    }
}
