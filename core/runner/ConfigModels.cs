using System.Collections.Generic;

namespace runner
{
    /// <summary>
    /// Root object matching the BreathConfig.json structure.
    /// </summary>
    public class root
    {
        public settings? settings { get; set; }
        /// <summary>Optional flat key→value overrides applied on top of the parameters CSV.</summary>
        public Dictionary<string, float>? parameterOverrides { get; set; }
    }

    /// <summary>
    /// All simulation settings read from BreathConfig.json.
    /// Fields are typed as <c>object</c> to tolerate JSON values that arrive
    /// as either strings or numbers depending on the caller.
    /// </summary>
    public class settings
    {
        public object startYear { get; set; }
        public object endYear { get; set; }
        /// <summary>true = run calibration; false = run with existing calibrated params.</summary>
        public object calibration { get; set; }
        public object simplexes { get; set; }
        public object iterations { get; set; }
        public object timestep { get; set; }
        /// <summary>Filename of the photothermal requirements CSV (relative to wwwroot/data/parametersData/).</summary>
        public object parametersDataFile { get; set; }
        /// <summary>List of pixel identifiers in "lat_lon" format, e.g. "45.5_12.3".</summary>
        public List<string> pixelsRun { get; set; }
        public object parametersValidationFile { get; set; }
        /// <summary>"Phenology", "Photosynthesis", or "Respiration".</summary>
        public object calibrationVariable { get; set; }
        /// <summary>"daily" or "hourly" — controls NASA POWER request resolution.</summary>
        public object inputWeather { get; set; }
        /// <summary>"Baseline", "Pheno", or "Circadian" — controls model variant.</summary>
        public object modelVariant { get; set; }
    }
}
