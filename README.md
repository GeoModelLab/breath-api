# BREATH

**Biologically Realistic Ecosystem and Atmosphere Transpiration and Humidity** model.

BREATH simulates hourly carbon fluxes (GPP, RECO, NEE) and phenology dynamics
for forest ecosystems using a mechanistic two-layer canopy approach.
It drives phenology through the SWELL sub-model and carbon exchanges through
a VPRM-based framework with Lloyd-Taylor respiration.

---

## Repository layout

```
breath/
├── core/               # Model source code (shared library)
│   ├── source/         # Biophysical functions (exchanges, phenology, VI dynamics)
│   ├── optimizer/      # Multi-start simplex optimiser
│   └── runner/         # Async model runner + data downloaders (NASA POWER, MODIS EVI)
│
├── api/                # ASP.NET Core 8 REST API
│   ├── Controllers/    # /api/breath, /api/parameters, /api/results
│   ├── ModelRunner/    # BreathModel wrapper (calls BreathRunner)
│   └── wwwroot/        # Static files + simulation output (gitignored)
│
├── webapp/             # R Shiny web application
│   └── app.R           # Single-file Shiny app (calls the REST API)
│
└── breath.sln          # Visual Studio solution
```

---

## Getting started

### Prerequisites
- .NET 8 SDK
- R ≥ 4.2 with packages: `shiny`, `httr2`, `plotly`, `dplyr`, `lubridate`

### Run the API locally

```bash
cd api
dotnet run
# API is available at http://localhost:5244
# Swagger UI at http://localhost:5244/swagger
```

### Run the Shiny webapp

```r
# In R, with the API already running:
shiny::runApp("webapp/app.R")
```

### Run a simulation (API)

```bash
curl -X POST http://localhost:5244/api/breath/run \
  -H "Content-Type: application/json" \
  -d @core/runner/BreathConfig.json
```

---

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/breath/run` | Start a simulation |
| GET | `/api/breath/status` | Poll running simulation status |
| GET | `/api/parameters` | List model parameters |
| POST | `/api/parameters` | Update parameter values |
| GET | `/api/results/list` | List available output files |
| GET | `/api/results/latest/json` | Latest result as JSON array |
| GET | `/api/results/{filename}` | Download a specific CSV |
| DELETE | `/api/results/{filename}` | Delete a specific CSV |

---

## Configuration (BreathConfig.json)

```json
{
  "settings": {
    "startYear": 2015,
    "endYear": 2022,
    "calibration": false,
    "calibrationVariable": "Phenology",
    "simplexes": 5,
    "iterations": 500,
    "inputWeather": "daily",
    "parametersDataFile": "photothermalRequirements.csv",
    "pixelsRun": ["45.65_12.45"]
  }
}
```

---

## Production deployment

The API is deployed on [Render](https://render.com) at
`https://breath-api-thkm.onrender.com`.

Set the `RENDER` environment variable to any non-empty string to activate
production paths and URLs.

---

## Citation

If you use BREATH in your research, please cite:

> Bregaglio S. et al. (in review). *BREATH: a mechanistic model for ecosystem
> carbon flux simulation beyond the satellite record*. Nature Geoscience.
