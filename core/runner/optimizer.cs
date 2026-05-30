using System.Globalization;
using System.Text;
using runner.data;
using source.data;
using source.functions;
using UNIMI.optimizer;

namespace runner
{
    /// <summary>
    /// Wraps the BREATH model functions and implements <see cref="IOBJfunc"/> so that
    /// <see cref="MultiStartSimplex"/> can drive parameter calibration.
    ///
    /// Key responsibilities:
    ///   1. Assign calibration coefficients to the <see cref="parameters"/> struct
    ///      via reflection (class_field naming convention).
    ///   2. Evaluate the objective function (1 − Pearson R) + RMSE over all pixels.
    ///   3. Run the model forward (<see cref="oneShot"/>) with a fixed parameter set.
    ///   4. Write hourly CSV output via <see cref="WriteOutputsHourly"/>.
    /// </summary>
    internal class optimizer : IOBJfunc
    {
        /// <summary>Root directory for all output files (passed in from BreathRunner).</summary>
        private readonly string _baseOutputDir;

        public optimizer(string baseOutputDir)
        {
            _baseOutputDir       = baseOutputDir;
            outputsCalibrationDir = Path.Combine(_baseOutputDir, "results");
            outputParametersDir  = Path.Combine(_baseOutputDir, "calibration");
        }

        #region IOBJfunc counters
        private int _neval    = 0;
        private int _ncompute = 0;

        /// <summary>Total number of times the objective function was called.</summary>
        public int neval    { get => _neval;    set => _neval    = value; }
        /// <summary>Number of evaluations inside parameter bounds.</summary>
        public int ncompute { get => _ncompute; set => _ncompute = value; }
        #endregion

        #region BREATH sub-model instances
        private output output  = new output();  // state at day t−1
        private output outputT1 = new output(); // state at day t (current)

        private readonly VIdynamics               VIdynamics = new VIdynamics();
        private readonly dormancySeason           dormancy   = new dormancySeason();
        private readonly growingSeason            growing    = new growingSeason();
        private readonly source.functions.exchanges exchanges = new source.functions.exchanges();
        private readonly weatherReader            weatherReader = new weatherReader();
        #endregion

        #region Optimiser state
        public Dictionary<string, pixel>      idPixel              = new();
        public Dictionary<string, parameter>  nameParam            = new();
        public Dictionary<string, float>      param_outCalibration = new();
        public Dictionary<DateTime, output>   date_outputs         = new();

        public string  weatherDir;
        public List<string> allWeatherDataFiles;
        public string  weatherDataFile;
        public bool    isCalibration;
        public string  calibrationVariable;
        public int     startYear;
        public int     endYear;
        public string  outputsCalibrationDir;
        public string  outputParametersDir;
        public string  inputWeather;
        public Dictionary<DateTime, input> weatherData = new();
        public bool    isSWELLCalibrated;
        /// <summary>
        /// Configuration string passed to input.simulationSettings.configuration.
        /// Values: "baseline" | "pheno" | "pheno_circ"
        /// </summary>
        public string  modelConfiguration = "pheno";
        #endregion

