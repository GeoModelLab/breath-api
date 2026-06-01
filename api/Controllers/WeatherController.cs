using Microsoft.AspNetCore.Mvc;
using BreathApi.Services;

namespace BreathApi.Controllers
{
    /// <summary>
    /// Custom weather upload endpoint.
    ///
    /// POST /api/weather/upload?pixel=LAT_LON
    ///   Body: text/csv — daily weather file with columns:
    ///   Date,PAR,airTemperatureMaximum,airTemperatureMinimum,
    ///   solarRadiation,dewPointTemperature,precipitation,latitude
    ///
    /// The uploaded file is stored as {pixel}_weather.csv in the results
    /// directory.  BreathRunner automatically uses it for that pixel if it
    /// covers the requested year range, skipping the NASA POWER download.
    ///
    /// DELETE /api/weather/{pixel}
    ///   Removes a previously uploaded custom weather file.
    ///
    /// GET /api/weather/list
    ///   Returns the list of pixels that have a cached weather file.
    ///
    /// GET /api/weather/template
    ///   Returns a minimal CSV template showing the expected column format.
    /// </summary>
    [ApiController]
    [Route("api/[controller]")]
    public class WeatherController : ControllerBase
    {
        private readonly OutputService _outputService;

        public WeatherController(OutputService outputService)
        {
            _outputService = outputService;
        }

        private string ResultsDir => _outputService.ResultsDirectory;

        // POST /api/weather/upload?pixel=45.6_10.2
        [HttpPost("upload")]
        [Consumes("text/plain", "text/csv", "application/octet-stream", "multipart/form-data")]
        public async Task<IActionResult> Upload([FromQuery] string pixel)
        {
            if (string.IsNullOrWhiteSpace(pixel))
                return BadRequest(new { Status = "Error", Message = "Query parameter 'pixel' is required (format: LAT_LON, e.g. 45.6_10.2)" });

            // Sanitise pixel ID — allow digits, dot, underscore, minus only
            if (!System.Text.RegularExpressions.Regex.IsMatch(pixel, @"^-?\d+(\.\d+)?_-?\d+(\.\d+)?$"))
                return BadRequest(new { Status = "Error", Message = "Invalid pixel format. Use LAT_LON with dot-decimal (e.g. 45.65_10.23)." });

            string csv;

            if (Request.HasFormContentType && Request.Form.Files.Count > 0)
            {
                var file = Request.Form.Files[0];
                using var sr = new System.IO.StreamReader(file.OpenReadStream());
                csv = await sr.ReadToEndAsync();
            }
            else
            {
                using var sr = new System.IO.StreamReader(Request.Body);
                csv = await sr.ReadToEndAsync();
            }

            if (string.IsNullOrWhiteSpace(csv))
                return BadRequest(new { Status = "Error", Message = "Request body is empty." });

            var lines = csv.Trim().Split('\n', StringSplitOptions.RemoveEmptyEntries);
            if (lines.Length < 2)
                return BadRequest(new { Status = "Error", Message = "CSV must contain a header row and at least one data row." });

            var header = lines[0].Trim().ToLowerInvariant();
            if (!header.StartsWith("date"))
                return BadRequest(new { Status = "Error", Message = "First column must be 'Date'. Use GET /api/weather/template to see the expected format." });

            _outputService.EnsureDirectories();
            string dest = System.IO.Path.Combine(ResultsDir, $"{pixel}_weather.csv");
            await System.IO.File.WriteAllTextAsync(dest, csv);

            return Ok(new
            {
                Status  = "OK",
                Message = $"Weather file saved for pixel {pixel}. The next simulation for this pixel will use this data instead of downloading from NASA POWER.",
                Pixel   = pixel,
                Rows    = lines.Length - 1,
                Path    = dest,
            });
        }

        // DELETE /api/weather/{pixel}
        [HttpDelete("{pixel}")]
        public IActionResult Delete(string pixel)
        {
            string path = System.IO.Path.Combine(ResultsDir, $"{pixel}_weather.csv");
            if (!System.IO.File.Exists(path))
                return NotFound(new { Status = "NotFound", Message = $"No weather file found for pixel {pixel}." });
            System.IO.File.Delete(path);
            return Ok(new { Status = "OK", Message = $"Weather file for pixel {pixel} deleted." });
        }

        // GET /api/weather/list
        [HttpGet("list")]
        public IActionResult List()
        {
            if (!System.IO.Directory.Exists(ResultsDir))
                return Ok(new { Status = "OK", Pixels = Array.Empty<string>() });

            var files = System.IO.Directory.GetFiles(ResultsDir, "*_weather.csv")
                .Select(f => System.IO.Path.GetFileNameWithoutExtension(f)
                    .Replace("_weather", "", StringComparison.OrdinalIgnoreCase))
                .OrderBy(p => p)
                .ToArray();

            return Ok(new { Status = "OK", Pixels = files });
        }

        // GET /api/weather/template
        [HttpGet("template")]
        public IActionResult Template()
        {
            const string template =
                "Date,PAR,airTemperatureMaximum,airTemperatureMinimum,solarRadiation,dewPointTemperature,precipitation,latitude\n" +
                "2022-01-01,2.1,3.5,-1.2,5.8,-4.1,0.0,45.65\n" +
                "2022-01-02,2.4,4.1,-0.8,6.2,-3.8,1.2,45.65\n";

            return Content(template, "text/csv");
        }
    }
}
