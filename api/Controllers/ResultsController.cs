using Microsoft.AspNetCore.Mvc;
using System.Globalization;
using System.Text.Json;

namespace BreathApi.Controllers
{
    /// <summary>
    /// Endpoint per recuperare i risultati delle simulazioni BREATH.
    ///
    /// GET /api/results/list         — elenca tutti i file CSV di output disponibili
    /// GET /api/results/latest       — scarica il CSV più recente
    /// GET /api/results/latest/json  — restituisce il CSV più recente come array JSON
    /// GET /api/results/{filename}   — scarica un file specifico
    /// DELETE /api/results/{filename} — cancella un file specifico
    /// </summary>
    [ApiController]
    [Route("api/[controller]")]
    public class ResultsController : ControllerBase
    {
        private readonly IWebHostEnvironment _env;

        public ResultsController(IWebHostEnvironment env)
        {
            _env = env;
        }

        // ── Helpers ──────────────────────────────────────────────────────
        private string ResultsDir => Path.Combine(_env.WebRootPath, "output", "results");

        private static bool IsOutputFile(FileInfo f) =>
            !f.Name.Contains("weather",    StringComparison.OrdinalIgnoreCase) &&
            !f.Name.Contains("calibParam", StringComparison.OrdinalIgnoreCase);

        private FileInfo? LatestCsv()
        {
            if (!Directory.Exists(ResultsDir)) return null;
            // Always prefer the merged combined file produced at end of each run
            var combined = new FileInfo(Path.Combine(ResultsDir, "latest_results.csv"));
            if (combined.Exists) return combined;
            // Fallback: most recently modified per-pixel CSV
            return new DirectoryInfo(ResultsDir)
                .GetFiles("*.csv", SearchOption.TopDirectoryOnly)
                .Where(IsOutputFile)
                .OrderByDescending(f => f.LastWriteTime)
                .FirstOrDefault();
        }

        // ── GET /api/results/list ─────────────────────────────────────────
        [HttpGet("list")]
        public IActionResult List()
        {
            if (!Directory.Exists(ResultsDir))
                return Ok(new { files = Array.Empty<object>() });

            var files = new DirectoryInfo(ResultsDir)
                .GetFiles("*.csv", SearchOption.TopDirectoryOnly)
                .Where(IsOutputFile)
                .OrderByDescending(f => f.LastWriteTime)
                .Select(f => new
                {
                    name         = f.Name,
                    sizeKb       = f.Length / 1024,
                    lastModified = f.LastWriteTime.ToString("o")
                });

            return Ok(new { files });
        }

        // ── GET /api/results/latest ───────────────────────────────────────
        [HttpGet("latest")]
        public IActionResult DownloadLatest()
        {
            var file = LatestCsv();
            if (file == null)
                return NotFound(new { Status = "Error", Message = "No simulation output found." });

            return PhysicalFile(file.FullName, "text/csv", file.Name);
        }

        // ── GET /api/results/latest/json ──────────────────────────────────
        /// <summary>
        /// Converte il CSV più recente in un array JSON.
        /// Ogni elemento è un oggetto con i nomi delle colonne come chiavi.
        /// Query params: ?maxRows=N (default: nessun limite)
        /// </summary>
        [HttpGet("latest/json")]
        public IActionResult LatestAsJson([FromQuery] int? maxRows = null)
        {
            var file = LatestCsv();
            if (file == null)
                return NotFound(new { Status = "Error", Message = "No simulation output found." });

            return Ok(CsvToJson(file.FullName, maxRows));
        }

        // ── GET /api/results/{filename} ───────────────────────────────────
        [HttpGet("{filename}")]
        public IActionResult Download(string filename)
        {
            // Sicurezza: no directory traversal
            if (filename.Contains("..") || Path.IsPathRooted(filename))
                return BadRequest("Invalid filename.");

            string path = Path.Combine(ResultsDir, filename);
            if (!System.IO.File.Exists(path))
                return NotFound(new { Status = "Error", Message = $"File '{filename}' not found." });

            return PhysicalFile(path, "text/csv", filename);
        }

        // ── GET /api/results/{filename}/json ──────────────────────────────
        [HttpGet("{filename}/json")]
        public IActionResult FileAsJson(string filename, [FromQuery] int? maxRows = null)
        {
            if (filename.Contains("..") || Path.IsPathRooted(filename))
                return BadRequest("Invalid filename.");

            string path = Path.Combine(ResultsDir, filename);
            if (!System.IO.File.Exists(path))
                return NotFound(new { Status = "Error", Message = $"File '{filename}' not found." });

            return Ok(CsvToJson(path, maxRows));
        }

        // ── DELETE /api/results/{filename} ────────────────────────────────
        [HttpDelete("{filename}")]
        public IActionResult Delete(string filename)
        {
            if (filename.Contains("..") || Path.IsPathRooted(filename))
                return BadRequest("Invalid filename.");

            string path = Path.Combine(ResultsDir, filename);
            if (!System.IO.File.Exists(path))
                return NotFound(new { Status = "Error", Message = $"File '{filename}' not found." });

            System.IO.File.Delete(path);
            return Ok(new { Status = "OK", Message = $"'{filename}' deleted." });
        }

        // ── CSV → JSON helper ─────────────────────────────────────────────
        private static List<Dictionary<string, string>> CsvToJson(string path, int? maxRows)
        {
            var nfi = (NumberFormatInfo)System.Globalization.CultureInfo.InvariantCulture.NumberFormat.Clone();
            var result = new List<Dictionary<string, string>>();

            using var reader = new StreamReader(path);
            string? headerLine = reader.ReadLine();
            if (headerLine == null) return result;

            string[] headers = headerLine.Split(',');
            int count = 0;

            while (!reader.EndOfStream)
            {
                if (maxRows.HasValue && count >= maxRows.Value) break;

                string? line = reader.ReadLine();
                if (string.IsNullOrWhiteSpace(line)) continue;

                string[] cols  = line.Split(',');
                var row = new Dictionary<string, string>(headers.Length);
                for (int i = 0; i < headers.Length; i++)
                    row[headers[i]] = i < cols.Length ? cols[i] : "";

                result.Add(row);
                count++;
            }

            return result;
        }
    }
}