        // ── Objective function ────────────────────────────────────────────────────
        /// <summary>
        /// Called by <see cref="MultiStartSimplex"/> at each iteration.
        /// Returns a scalar cost = (1 − Pearson R) + RMSE; returns 1E+300 when
        /// any coefficient is outside its allowed bounds.
        /// </summary>
        public double ObjfuncVal(double[] Coefficient, double[,] limits)
        {
            // Penalise out-of-bounds parameter sets immediately
            for (int j = 0; j < Coefficient.Length; j++)
            {
                if (Coefficient[j] == 0) break;
                if (Coefficient[j] <= limits[j, 0] || Coefficient[j] > limits[j, 1])
                    return 1E+300;
            }
            _neval++;
            _ncompute++;

            // Assign coefficients to the parameters struct via reflection
            var parameters = new source.data.parameters();
            AssignParameters(parameters, Coefficient);

            var errors          = new List<double>();
            var errors_nee      = new List<double>();
            var simulated       = new List<float>();
            var measured        = new List<float>();
            var simulated_nee   = new List<float>();
            var measured_nee    = new List<float>();

            foreach (var id in idPixel.Keys)
            {
                output  = new output();
                outputT1 = new output();

                // Optionally load a previously calibrated phenology file
                if (isCalibration && calibrationVariable != "Phenology")
                    TryLoadCalibrationFile(parameters,
                        Path.Combine(outputParametersDir + "_Phenology",
                            $"calibParam{id}.csv"));

                if (calibrationVariable == "Respiration")
                    TryLoadCalibrationFile(parameters,
                        Path.Combine(outputParametersDir + "_Photosynthesis",
                            $"calibParam{id}.csv"));

                foreach (var day in weatherData.Keys)
                {
                    if (day.Year < startYear - 1 || day.Year > endYear) continue;

                    weatherData[day].vegetationIndex = "EVI";
                    modelCall(weatherData[day], parameters);

                    if (calibrationVariable == "Phenology")
                    {
                        if (idPixel[id].dateVInorm.ContainsKey(day) && day.Year >= startYear + 1)
                        {
                            simulated.Add(outputT1.vi / 100);
                            measured.Add(idPixel[id].dateVInorm[day]);
                            errors.Add(Math.Pow(idPixel[id].dateVInorm[day] - outputT1.vi / 100, 2));
                        }
                    }
                    else if (calibrationVariable == "Photosynthesis")
                    {
                        for (int h = 0; h < 24; h++)
                        {
                            var key = day.AddHours(h);
                            if (!idPixel[id].dateGPP.TryGetValue(key, out referenceData gppRef)) continue;
                            float gppVal = gppRef.value;
                            if (float.IsNaN(gppVal)) continue;
                            if (outputT1.exchanges.GPP == null || outputT1.exchanges.GPP.Count <= h) continue;

                            simulated.Add(outputT1.exchanges.GPP[h]);
                            measured.Add(gppVal);
                            errors.Add(Math.Pow(gppVal - outputT1.exchanges.GPP[h], 2));
                        }
                    }
                    else if (calibrationVariable == "Respiration")
                    {
                        for (int h = 0; h < 24; h++)
                        {
                            var key = day.AddHours(h);
                            if (!idPixel[id].dateRECO.TryGetValue(key, out referenceData recoRef)) continue;
                            float recoVal = recoRef.value;
                            if (float.IsNaN(recoVal)) continue;
                            if (outputT1.exchanges.RECO == null || outputT1.exchanges.RECO.Count <= h) continue;

                            simulated.Add(outputT1.exchanges.RECO[h]);
                            measured.Add(recoVal);
                            errors.Add(Math.Pow(recoVal - outputT1.exchanges.RECO[h], 2));

                            if (outputT1.exchanges.NEE == null || outputT1.exchanges.NEE.Count <= h) continue;
                            simulated_nee.Add(outputT1.exchanges.NEE[h]);
                            if (!idPixel[id].dateNEE.TryGetValue(key, out referenceData neeRef)) continue;
                            float neeVal = neeRef.value;
                            measured_nee.Add(neeVal);
                            errors_nee.Add(Math.Pow(neeVal - outputT1.exchanges.NEE[h], 2));
                        }
                    }
                }
            }

            double pearsonR = Math.Round(ComputePearsonR(measured, simulated), 3);
            double RMSE     = Math.Round(Math.Sqrt(errors.Sum() / errors.Count), 3);
            double objFun   = (1 - pearsonR) + RMSE;

            if (calibrationVariable == "Respiration" && errors_nee.Count > 0)
            {
                double pearsonR_nee = Math.Round(ComputePearsonR(measured_nee, simulated_nee), 3);
                double RMSE_nee     = Math.Round(Math.Sqrt(errors_nee.Sum() / errors_nee.Count), 3);
                objFun = objFun * 0.3 + ((1 - pearsonR_nee) + RMSE_nee) * 0.7;
            }

            Console.Write(
                $"\rpixel {idPixel.Keys.First()} : RMSE = {RMSE:F3}  Pearson = {pearsonR:F3}");

            return objFun;
        }

