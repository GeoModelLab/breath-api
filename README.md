# BREATH

A process-based framework for simulating hourly carbon fluxes (GPP, RECO, NEE) and phenology dynamics in temperate deciduous forests.

BREATH builds on the conceptual structure of the Vegetation Photosynthesis and Respiration Model (VPRM; Mahadevan et al. 2008) but departs substantially from it. It implements a two-layer canopy (overstory + understory), Lloyd-Taylor temperature-sensitive respiration, the SWELL phenology sub-model (Bajocco et al. 2025) for EVI trajectory reconstruction, phenological regulation of carbon fluxes through light-use efficiency and respiration scalars (ϕphoto, ϕresp), a two-pool labile carbon substrate that couples autotrophic respiration to antecedent photosynthetic activity, and an optional circadian activation function (Cact) that introduces endogenous biological rhythms into both photosynthesis and respiration.

Live demo: **https://breath-api-thkm.onrender.com**

### Examples

| Format | Link |
|--------|------|
| Python notebook | [View on GitHub ↗](https://github.com/GeoModelLab/breath-api/blob/main/examples/breath_api_demo.ipynb) |
| R vignette | [View rendered HTML ↗](https://breath-api-thkm.onrender.com/docs/breath_api_demo.html) · [source Rmd](https://github.com/GeoModelLab/breath-api/blob/main/examples/breath_api_demo.Rmd) |

---

## Model description

### Three configurations

BREATH can be run in three nested configurations of increasing complexity:

| Configuration | Description |
|---------------|-------------|
| **Baseline** | EVI acts as an instantaneous driver of GPP light-use efficiency; Lloyd-Taylor RECO; no phenological regulation or circadian modulation |
| **Pheno** | Adds SWELL phenology: ϕphoto (0–1) scales photosynthetic capacity across phenophases; ϕresp (≥1) elevates respiratory demand during construction growth and senescence; autotrophic respiration is coupled to a two-pool labile carbon substrate |
| **Circadian** | Extends Pheno with Cact, a cosine-based circadian activation function (range −1 to +1) that peaks ~1 h before sunrise and reaches its minimum near sunset, modulating effective α and baseline respiration via βphoto and βresp parameters |

### Phenological phases (SWELL)

SWELL reconstructs EVI trajectories from MODIS time series under temperature and photoperiod constraints and infers four phenological transition dates per year:

| Date | Event |
|------|-------|
| **SGS** | Start of growing season (onset of photosynthetic activity) |
| **MAT** | Maturity / maximum canopy development |
| **SEN** | Onset of senescence |
| **EGS** | End of growing season (canopy dormancy) |

These dates define four phenological phases used to compute ϕphoto and ϕresp scalars:
- **Dormancy** — EGS to next SGS
- **Growth** — SGS to MAT
- **Greendown** — MAT to SEN
- **Senescence** — SEN to EGS

### Performance (Bregaglio et al. 2026, under review)

The model was evaluated across 43 eddy covariance tower sites from the ICOS network (~535 site-years, ~4.5 million hourly observations):

- **Pheno** configuration reduces NEE RMSE by **15.8%** relative to Baseline at tower scale (up to **16%** in reanalysis mode).
- **Circadian** configuration improves diurnal GPP accuracy by **+18%** and reduces RECO error by **+33%** relative to Pheno.

---

## Repository layout

```
breath-api/
├── core/                      # Model engine (C# .NET 8)
│   ├── source/                # Biophysical functions
│   │   ├── functions/
│   │   │   ├── exchanges/     # Carbon flux model (GPP, RECO, NEE)
│   │   │   └── phenology/     # SWELL phenology model
│   │   ├── data/              # Input / output data structures
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
│       ├── docs/              # Rendered vignette (R HTML)
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
├── examples/                  # Python notebook + R vignette
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

Open the browser, click a forest pixel on the map, set the time range (default 2022–2025) and hit **Run**.
Results appear as interactive charts with KPIs directly in the browser.

---

## Web UI features

### Map interaction

| Action | Result |
|--------|--------|
| **Click** on forest pixel | Select single point |
| **⬚ Area** drag | Draw a multi-pixel grid (up to 25 pixels) |
| **Forest mask** toggle | Show/hide ESA WorldCover 2021 land-cover layer |
| Click land-cover legend row | Spotlight that land-cover class on the map |

### Single-point simulation

- Marker enriched with **reverse geocoding** (place name, municipality, country) via Nominatim.
- After the run, the marker is replaced by a coloured circle showing annual GPP/RECO/NEE and the Köppen-Geiger climate code. Clicking the circle reopens the result panel.
- Multiple simulated points are **kept on the map** so you can re-consult any of them.

### Grid (multi-pixel) simulation

- Each grid cell is drawn as a **pixel rectangle** (matching the ~0.1° NASA POWER resolution).
- After the run, rectangles are coloured by the selected variable (**NEE / GPP / RECO**) via the dropdown in the map toolbar. Click a rectangle to see its full KPI popup.

### Results panel

| Section | Description |
|---------|-------------|
| **Metric cards** | Annual NEE, GPP, RECO, CUE, inter-annual CV% of NEE |
| **Mean flux by phenological phase** | Average GPP / RECO / NEE (g C m⁻² d⁻¹) during Growth, Greendown, Senescence, and Dormancy |
| **Climate strip** | Full Köppen-Geiger code · seasonal T & P · monthly mini-chart |
| **Annual summary** | Per-year GPP / RECO / NEE / CUE / mean T / total P with sink/source badge |
| **Phenological dates** | SGS · MAT · SEN · EGS · GSL per year (DOY) |
| **SWELL / FLUXES charts** | Interactive Chart.js time series (daily or hourly, zoom/pan with synced axes) |
| **🌐 3D surface** | Plotly.js surface of any variable on DOY × Hour axes |

---

## API reference

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/breath/run` | Start a simulation |
| `GET`  | `/api/breath/status` | Poll running simulation status |
| `GET`  | `/api/breath/stream/logs` | Server-Sent Events log stream |
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
    "startYear":           2022,
    "endYear":             2025,
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

`inputWeather` accepts:
- `"daily"` — NASA POWER daily data disaggregated to hourly profiles via sinusoidal functions
- `"hourly"` — Native NASA POWER hourly data with per-hour Priestley–Taylor ET₀

`pixelsRun` contains one or more pixel identifiers in `"lat_lon"` format (decimal, dot-separated).

---

## Output CSV columns

| Column | Unit | Description |
|--------|------|-------------|
| `pixel` | — | `lat_lon` identifier |
| `date` | yyyy-mm-dd | Calendar date |
| `year` / `hour` | — | Year and 1-based hour of day |
| `t` | °C | Air temperature |
| `p` | mm h⁻¹ | Precipitation |
| `sw` | W m⁻² | Shortwave radiation |
| `rh` | % | Relative humidity |
| `vpd` | kPa | Vapour pressure deficit |
| `et0` | mm h⁻¹ | Reference evapotranspiration (Priestley–Taylor) |
| `phenoPhase` | — | Phenological phase name |
| `SWELL` | EVI | Simulated vegetation index |
| `reference` | EVI | MODIS EVI composite (sparse) |
| `phiPhoto` | 0–1 | Phenological scaler on photosynthetic capacity |
| `phiResp` | ≥1 | Phenological scaler on respiratory demand |
| `Cact` | −1 to 1 | Circadian activation function (Circadian config only) |
| `tscale` / `PARscale` / `waterStress` / … | 0–1 | Environmental scalers |
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

## References

- Bajocco S. et al. (2025). SWELL: a process-based model for phenological reconstruction from remote sensing. *Journal of Geophysical Research: Biogeosciences*.
- Mahadevan P. et al. (2008). A satellite-based biosphere parameterization for net ecosystem CO₂ exchange: Vegetation Photosynthesis and Respiration Model (VPRM). *Global Biogeochemical Cycles*, 22, GB2005.

## Citation

If you use BREATH in your research, please cite:

> Bregaglio S. et al. (2026, under review). *Endogenous rhythms set the tempo of carbon exchange in temperate deciduous forests.*
