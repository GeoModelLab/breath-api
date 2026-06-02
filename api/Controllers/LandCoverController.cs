using Microsoft.AspNetCore.Mvc;

namespace api.Controllers;

/// <summary>
/// Proxies the Terrascope WorldCover WMS GetFeatureInfo to check land cover class at a point.
/// Tile display now uses NASA GIBS directly from the browser (no proxy needed).
/// </summary>
[ApiController]
[Route("api/landcover")]
public class LandCoverController : ControllerBase
{
    private static readonly HttpClient _http = new()
    {
        Timeout = TimeSpan.FromSeconds(10),
        DefaultRequestHeaders = { { "User-Agent", "BREATH-API/1.0" } }
    };

    /// <summary>Returns land cover class at a lat/lon point (MODIS IGBP class number).</summary>
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
}
