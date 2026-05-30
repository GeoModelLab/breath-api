using System.Text.Json;
using BreathApi.Utils;
using runner;

namespace BreathApi.ModelRunner
{
    public class BreathModel
    {
        private readonly Action<string>? _log;
        private string _outputDir;
        private readonly string _baseUrl;

        public BreathModel(Action<string>? logger, string outputDir, string baseUrl = "http://localhost:5244")
        {
            _log = logger;
            _outputDir = outputDir;
            _baseUrl = baseUrl.TrimEnd('/');
        }

        public async Task<string> RunAsync(string configJson)
        {
            _log?.Invoke("🚀 Avvio BreathModel (API layer)...");

            // === 1️⃣ Scrivi la configurazione temporanea ===
            string tempPath = Path.Combine(Path.GetTempPath(), "BreathConfig.json");
            await File.WriteAllTextAsync(tempPath, configJson);
            _log?.Invoke($"📄 Config temporanea scritta in: {tempPath}");

            // === 2️⃣ Imposta percorso wwwroot reale ===
            string rootDir;

            // ☁️ Render (ambiente di produzione)
            if (Environment.GetEnvironmentVariable("RENDER") != null)
            {
                rootDir = Path.Combine(AppContext.BaseDirectory, "wwwroot");
            }
            // 💻 Locale (Visual Studio / Windows)
            else
            {
                // Sali di tre livelli da bin\Debug\net8.0 per arrivare al progetto
                rootDir = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "wwwroot"));
            }

            // === 3️⃣ Imposta directory risultati e log ===
            string outputDir = Path.Combine(rootDir, "output");
            string resultsDir = Path.Combine(outputDir, "results");
            string logsDir = Path.Combine(outputDir, "logs");

            // ✅ Crea cartelle se mancano
            Directory.CreateDirectory(resultsDir);
            Directory.CreateDirectory(logsDir);

            // ✅ Salva percorso in campo locale
            _outputDir = outputDir; // assicurati che _outputDir non sia readonly!

            _log?.Invoke($"🌍 Root wwwroot: {rootDir}");
            _log?.Invoke($"📂 Results dir: {resultsDir}");
            _log?.Invoke($"📂 Logs dir: {logsDir}");

            // === 4️⃣ Log iniziale ===
            string logFile = Path.Combine(logsDir, "breath_log.txt");
            await File.WriteAllTextAsync(logFile, $"[{DateTime.Now}] ✅ Inizio simulazione...\n");