        // ── Forward run ───────────────────────────────────────────────────────────
        /// <summary>
        /// Runs the model once with a fixed parameter set and writes hourly CSV output.
        /// Called after calibration (or instead of it when loading existing calibrated params).
        /// </summary>
        public void oneShot(Dictionary<string, float> paramValue,
                            out Dictionary<DateTime, output> date_outputs)
        {
            date_outputs = new();

            var parameters = new source.data.parameters();
            AssignParameterValues(parameters, paramValue);
            AssignParameterValues(parameters, param_outCalibration);

            foreach (var id in idPixel.Keys)
            {
                output  = new output();
                outputT1 = new output();

                // Initialise VI to minimum (×100 because vi is stored as EVI×100 internally).
                // minimumVI in CSV is in EVI units; output/calibration use vi/100.
                output.vi   = parameters.parVegetationIndex.minimumVI * 100;
                outputT1.vi = parameters.parVegetationIndex.minimumVI * 100;

                // Respiration state is initialized in exchanges.VPRM via fastPool/slowPool

                // Load phenology/photosynthesis calibration files when running
                // a subsequent calibration stage (e.g. Respiration after Phenology)
                if (isCalibration && calibrationVariable != "Phenology")
                {
                    TryLoadCalibrationFile(parameters,
                        Path.Combine(outputParametersDir + "_Phenology",
                            $"calibParam{id}.csv"));

                    if (calibrationVariable == "Respiration")
                        TryLoadCalibrationFile(parameters,
                            Path.Combine(outputParametersDir + "_Photosynthesis",
                                $"calibParam{id}.csv"));
                }

                date_outputs = new();

                foreach (var day in weatherData.Keys)
                {
                    // Allow startYear-1 as a phenological spin-up year (not recorded).
                    if (day.Year < startYear - 1 || day.Year > endYear) continue;

                    weatherData[day].latitude        = idPixel[id].latitude;
                    weatherData[day].vegetationIndex = "EVI";
                    modelCall(weatherData[day], parameters);

                    outputT1.weather = weatherData[day];
                    if (idPixel[id].dateVInorm.TryGetValue(day, out float vinorm))
                        outputT1.viReference = vinorm;

                    if (day.Year >= startYear)
                        date_outputs.Add(day, outputT1);
                }

                WriteOutputsHourly(id, date_outputs, isCalibration);
            }
        }

        // ── Daily BREATH model call ───────────────────────────────────────────────
        /// <summary>
        /// Advances the model by one day: rolls the state forward then calls each
        /// sub-model in sequence (dormancy → growing season → VI dynamics → exchanges).
        /// </summary>
        public void modelCall(input weatherData, parameters parameters)
        {
            // Roll state forward
            output  = outputT1;
            outputT1 = new output();

            // Carry over persistent state variables across day boundaries
            outputT1.exchanges.ET0memory           = output.exchanges.ET0memory;
            outputT1.exchanges.PrecipitationMemory = output.exchanges.PrecipitationMemory;
            outputT1.exchanges.fastPool            = output.exchanges.fastPool;
            outputT1.exchanges.slowPool            = output.exchanges.slowPool;

            // Propagate model configuration so exchanges.VPRM can branch correctly
            weatherData.simulationSettings ??= new source.data.simulationSettings();
            weatherData.simulationSettings.configuration = modelConfiguration;

            // Phenology sub-models
            dormancy.induction(weatherData, parameters, output, outputT1);
            dormancy.endodormancy(weatherData, parameters, output, outputT1);
            dormancy.ecodormancy(weatherData, parameters, output, outputT1);

            // Growing-season sub-models
            growing.growthRate(weatherData, parameters, output, outputT1);
            growing.greendownRate(weatherData, parameters, output, outputT1);
            growing.declineRate(weatherData, parameters, output, outputT1);

            // Vegetation index
            VIdynamics.ndviNormalized(weatherData, parameters, output, outputT1);

            // Carbon fluxes (only when SWELL phenology is calibrated)
            if (isSWELLCalibrated)
                exchanges.VPRM(weatherData, parameters, output, outputT1);
        }

