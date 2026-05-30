using BreathApi.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowAll", policy =>
        policy.AllowAnyOrigin()
              .AllowAnyMethod()
              .AllowAnyHeader());
});

builder.Services.AddSingleton<OutputService>();

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI(c =>
    {
        c.SwaggerEndpoint("/swagger/v1/swagger.json", "BREATH API v1");
        c.RoutePrefix = "swagger";
    });
}

// Ensure wwwroot and output directories exist
var outputSvc = app.Services.GetRequiredService<OutputService>();
Directory.CreateDirectory(app.Environment.WebRootPath);
outputSvc.EnsureDirectories();
Console.WriteLine($"WebRoot: {app.Environment.WebRootPath}");

app.UseStaticFiles();
app.UseCors("AllowAll");
// UseHttpsRedirection disabled for local dev (avoids SSL certificate issues)
app.UseAuthorization();
app.MapControllers();

// SPA fallback: serve index.html for any non-API route
app.MapFallbackToFile("index.html");

Console.WriteLine("BREATH API ready.");

// Render.com sets PORT; fall back to default for local dev
var port = Environment.GetEnvironmentVariable("PORT") ?? "5244";
app.Run($"http://0.0.0.0:{port}");
