;(function() {
const { defineComponent, ref } = Vue

const TABS = [
  { id:'start',   icon:'⚡', label:'Quick Start' },
  { id:'map',     icon:'🗺', label:'Map' },
  { id:'model',   icon:'🌿', label:'Model' },
  { id:'results', icon:'📊', label:'Results' },
  { id:'params',  icon:'⚙',  label:'Parameters' },
  { id:'api',     icon:'🔌', label:'API' },
  { id:'about',   icon:'ℹ',  label:'About' },
]

window.HelpPanel = defineComponent({
  name: 'HelpPanel',
  emits: ['close'],

  setup() {
    const tab = ref('start')
    return { tab, TABS }
  },

  template: `
    <div class="help-overlay" @click.self="$emit('close')">
      <div class="help-panel">

        <div class="help-header">
          <span class="help-title">🌲 BREATH — User Guide</span>
          <button class="help-close" @click="$emit('close')">✕</button>
        </div>

        <!-- Tab bar -->
        <div class="help-tabs">
          <button v-for="t in TABS" :key="t.id"
                  :class="['help-tab-btn', tab===t.id && 'active']"
                  @click="tab=t.id">
            <span class="htab-icon">{{ t.icon }}</span>
            <span class="htab-label">{{ t.label }}</span>
          </button>
        </div>

        <div class="help-body">

          <!-- ── Quick Start ── -->
          <template v-if="tab==='start'">
            <div class="help-steps">
              <div class="help-step">
                <span class="step-num">1</span>
                <div>
                  <b>Click on the map</b> to select a deciduous forest pixel.<br>
                  <span class="step-note">The ESA WorldCover overlay highlights land cover classes — target Tree Cover (class 10, dark green).</span>
                </div>
              </div>
              <div class="help-step">
                <span class="step-num">2</span>
                <div>
                  <b>Choose a model variant</b> in the control panel:<br>
                  <span class="step-note">Baseline (no phenology) · Pheno (SWELL active) · Circadian (SWELL + diurnal rhythm)</span>
                </div>
              </div>
              <div class="help-step">
                <span class="step-num">3</span>
                <div>
                  <b>Set the year range</b> (default 2022–2025) and click <b>▶ Run BREATH</b>.<br>
                  <span class="step-note">Weather is downloaded from NASA POWER and cached — re-running the same location is fast.</span>
                </div>
              </div>
              <div class="help-step">
                <span class="step-num">4</span>
                <div>
                  <b>Explore results</b> in the two charts (SWELL + FLUXES).<br>
                  <span class="step-note">Toggle variables on/off with the panel on the right. Ctrl+scroll to zoom the time axis.</span>
                </div>
              </div>
              <div class="help-step">
                <span class="step-num">5</span>
                <div>
                  <b>Adjust parameters</b> with the accordion at the bottom and re-run without re-downloading weather data.
                </div>
              </div>
            </div>
            <div class="help-tip">
              💡 <b>Area simulation:</b> use the <b>⬚ Area</b> button on the map to draw a rectangle and run up to 25 grid pixels simultaneously. Results are shown as colored circles on the map.
            </div>
          </template>

          <!-- ── Map ── -->
          <template v-if="tab==='map'">
            <p class="help-p">The map overlay uses <b>ESA WorldCover 2021</b> (10 m resolution). BREATH is calibrated for deciduous broadleaf forests; select pixels classified as <b>Tree Cover (class 10, dark green)</b> for best results.</p>
            <div class="help-kv">
              <span class="help-k">Single click</span>
              <span class="help-v">Select one pixel for simulation. A marker and lat/lon coordinates appear.</span>
              <span class="help-k">⬚ Area</span>
              <span class="help-v">Click and drag to draw a bounding box. BREATH runs on a regular grid (up to 25 pixels). Results shown as circles scaled by NEE magnitude.</span>
              <span class="help-k">Forest mask</span>
              <span class="help-v">Toggle the ESA WorldCover 2021 overlay on/off.</span>
              <span class="help-k">▤ Legend</span>
              <span class="help-v">Shows ESA WorldCover land-cover classes. Click a class to highlight it on the map (dims everything else).</span>
              <span class="help-k">ESC</span>
              <span class="help-v">Cancel area draw mode.</span>
            </div>
            <div class="help-tip">
              ⚠️ The orange banner <i>"Point may not be in Tree Cover"</i> appears when the selected pixel is not classified as Tree Cover (ESA WorldCover class 10). The model will still run, but results may not be representative.
            </div>
          </template>

          <!-- ── Model ── -->
          <template v-if="tab==='model'">
            <p class="help-p">BREATH (Biophysical Rhythm of Ecosystem Activity &amp; Health) models hourly carbon exchange using three nested components:</p>

            <div class="help-model-variants">
              <div class="hmv-card hmv-baseline">
                <div class="hmv-title">Baseline</div>
                <div class="hmv-desc">EVI is used as an instantaneous driver of carbon flux with no explicit representation of phenological state or circadian regulation. Environmental scalers (T, PAR, VPD, water stress) modulate a two-layer (overstory + understory) GPP. RECO follows Lloyd–Taylor temperature response with water modulation.</div>
              </div>
              <div class="hmv-card hmv-pheno">
                <div class="hmv-title">Pheno</div>
                <div class="hmv-desc">Physiological parameters are continuously modulated by SWELL phenological progression. A photosynthetic scalar ϕ<sub>photo</sub> (0–1) tracks canopy development; a respiratory scalar ϕ<sub>resp</sub> (≥1) captures elevated construction costs during growth and maintenance costs during senescence. Autotrophic respiration is linked to antecedent GPP via a two-pool labile carbon substrate model.</div>
              </div>
              <div class="hmv-card hmv-circadian">
                <div class="hmv-title">Circadian</div>
                <div class="hmv-desc">Pheno + endogenous circadian regulation of both photosynthesis and respiration. Generates realistic morning/afternoon GPP asymmetry (diurnal hysteresis) independently of instantaneous forcing. Circadian regulation provided +18% improvement in diurnal GPP accuracy and +33% for RECO vs Pheno alone.</div>
              </div>
            </div>

            <p class="help-p" style="margin-top:12px"><b>SWELL phenology phases:</b></p>
            <div class="help-kv">
              <span class="help-k">Dormancy induction</span>
              <span class="help-v">Short photoperiod + low temperature → photothermal units accumulate until threshold → leaf drop triggers.</span>
              <span class="help-k">Endodormancy</span>
              <span class="help-v">Deep dormancy. Chilling units accumulate between T<sub>lower</sub> and T<sub>upper</sub> (vernalisation).</span>
              <span class="help-k">Ecodormancy</span>
              <span class="help-v">Chilling satisfied. Heat forcing units accumulate until budburst threshold → spring growth begins.</span>
              <span class="help-k">Growth</span>
              <span class="help-v">Rapid leaf expansion. LAI grows from minimum to maximum, photosynthesis scales with phenologyScale.</span>
              <span class="help-k">Greendown</span>
              <span class="help-v">Canopy at peak. Thermal units continue accumulating until senescence is triggered.</span>
              <span class="help-k">Senescence</span>
              <span class="help-v">Autumn. LAI declines, SWELL value drops toward 0 as leaves fall.</span>
            </div>
          </template>

          <!-- ── Results ── -->
          <template v-if="tab==='results'">
            <p class="help-p">The four <b>metric cards</b> at the top show annual averages (normalised across all simulated years):</p>
            <div class="help-kv">
              <span class="help-k">Annual NEE</span>
              <span class="help-v">Net Ecosystem Exchange. NEE &lt; 0 = carbon sink (absorption). NEE &gt; 0 = carbon source.</span>
              <span class="help-k">Annual GPP</span>
              <span class="help-v">Gross Primary Production — total photosynthesis (overstory + understory).</span>
              <span class="help-k">Annual RECO</span>
              <span class="help-v">Ecosystem Respiration (autotrophic + heterotrophic).</span>
              <span class="help-k">Peak GPP</span>
              <span class="help-v">Maximum hourly GPP in the simulation period (µmol m⁻² s⁻¹).</span>
            </div>

            <p class="help-p" style="margin-top:10px"><b>Two-chart layout:</b></p>
            <div class="help-kv">
              <span class="help-k">SWELL chart</span>
              <span class="help-v">Phenology, scalers and weather. Left axis: 0–1 (dimensionless). Right axis: weather units (°C, W/m², mm, …).</span>
              <span class="help-k">FLUXES chart</span>
              <span class="help-v">GPP, RECO, NEE and components. Left axis: µmol m⁻² s⁻¹.</span>
              <span class="help-k">Toggle variables</span>
              <span class="help-v">Click any variable in the right panel to add/remove it from the corresponding chart. The L/R badge shows which axis it uses.</span>
              <span class="help-k">Ctrl + scroll</span>
              <span class="help-v">Zoom the time axis. Both charts zoom/pan together. ⤢ to reset.</span>
              <span class="help-k">From / To</span>
              <span class="help-v">Date filter. Metric cards update to reflect the filtered period. ✕ to clear.</span>
              <span class="help-k">⬇ CSV</span>
              <span class="help-v">Download the full hourly CSV with all output variables.</span>
            </div>
          </template>

          <!-- ── Parameters ── -->
          <template v-if="tab==='params'">
            <p class="help-p">The <b>Adjust Parameters &amp; Re-run</b> accordion below the charts lets you modify biophysical coefficients and re-simulate without re-downloading weather data.</p>
            <div class="help-kv">
              <span class="help-k">Phenology</span>
              <span class="help-v">SWELL phase thresholds: photoperiod limits, chilling requirements, heat forcing, greendown, senescence.</span>
              <span class="help-k">Photosynthesis</span>
              <span class="help-v">Maximum quantum yield (over/understory), temperature optimum, VPD sensitivity, light saturation, water stress.</span>
              <span class="help-k">Respiration</span>
              <span class="help-v">Basal respiration, Q10 temperature sensitivity, GPP pool allocation, autotrophic / heterotrophic fractions.</span>
              <span class="help-k">Vegetation Index</span>
              <span class="help-v">NVI growth rates controlling simulated NDVI/EVI dynamics in each phenological phase.</span>
            </div>
            <div class="help-tip">
              The slider sets the value between the calibration min and max. The numeric box to the right is directly editable. Parameters marked <b>x</b> in the CSV are included in MODIS EVI calibration.
            </div>
            <p class="help-p" style="margin-top:8px">Enable <b>Calibrate against MODIS EVI</b> in the control panel to automatically fit marked parameters to MODIS Terra/Aqua 16-day EVI composites from ORNL DAAC.</p>
          </template>

          <!-- ── API ── -->
          <template v-if="tab==='api'">
            <p class="help-p">BREATH exposes a simple REST API. Paste the endpoint into any HTTP client, Python script, or R session.</p>

            <div class="help-kv">
              <span class="help-k">POST /api/breath/run</span>
              <span class="help-v">Start a simulation. Returns immediately; poll <code>/api/breath/status</code> for completion.</span>
              <span class="help-k">GET /api/breath/status</span>
              <span class="help-v">Returns <code>{"Status":"Running"|"Completed"|"Failed",...}</code>.</span>
              <span class="help-k">GET /api/results/latest</span>
              <span class="help-v">Download the most recent result as a CSV (one row per simulated hour).</span>
              <span class="help-k">GET /api/breath/stream/logs</span>
              <span class="help-v">Server-Sent Events stream of live log messages during simulation.</span>
              <span class="help-k">Swagger UI</span>
              <span class="help-v"><a href="/swagger" target="_blank" style="color:#3b82f6">/swagger ↗</a> — interactive documentation for all endpoints.</span>
            </div>

            <p class="help-p" style="margin-top:10px"><b>Minimal Python example:</b></p>
            <pre class="help-code">import requests, time, io, pandas as pd

BASE = "https://breath-api-thkm.onrender.com"
payload = {"settings": {
    "pixelsRun": ["44.6813_11.0217"],
    "startYear": 2022, "endYear": 2025,
    "inputWeather": "hourly",
    "modelVariant": "Circadian",
    "calibration": False,
    "parametersDataFile": "photothermalRequirements.csv",
    "simplexes": 3, "iterations": 200,
    "calibrationVariable": "Phenology"}}

requests.post(f"{BASE}/api/breath/run", json=payload)
while True:
    s = requests.get(f"{BASE}/api/breath/status").json()["Status"]
    if s == "Completed": break
    time.sleep(10)
csv = requests.get(f"{BASE}/api/results/latest").text
df  = pd.read_csv(io.StringIO(csv), parse_dates=["date"])</pre>

            <div class="help-tip" style="margin-top:8px">
              📓 Full examples (single pixel, grid, parameter overrides):<br>
              <a href="https://github.com/GeoModelLab/breath-api/blob/main/examples/breath_api_demo.ipynb" target="_blank" style="color:#3b82f6">Python notebook (GitHub) ↗</a>
              &nbsp;·&nbsp;
              <a href="/docs/breath_api_demo.html" target="_blank" style="color:#3b82f6">R vignette (HTML) ↗</a>
            </div>
          </template>

          <!-- ── About ── -->
          <template v-if="tab==='about'">
            <p class="help-p">
              <b>BREATH</b> — Biophysical Rhythm of Ecosystem Activity &amp; Health<br>
              A process-based framework for hourly simulation of GPP, RECO and NEE in temperate deciduous forests, representing the internal physiological regulation of ecosystem metabolism.
            </p>
            <p class="help-p">
              BREATH builds on the conceptual structure of VPRM (Mahadevan et al. 2008) but departs from it by representing vegetation through an <b>internally simulated pheno-physiological state</b> rather than prescribing activity directly from remote sensing. The canopy is represented as <b>two functionally distinct layers</b>: an overstory layer whose activity scales with simulated fractional cover (θ), and an understory layer that dominates fluxes during dormancy and early growth.
            </p>
            <div class="help-kv">
              <span class="help-k">Baseline</span>
              <span class="help-v">EVI used as instantaneous driver of carbon flux. No explicit phenological state or circadian regulation.</span>
              <span class="help-k">Pheno</span>
              <span class="help-v">Physiological parameters continuously modulated by SWELL phenological progression (dormancy → growth → canopy maturity → senescence). Autotrophic respiration linked to antecedent assimilation through a two-pool labile carbon substrate model.</span>
              <span class="help-k">Circadian</span>
              <span class="help-v">Pheno + endogenous circadian regulation of both photosynthesis and respiration, generating realistic morning/afternoon GPP asymmetry independently of instantaneous forcing.</span>
              <span class="help-k">Weather</span>
              <span class="help-v"><a href="https://power.larc.nasa.gov/" target="_blank" style="color:#3b82f6">NASA POWER</a> — hourly or daily, global coverage from 1981.</span>
              <span class="help-k">Satellite VI</span>
              <span class="help-v"><a href="https://modis.gsfc.nasa.gov/" target="_blank" style="color:#3b82f6">MODIS Terra/Aqua EVI</a> — 16-day composites from ORNL DAAC.</span>
              <span class="help-k">Land cover</span>
              <span class="help-v"><a href="https://esa-worldcover.org/" target="_blank" style="color:#3b82f6">ESA WorldCover 2021</a> — 10 m resolution, served from AWS S3 COG tiles.</span>
              <span class="help-k">Calibration</span>
              <span class="help-v">Multi-start Nelder-Mead Simplex (3 restarts, 200 iterations per run). Evaluated across 43 eddy-covariance sites (FLUXNET/ICOS/AmeriFlux/JapanFlux).</span>
            </div>
            <div class="help-tip">
              Bregaglio et al. (2026, under review). <i>Endogenous rhythms set the tempo of carbon exchange in temperate deciduous forests.</i> Phenological regulation reduced seasonal NEE errors by 15.8%; circadian regulation provided a further 18% improvement in diurnal GPP accuracy (33% for RECO) relative to the Pheno configuration.
            </div>
          </template>

        </div>
      </div>
    </div>
  `,
})
})()