        // ── Hourly CSV output ─────────────────────────────────────────────────────
        /// <summary>
        /// Writes a comma-separated file with one row per hour per day containing
        /// all weather drivers, phenological state variables, and carbon flux outputs.
        /// File is written to <c>_baseOutputDir/{id}.csv</c>.
        /// </summary>
        public void WriteOutputsHourly(string id,
            Dictionary<DateTime, output> date_outputs, bool isCalibration)
        {
            Console.WriteLine($"▶️ WriteOutputsHourly: pixel {id}, " +
                              $"{date_outputs?.Count ?? 0} days...");

            if (date_outputs == null || date_outputs.Count == 0)
            {
                Console.WriteLine("⚠️ No data in date_outputs — file not written.");
                return;
            }

            try
            {
                var nfi = (NumberFormatInfo)CultureInfo.InvariantCulture.NumberFormat.Clone();
                nfi.NumberDecimalDigits = 2;

                // Locale-invariant float formatter — blank string for NaN
                string fmt(float v) => float.IsNaN(v) ? "" : v.ToString("F", nfi);

                var sb = new StringBuilder(8_000_000);

                // Helper: safely index a List<float>
                float getH(List<float> lst, int h) =>
                    (lst != null && lst.Count > h) ? lst[h] : float.NaN;

                // Header row — matches new source.data.exchanges fields
                sb.AppendLine(
                    "pixel,date,year,doy,hour," +
                    "t,p,sw,rh,vpd,et0," +
                    "phenoPhase,SWELL,reference,vegetationCover," +
                    "tscale,PARscale,waterStress,PhenologyScale,vpdScale," +
                    "TscaleRECO,PhenoRECO,recoTandWS,recoGPP," +
                    "GPP,RECO,NEE");

                int lineCount = 0;
                foreach (var kvp in date_outputs)
                {
                    var weather = kvp.Key;
                    var w       = kvp.Value;

                    if (w?.weather == null || w.exchanges == null)
                    {
                        Console.WriteLine($"⚠️ Null data for {weather:yyyy-MM-dd}, skipping.");
                        continue;
                    }

                    var ex = w.exchanges;
                    var wd = w.weather;

                    string pheno = w.phenoCode switch
                    {
                        1 => "Dormancy induction",
                        2 => "Dormancy",
                        3 => "Growth",
                        4 => "Greendown",
                        5 => "Senescence",
                        _ => ""
                    };

                    // EVI reference value for this day (may be absent between composites)
                    string vinormStr = idPixel.TryGetValue(id, out var px) &&
                                       px.dateVInorm != null &&
                                       px.dateVInorm.TryGetValue(weather, out var vinorm)
                        ? fmt(vinorm)
                        : "";

                    for (int hour = 0; hour < 24; hour++)
                    {
                        try
                        {
                            sb.AppendLine(string.Join(",",
                                id,
                                weather.ToString("yyyy-MM-dd"),
                                weather.Year,
                                weather.DayOfYear,
                                hour + 1,                          // 1-based hour

                                fmt(wd.airTemperatureH[hour]),
                                fmt(wd.precipitationH[hour]),
                                fmt(wd.solarRadiationH[hour]),
                                fmt(wd.relativeHumidityH[hour]),
                                fmt(wd.vaporPressureDeficitH[hour]),
                                fmt(wd.referenceEvapotranspiration / 24f), // daily ET0 spread over 24h

                                pheno,
                                fmt(w.vi / 100),
                                vinormStr,
                                fmt(ex.vegetationCover),

                                fmt(getH(ex.temperatureScale, hour)),
                                fmt(getH(ex.PARscale,         hour)),
                                fmt(getH(ex.Wscale,           hour)),
                                fmt(ex.phenologyScale),
                                fmt(getH(ex.vpdScale,         hour)),

                                fmt(getH(ex.TscaleReco,       hour)),
                                fmt(getH(ex.PhenologyscaleReco, hour)),
                                fmt(getH(ex.recoTandWS,       hour)),
                                fmt(getH(ex.recoGPP,          hour)),

                                fmt(getH(ex.GPP,  hour)),
                                fmt(getH(ex.RECO, hour)),
                                fmt(getH(ex.NEE,  hour))
                            ));
                            lineCount++;
                        }
                        catch (Exception inner)
                        {
                            Console.WriteLine(
                                $"⚠️ Error at hour {hour} on {weather:yyyy-MM-dd}: {inner.Message}");
                        }
                    }
                }

                Console.WriteLine($"✅ Loop done: {lineCount} rows in memory.");

                // Determine output directory — fall back if path ends up inside bin/
                string resultsDir = _baseOutputDir;
                if (resultsDir.Contains("bin\\Debug", StringComparison.OrdinalIgnoreCase) ||
                    resultsDir.Contains("bin/Debug",  StringComparison.OrdinalIgnoreCase))
                {
                    string projectRoot = Path.GetFullPath(
                        Path.Combine(AppContext.BaseDirectory, "..", "..", ".."));
                    resultsDir = Path.Combine(projectRoot, "wwwroot", "output", "results");
                    Console.WriteLine($"🔁 Corrected output path: {resultsDir}");
                }

                Directory.CreateDirectory(resultsDir);

                string filePath = Path.Combine(resultsDir, $"{id}.csv");
                File.WriteAllText(filePath, sb.ToString());
                Console.WriteLine($"✅ Written: {filePath}");
            }
            catch (Exception ex)
            {
                Console.WriteLine(
                    $"❌ WriteOutputsHourly failed for pixel {id}: {ex.Message}\n{ex.StackTrace}");
            }
        }

