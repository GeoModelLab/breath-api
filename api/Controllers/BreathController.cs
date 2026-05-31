using Microsoft.AspNetCore.Mvc;
using BreathApi.Utils;
using System.Text.Json;
using BreathApi.ModelRunner;
using BreathApi.Services;
using SysFile = System.IO.File;

namespace BreathApi.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class BreathController : ControllerBase
    {
        private readonly IWebHostEnvironment _env;
        private readonly OutputService _outputService;

        public BreathController(IWebHostEnvironment env, OutputService outputService)
        {
            _env = env;
            _outputService = outputService;
        }

        // POST /api/breath/run
        [HttpPost("run")]
        public IActionResult RunModel([FromBody] JsonElement config)
        {
            try
            {
                LogStreamer.Clear();

                string json = JsonSerializer.Serialize(config);

                _outputService.EnsureDirectories();

                string baseUrl = Environment.GetEnvironmentVariable("RENDER") != null
                    ? "https://breath-api-thkm.onrender.com"
                    : $"{Request.Scheme}://{Request.Host}";

                string pixelId = "unknown";
                try
                {
                    var parsed = JsonDocument.Parse(json);
                    if (parsed.RootElement.TryGetProperty("settings", out var s) &&
                        s.TryGetProperty("pixelsRun", out var px) &&
                        px.GetArrayLength() > 0)
                        pixelId = px[0].GetString() ?? "unknown";
                }
                catch { }

                LogStreamer.Log($"[{DateTime.Now:HH:mm:ss}] ▶ Starting simulation for pixel {pixelId}…");
                LogStreamer.SetRunning(pixelId);

                _ = Task.Run(async () =>
                {
                    try
                    {
                        var model = new BreathModel(LogStreamer.Log, _outputService.ResultsDirectory, baseUrl);
                        LogStreamer.Log($"[{DateTime.Now:HH:mm:ss}] ⚙ Initialising model engine…");
                        string resultJson = await model.RunAsync(json);

                        string resultPath = Path.Combine(_outputService.ResultsDirectory, "last_result.json");
                        await SysFile.WriteAllTextAsync(resultPath, resultJson);

                        LogStreamer.SetCompleted();
                        LogStreamer.Log($"[{DateTime.Now:HH:mm:ss}] ✅ Simulation complete — results ready.");
                    }
                    catch (Exception ex)
                    {
                        LogStreamer.SetFailed();
                        LogStreamer.Log($"ERROR: {ex.Message}");
                    }
                });

                return Ok(new { Status = "Running", Message = "Simulation started.", PixelId = pixelId });
            }
            catch (Exception ex)
            {
                LogStreamer.Log($"ERROR: {ex.Message}");
                return StatusCode(500, new { Status = "Error", Message = ex.Message });
            }
        }

        // POST /api/breath/stop
        [HttpPost("stop")]
        public IActionResult Stop()
        {
            if (LogStreamer.Status != BreathApi.Utils.SimulationState.Running)
                return Ok(new { Status = "NotRunning" });
            LogStreamer.RequestStop();
            return Ok(new { Status = "Stopped" });
        }

        // GET /api/breath/status
        [HttpGet("status")]
        public IActionResult GetStatus()
        {
            return Ok(new
            {
                Status        = LogStreamer.Status.ToString(),
                PixelId       = LogStreamer.LastPixelId,
                StartedAt     = LogStreamer.LastRunStarted,
                FinishedAt    = LogStreamer.LastRunFinished,
                DurationMs    = LogStreamer.LastRunStarted.HasValue
                    ? (int)(LogStreamer.LastRunFinished ?? DateTime.UtcNow)
                        .Subtract(LogStreamer.LastRunStarted.Value).TotalMilliseconds
                    : (int?)null
            });
        }

        // GET /api/breath/stream/logs  — Server-Sent Events
        [HttpGet("stream/logs")]
        public async Task StreamLogs(CancellationToken token)
        {
            Response.ContentType = "text/event-stream";
            Response.Headers.Append("Cache-Control", "no-cache");
            Response.Headers.Append("X-Accel-Buffering", "no");

            await foreach (var msg in LogStreamer.StreamAsync(token))
            {
                string escaped = msg.Replace("\n", "\\n").Replace("\r", "");
                await Response.WriteAsync($"data: {escaped}\n\n", token);
                await Response.Body.FlushAsync(token);
            }
        }
    }
}
