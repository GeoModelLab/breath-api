# BREATH

**Biologically Realistic Ecosystem and Atmosphere Transpiration and Humidity** model.

BREATH simulates hourly carbon fluxes (GPP, RECO, NEE) and phenology dynamics
for forest ecosystems using a mechanistic two-layer canopy approach.
Carbon exchanges are modelled with a VPRM-based framework (Lloyd-Taylor respiration);
phenology is driven by the SWELL sub-model (6 phases: dormancy induction → endodormancy →
ecodormancy → growth → greendown → senescence).

Live demo: **https://breath-api-thkm.onrender.com**

### Examples

| Format | Link |
|--------|------|
| Python notebook | [![nbviewer](https://raw.githubusercontent.com/jupyter/design/master/logos/Badges/nbviewer_badge.svg)](https://nbviewer.org/github/GeoModelLab/breath-api/blob/main/examples/breath_api_demo.ipynb) |
| R vignette | [View on GitHub](https://github.com/GeoModelLab/breath-api/blob/main/examples/breath_api_demo.Rmd) · render locally with `rmarkdown::render("examples/breath_api_demo.Rmd")` |

---

## Repository layout

```
breath-api/
├── core/                      # Model engine (C# .NET 8)
│   ├── source/                # Biophysical functions
│   │   ├── functions/
│   │   │   ├── exchanges/     # VPRM carbon flux model (GPP, RECO, NEE)
│   │   │   └── phenology/     # SWELL phenology model
│   │   ├── data/              # input / output data structures
│   │   ├── utils.cs           # Core utilities (ET₀, PAR, water stress, …)
│   │   └── NDVIdynamics.cs    # EVI / NDVI dynamics during phenophases
│   ├── runner/
│   │   ├── BreathRunner.cs    # Async multi-pixel orchestrator
│   │   ├── NASA_caller.cs     # NASA POWER weather downloader (daily & hourly)
│   │   ├── ModisEviPoint.cs   # MODIS EVI composite fetcher (ORNL DAAC)
│   │   ├── optimizer.cs       # Multi-start simplex calibration + CSV output
│   │   └── readers/
│   │       └── weatherReader.cs  # Local weather file reader + ET₀ functions
│   └── optimizer/             # Nelder-Mead simplex optimiser
│
├── api/                       # ASP.NET Core 8 REST API
│   ├── Controllers/           # /api/breath  /api/parameters  /api/results
│   ├── ModelRunner/           # BreathModel wrapper (calls BreathRunner)
│   └── wwwroot/               # Self-contained Vue 3 single-page application
│       ├── index.html
│       ├── style.css
│       └── js/
│           ├── app.js                    # Root Vue app
│           ├── api.js                    # REST client helpers
│           └── components/
│               ├── MapPanel.js           # Leaflet map, point & grid selection
│               ├── ControlPanel.js       # Run configuration form
│               ├── ResultsPanel.js       # Charts (Chart.js), KPIs, 3D surface (Plotly)
│               ├── ParameterPanel.js     # Model parameter editor
│               ├── LogPanel.js           # Live simulation log
│               └── HelpPanel.js          # Tutorial modal
│
└── breath.sln                 # Visual Studio solution
```

---

## Getting started

### Prerequisites

- **.NET 8 SDK** — https://dotnet.microsoft.com/download
- No additional dependencies: the frontend is plain HTML/JS served by the API.

### Run locally

```bash
cd api
dotnet run
# Web UI  → http://localhost:5244
# Swagger → http://localhost:5244/swagger
```

Open the browser, click a forest pixel on the map, set the time range and hit **Run**.
Results appear as interactive charts with KPIs directly in the browser.

---

## Web UI features

### Map interaction
| Action | Result |
|--------|--------|
| **Click** on forest pixel | Select single point |
| **⬚ Area** drag | Draw a multi-pixel grid (up to 25 pixels) |
| **Forest mask** toggle | Show/hide ESA WorldCover 2021 forest layer |
| Click land-cover legend row | Spotlight that land-cover class on the map |

### Single-point simulation
- Marker enriched with **reverse geocoding** (place name, municipality, country) via Nominatim.
- After the run, the marker is replaced by a coloured circle showing annual GPP/RECO/NEE and
  the Köppen-Geiger climate code.  Clicking the circle reopens the result panel.
- Multiple simulated points are **kept on the map** so you can re-consult any of them.

### Grid (multi-pixel) simulation
- Each grid cell is drawn as a **pixel rectangle** (matching the ~0.1° NASA POWER resolution).
- After the run, rectangles are coloured by the selected variable (**NEE / GPP / RECO**) via the
  dropdown in the map toolbar.  Click a rectangle to see its full KPI popup.

### Results panel
| Section | Description |
|---------|-------------|
| **Metric cards** | Annual NEE, GPP, RECO, peak GPP, CUE, inter-annual CV% of NEE |
| **Climate strip** | Full Köppen-Geiger code · seasonal T & P · monthly mini-chart |
| **Annual summary** | Per-year GPP / RECO / NEE / CUE / mean T / total P with sink/source badge |
| **Phenological dates** | SGS · MAT · SEN · EGS · GSL per year (DOY) |
| **SWELL / FLUXES charts** | Interactive Chart.js time series (daily or hourly, zoom/pan) |
| **🌐 3D surface** | Plotly.js surface of any variable on DOY × Hour axes |

---

## API reference

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/breath/run` | Start a simulation |
| `GET`  | `/api/breath/status` | Poll running simulation status |
| `POST` | `/api/breath/stop` | Stop a running simulation |
| `GET`  | `/api/parameters` | List model parameters |
| `POST` | `/api/parameters` | Update parameter values |
| `GET`  | `/api/results/list` | List available output files |
| `GET`  | `/api/results/latest` | Download latest result CSV |
| `GET`  | `/api/results/latest/json` | Latest result as JSON array |
| `GET`  | `/api/results/{filename}` | Download a specific CSV |
| `DELETE` | `/api/results/{filename}` | Delete a specific CSV |

### Run payload (`POST /api/breath/run`)

```json
{
  "settings": {
    "startYear":           2015,
    "endYear":             2022,
    "calibration":         false,
    "calibrationVariable": "Phenology",
    "simplexes":           5,
    "iterations":          500,
    "inputWeather":        "daily",
    "parametersDataFile":  "photothermalRequirements.csv",
    "pixelsRun":           ["45.65_12.45"]
  }
}
```

`inputWeather` accepts `"daily"` (NASA POWER daily disaggregated to hourly) or
`"hourly"` (native NASA POWER hourly, with per-hour Priestley–Taylor ET₀).

---

## Output CSV columns

| Column | Unit | Description |
|--------|------|-------------|
| `pixel` | — | `lat_lon` identifier |
| `date` | yyyy-mm-dd | Calendar date |
| `year` / `hour` | — | Year and 1-based hour |
| `t` | °C | Air temperature |
| `p` | mm h⁻¹ | Precipitation |
| `sw` | W m⁻² | Shortwave radiation |
| `rh` | % | Relative humidity |
| `vpd` | kPa | Vapour pressure deficit |
| `et0` | mm h⁻¹ | Reference evapotranspiration (Priestley–Taylor) |
| `phenoPhase` | — | Phenological phase name |
| `SWELL` | EVI | Simulated vegetation index |
| `reference` | EVI | MODIS EVI composite (sparse) |
| `tscale` / `PARscale` / `waterStress` / … | 0–1 | Model scalers |
| `GPP` / `RECO` / `NEE` | µmol m⁻² s⁻¹ | Carbon fluxes |

---

## Weather data sources

| Source | `inputWeather` value | Resolution |
|--------|---------------------|------------|
| NASA POWER daily (disaggregated) | `"daily"` | Daily scalars → sinusoidal hourly profiles |
| NASA POWER hourly | `"hourly"` | Native hourly T, RH, radiation, precipitation |
| Local CSV (ICOS/ERA5) | `"nasaPowerDaily"` or `"hourlyNASA_ERA5"` | As stored |

ET₀ computation:
- **Daily path** — Hargreaves–Samani from daily Tmax/Tmin and Ra.
- **Hourly path** — Priestley–Taylor per hour from measured radiation; falls back to Hargreaves–Samani when radiation is missing.

---

## Deployment

The API is deployed on [Render](https://render.com):
`https://breath-api-thkm.onrender.com`

Set the `RENDER` environment variable (any non-empty value) to activate production paths.

Docker build:

```bash
docker build -t breath-api .
docker run -p 5244:5244 breath-api
```

---

## Citation

If you use BREATH in your research, please cite:

> Bregaglio S. et al. (in review). *BREATH: a mechanistic model for ecosystem
> carbon flux simulation beyond the satellite record*. Nature Geoscience.