        // ── Static helpers ────────────────────────────────────────────────────────
        /// <summary>Pearson correlation coefficient between two equal-length lists.</summary>
        public static double ComputePearsonR(List<float> listX, List<float> listY)
        {
            if (listX == null || listY == null ||
                listX.Count != listY.Count || listX.Count == 0)
                return -99;

            int    n     = listX.Count;
            double meanX = listX.Average();
            double meanY = listY.Average();

            double cov = 0, varX = 0, varY = 0;
            for (int i = 0; i < n; i++)
            {
                double dx = listX[i] - meanX, dy = listY[i] - meanY;
                cov  += dx * dy;
                varX += dx * dx;
                varY += dy * dy;
            }

            double denom = Math.Sqrt(varX) * Math.Sqrt(varY);
            return denom == 0 ? -99 : cov / denom;
        }

        // ── Reflection-based parameter assignment ─────────────────────────────────
        /// <summary>
        /// Maps calibration coefficients back onto the <paramref name="parameters"/> struct.
        /// Naming convention: parameter key = "ClassName_PropertyName".
        /// Calibrated params consume consecutive entries in <paramref name="coefficients"/>;
        /// non-calibrated params are taken from <see cref="param_outCalibration"/>.
        /// </summary>
        private void AssignParameters(source.data.parameters parameters, double[] coefficients)
        {
            var type = parameters.GetType();
            int coef = 0;

            foreach (var param in nameParam.Keys)
            {
                var (cls, prop, classInst, propInfo) = ResolveParam(type, parameters, param);
                if (propInfo == null) continue;

                if (nameParam[param].calibration != "")
                {
                    propInfo.SetValue(classInst,
                        Convert.ChangeType(coefficients[coef++], propInfo.PropertyType));
                }
                else if (param_outCalibration.TryGetValue(param, out float fixedVal))
                {
                    propInfo.SetValue(classInst,
                        Convert.ChangeType(fixedVal, propInfo.PropertyType));
                }
            }
        }

        /// <summary>
        /// Assigns a flat key→value dictionary onto the parameters struct via reflection.
        /// Used by <see cref="oneShot"/> for both calibrated and fixed parameters.
        /// </summary>
        private static void AssignParameterValues(source.data.parameters parameters,
            Dictionary<string, float> values)
        {
            var type = parameters.GetType();
            foreach (var (key, val) in values)
            {
                var (_, _, classInst, propInfo) = ResolveParam(type, parameters, key);
                if (propInfo == null) continue;
                propInfo.SetValue(classInst, Convert.ChangeType(val, propInfo.PropertyType));
            }
        }

        private static (string cls, string prop, object classInst, System.Reflection.PropertyInfo propInfo)
            ResolveParam(Type type, source.data.parameters parameters, string key)
        {
            var parts    = key.Split('_');
            if (parts.Length < 2) return (null, null, null, null);
            string cls   = parts[0].Trim();
            string prop  = parts[1].Trim();
            var clsField = type.GetField(cls);
            if (clsField == null) return (cls, prop, null, null);
            var clsInst  = clsField.GetValue(parameters);
            var propInfo = clsInst?.GetType().GetProperty(prop);
            return (cls, prop, clsInst, propInfo);
        }

        /// <summary>
        /// Reads a calibrated-parameter CSV and applies values to the parameters struct.
        /// Silently skips missing files or unrecognised property names.
        /// </summary>
        private static void TryLoadCalibrationFile(source.data.parameters parameters, string path)
        {
            if (!File.Exists(path)) return;
            var type = parameters.GetType();

            foreach (var line in File.ReadAllLines(path).Skip(1))
            {
                var cols = line.Split(',');
                if (cols.Length < 4) continue;

                string cls   = cols[2].Split('_')[0].Trim();
                string prop  = cols[2].Split('_')[1].Trim();
                string value = cols[3].Trim();

                var clsField = type.GetField(cls);
                if (clsField == null) continue;
                var clsInst  = clsField.GetValue(parameters);
                var propInfo = clsInst?.GetType().GetProperty(prop);
                if (propInfo == null || !propInfo.CanWrite) continue;

                try
                {
                    propInfo.SetValue(clsInst,
                        Convert.ChangeType(value, propInfo.PropertyType));
                }
                catch { /* silently skip type conversion errors */ }
            }
        }
    }
}
