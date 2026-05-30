using Microsoft.AspNetCore.Mvc;
using System.Globalization;

namespace BreathApi.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class ParametersController : ControllerBase
    {
        private readonly string csvPath;

        public ParametersController(IWebHostEnvironment env)
        {
            csvPath = Path.Combine(
                env.WebRootPath, "data", "parametersData", "photothermalRequirements.csv"
            );
        }

        // ✅ GET /api/parameters
        [HttpGet]
        public IActionResult GetParameters()
        {
            if (!System.IO.File.Exists(csvPath))
                return NotFound($"File not found: {csvPath}");

            var lines = System.IO.File.ReadAllLines(csvPath);
            if (lines.Length <= 1)
                return Ok(new { message = "Empty file." });

            var headers = lines[0].Split(',');
            var data = lines.Skip(1)
                .Select(line =>
                {
                    var cols = line.Split(',');
                    return new Dictionary<string, string>
                    {
                        ["class"] = cols.ElementAtOrDefault(0),
                        ["parameter"] = cols.ElementAtOrDefault(1),
                        ["min"] = cols.ElementAtOrDefault(2),
                        ["max"] = cols.ElementAtOrDefault(3),
                        ["value"] = cols.ElementAtOrDefault(4),
                        ["calibration"] = cols.ElementAtOrDefault(5)
                    };
                })
                .ToList();

            return Ok(data);
        }

        // ✅ POST /api/parameters
        // Body example:
        // [
        //   { "class": "parGrowth", "parameter": "thermalThreshold", "value": "30", "calibration": "x" }
        // ]
        [HttpPost]
        public IActionResult UpdateParameters([FromBody] List<Dictionary<string, string>> updates)
        {
            if (updates == null || updates.Count == 0)
                return BadRequest("Empty update list.");

            if (!System.IO.File.Exists(csvPath))
                return NotFound($"File not found: {csvPath}");

            var lines = System.IO.File.ReadAllLines(csvPath).ToList();
            var header = lines[0];
            var rows = lines.Skip(1).ToList();

            foreach (var update in updates)
            {
                var className = update.GetValueOrDefault("class");
                var paramName = update.GetValueOrDefault("parameter");
                var newVal = update.GetValueOrDefault("value");
                var newCal = update.GetValueOrDefault("calibration");

                for (int i = 0; i < rows.Count; i++)
                {
                    var cols = rows[i].Split(',');
                    if (cols[0] == className && cols[1] == paramName)
                    {
                        if (!string.IsNullOrWhiteSpace(newVal)) cols[4] = newVal;
                        if (!string.IsNullOrWhiteSpace(newCal)) cols[5] = newCal;
                        rows[i] = string.Join(",", cols);
                        break;
                    }
                }
            }

            // Riscrivi il file aggiornato
            System.IO.File.WriteAllLines(csvPath, new[] { header }.Concat(rows));

            return Ok(new { Status = "OK", Message = "Parameters updated successfully." });
        }
    }
}
