using Microsoft.AspNetCore.Mvc;

namespace api.Controllers;

[ApiController]
[Route("api/landcover")]
public class LandCoverController : ControllerBase
{
    private static readonly HttpClient _http = new()
    {
        Timeout = TimeSpan.FromSeconds(12),
        DefaultRequestHeaders = { { "User-Agent", "BREATH-API/1.0" } }
    };

    private const string WMS_BASE =
        "https://services.terrascope.be/wms/v2?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap" +
        "&LAYERS=WORLDCOVER_2021_MAP&FORMAT=image/png&TRANSPARENT=true&SRS=EPSG:3857";

    // 1×1 transparent PNG returned when the upstream is unavailable
    private static readonly byte[] _transparent = Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQ" +
        "AABjkB6QAAAABJRU5ErkJggg==");

    /// <summary>Proxy WorldCover WMS tile as XYZ — used by the forest-mask layer.</summary>
    [HttpGet("tile/{z}/{x}/{y}.png")]
    [ResponseCache(Duration = 86400, Location = ResponseCacheLocation.Any)]
    public async Task<IActionResult> Tile(int z, int x, int y)
    {
        var bbox = TileToBbox(x, y, z);
        var url  = $"{WMS_BASE}&WIDTH=256&HEIGHT=256&BBOX={bbox}";
        return await ProxyImage(url, 256, 256);
    }

    /// <summary>Proxy WorldCover WMS tile with custom size — used by the spotlight canvas layer.</summary>
    [HttpGet("wms")]
    [ResponseCache(Duration = 86400, Location = ResponseCacheLocation.Any)]
    public async Task<IActionResult> Wms([FromQuery] int w = 256, [FromQuery] int h = 256,
                                         [FromQuery] string? bbox = null)
    {
        if (string.IsNullOrWhiteSpace(bbox)) return BadRequest("bbox required");
        var url = $"{WMS_BASE}&WIDTH={w}&HEIGHT={h}&BBOX={bbox}";
        return await ProxyImage(url, w, h);
    }

    /// <summary>Proxy WorldCover GetFeatureInfo — returns land cover class at a lat/lon point.</summary>
    [HttpGet("featureinfo")]
    public async Task<IActionResult> FeatureInfo([FromQuery] double lat, [FromQuery] double lon)
    {
        var bbox = FormattableString.Invariant($"{lon-.001},{lat-.001},{lon+.001},{lat+.001}");
        var url  = "https://services.terrascope.be/wms/v2?SERVICE=WMS&VERSION=1.1.1"
                 + "&REQUEST=GetFeatureInfo&LAYERS=WORLDCOVER_2021_MAP&QUERY_LAYERS=WORLDCOVER_2021_MAP"
                 + $"&BBOX={bbox}&WIDTH=3&HEIGHT=3&X=1&Y=1&SRS=EPSG:4326&INFO_FORMAT=application/json";
        try
        {
            var json = await _http.GetStringAsync(url);
            return Content(json, "application/json");
        }
        catch { return NotFound(); }
    }

    private async Task<IActionResult> ProxyImage(string url, int w, int h)
    {
        try
        {
            var bytes = await _http.GetByteArrayAsync(url);
            return File(bytes, "image/png");
        }
        catch
        {
            return File(_transparent, "image/png");
        }
    }

    // Convert XYZ tile indices to EPSG:3857 BBOX string
    private static string TileToBbox(int x, int y, int z)
    {
        const double R = 20037508.342789244;
        double n    = Math.Pow(2, z);
        double minX = x       / n * 2 * R - R;
        double maxX = (x + 1) / n * 2 * R - R;
        double maxY = R - y       / n * 2 * R;
        double minY = R - (y + 1) / n * 2 * R;
        return FormattableString.Invariant($"{minX},{minY},{maxX},{maxY}");
    }
}