            try
            {
                await File.AppendAllTextAsync(logFile, $"[API] Config temporanea: {tempPath}\n");

                // === 3️⃣ Avvia il motore (BreathRunner) ===
                _log?.Invoke($"⚙️ Avvio BreathRunner con webRootPath = {rootDir}");
                var model = new BreathRunner(LogStreamer.Log, rootDir);  // passa wwwroot, non resultsDir
                string result = await model.RunAsync(tempPath);

                await File.AppendAllTextAsync(logFile, "[API] ✅ Simulazione completata lato motore.\n");

                // === 4️⃣ Ricerca intelligente file CSV ===
                _log?.Invoke($"🔍 Ricerca file CSV in {resultsDir}...");
                List<FileInfo> allCsv = new();

                string[] possibleDirs =
                {
            resultsDir,
            Path.Combine(AppContext.BaseDirectory, "wwwroot", "output", "results"),
            Path.Combine(Directory.GetParent(AppContext.BaseDirectory)!.FullName, "wwwroot", "output", "results")
        };

                foreach (var dir in possibleDirs)
                {
                    if (Directory.Exists(dir))
                    {
                        var found = new DirectoryInfo(dir)
                            .GetFiles("*.csv", SearchOption.TopDirectoryOnly)
                            .Where(f => !f.Name.Contains("weather", StringComparison.OrdinalIgnoreCase) &&
                                        !f.Name.Contains("calibParam", StringComparison.OrdinalIgnoreCase))
                            .OrderByDescending(f => f.LastWriteTime)
                            .ToList();

                        if (found.Count > 0)
                        {
                            allCsv = found;
                            resultsDir = dir;
                            _log?.Invoke($"✅ Trovati {found.Count} CSV in {dir}");
                            break;
                        }
                        else
                        {
                            _log?.Invoke($"⚠️ Nessun CSV in {dir}");
                        }
                    }
                }

                FileInfo? latestFile = null;
                string? matchLat = null, matchLon = null;

                try
                {
                    var config = JsonSerializer.Deserialize<JsonElement>(configJson);
                    if (config.TryGetProperty("settings", out var settings) &&
                        settings.TryGetProperty("pixelsRun", out var pixels) &&
                        pixels.ValueKind == JsonValueKind.Array && pixels.GetArrayLength() > 0)
                    {
                        var pixelId = pixels[0].GetString()?.Trim();
                        if (!string.IsNullOrEmpty(pixelId))
                        {
                            var parts = pixelId.Split('_');
                            if (parts.Length == 2)
                            {
                                matchLat = parts[0];
                                matchLon = parts[1];
                            }
                        }
                    }
                }
                catch (Exception ex)
                {
                    _log?.Invoke($"⚠️ Errore parsing pixel ID: {ex.Message}");
                }

                if (matchLat != null && matchLon != null)
                {
                    latestFile = allCsv.FirstOrDefault(f =>
                        f.Name.Contains(matchLat[..Math.Min(matchLat.Length, 8)], StringComparison.OrdinalIgnoreCase) &&
                        f.Name.Contains(matchLon[..Math.Min(matchLon.Length, 8)], StringComparison.OrdinalIgnoreCase));
                }

                latestFile ??= allCsv.FirstOrDefault();

                if (latestFile != null)
                {
                    _log?.Invoke($"✅ Output trovato: {latestFile.FullName}");
                    await File.AppendAllTextAsync(logFile, $"[API] ✅ Output trovato: {latestFile.FullName}\n");
                }
                else
                {
                    string msg = $"❌ Nessun CSV trovato in nessuna directory nota.";
                    _log?.Invoke(msg);
                    await File.AppendAllTextAsync(logFile, $"[API] {msg}\n");
                }

                // === 5️⃣ Prepara URL pubblici ===
                string logUrl = $"{_baseUrl}/output/logs/breath_log.txt";
                string outputUrl = latestFile != null
                    ? $"{_baseUrl}/output/results/{Path.GetFileName(latestFile.FullName)}"
                    : null;

                await File.AppendAllTextAsync(logFile, $"[API] ✅ Log accessibile: {logUrl}\n");
                if (outputUrl != null)
                    await File.AppendAllTextAsync(logFile, $"[API] ✅ Output accessibile: {outputUrl}\n");

                // === 6️⃣ JSON di risposta ===
                var payload = new
                {
                    Status = "OK",
                    Message = "Simulazione completata",
                    LogUrl = logUrl,
                    OutputUrl = outputUrl,
                    Result = result,
                    Timestamp = DateTime.Now
                };

                await File.AppendAllTextAsync(logFile, $"[{DateTime.Now}] ✅ Simulazione completata con successo.\n");

                _log?.Invoke($"🌐 Log URL: {logUrl}");
                if (outputUrl != null)
                    _log?.Invoke($"🌐 Output URL: {outputUrl}");

                return JsonSerializer.Serialize(payload, new JsonSerializerOptions { WriteIndented = true });
            }
            catch (Exception ex)
            {
                string errorMsg = $"❌ Errore: {ex.Message}\n{ex.StackTrace}";
                _log?.Invoke(errorMsg);
                await File.AppendAllTextAsync(logFile, errorMsg + "\n");

                return JsonSerializer.Serialize(new
                {
                    Status = "Error",
                    Message = ex.Message,
                    Stack = ex.StackTrace
                });
            }
        }


    }
}
