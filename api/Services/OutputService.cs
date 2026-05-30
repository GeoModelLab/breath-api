namespace BreathApi.Services
{
    public class OutputService
    {
        private readonly IWebHostEnvironment _env;

        public OutputService(IWebHostEnvironment env)
        {
            _env = env;
        }

        public string WebRoot =>
            _env.WebRootPath ?? Path.Combine(AppContext.BaseDirectory, "wwwroot");

        public string ResultsDirectory =>
            Path.Combine(WebRoot, "output", "results");

        public string LogsDirectory =>
            Path.Combine(WebRoot, "output", "logs");

        public string CacheDirectory =>
            Path.Combine(WebRoot, "cache");

        public void EnsureDirectories()
        {
            Directory.CreateDirectory(ResultsDirectory);
            Directory.CreateDirectory(LogsDirectory);
            Directory.CreateDirectory(CacheDirectory);
        }

        public IEnumerable<FileInfo> ListResultFiles() =>
            Directory.Exists(ResultsDirectory)
                ? new DirectoryInfo(ResultsDirectory)
                    .GetFiles("*.csv")
                    .Where(f => !f.Name.StartsWith("weather_", StringComparison.OrdinalIgnoreCase) &&
                                !f.Name.StartsWith("calibParam_", StringComparison.OrdinalIgnoreCase))
                    .OrderByDescending(f => f.LastWriteTime)
                : Enumerable.Empty<FileInfo>();
    }
}
