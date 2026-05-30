;(function() {
const { defineComponent, nextTick } = Vue

// ── helpers ──────────────────────────────────────────────────
function mean(arr) { return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0 }
const EXCLUDE_COLS  = new Set(['year','hour','date','pixel','doy'])
const STRING_COLS   = new Set(['phenophase','phenoPhase'])
// Variables excluded from the chart toggle panel
const HIDDEN_VARS  = new Set(['tleafover','tleafunder','phenophase','phenoPhase','waterstress'])

function hexA(hex, a) {
  // append 2-digit alpha to a #rrggbb hex string → #rrggbbaa
  return hex + Math.round(a * 255).toString(16).padStart(2,'0')
}

function varColor(name) {
  const n = name.toLowerCase()
  if (/^gpp$/.test(n))                                      return '#4ade80'
  if (/gppover/.test(n))                                    return '#34d399'
  if (/gppunder/.test(n))                                   return '#6ee7b7'
  if (/^reco$/.test(n))                                     return '#f87171'
  if (/recoover/.test(n))                                   return '#fca5a5'
  if (/recounder/.test(n))                                  return '#fecaca'
  if (/recohetero|trecoref/.test(n))                        return '#fdba74'
  if (/^nee$/.test(n))                                      return '#60a5fa'
  if (/^swell$/.test(n))                                    return '#facc15'
  if (/reference/.test(n))                                  return '#fb923c'
  if (/vegetationcover/.test(n))                            return '#34d399'
  if (/phenoscale|phenologyscale/.test(n))                  return '#a78bfa'
  if (/phenoreco/.test(n))                                  return '#c4b5fd'
  if (/tscaleover/.test(n))                                 return '#fbbf24'
  if (/tscaleunder/.test(n))                                return '#fde68a'
  if (/^tscale$/.test(n))                                   return '#fbbf24'
  if (/tscalereco/.test(n))                                 return '#fb923c'
  if (/parscaleover/.test(n))                               return '#fef08a'
  if (/parscaleunder/.test(n))                              return '#fef9c3'
  if (/^parscale$/.test(n))                                 return '#fef08a'
  if (/waterstress/.test(n))                                return '#818cf8'
  if (/vpdscale/.test(n))                                   return '#c084fc'
  if (/recotandws/.test(n))                                 return '#f97316'
  if (/recogpp/.test(n))                                    return '#fca5a5'
  if (/lai/.test(n))                                        return '#22c55e'
  if (/^t$/.test(n))                                        return '#fb7185'
  if (/soilt|tleaf/.test(n))                                return '#fda4af'
  if (/^sw$/.test(n))                                       return '#fbbf24'
  if (/^p$/.test(n))                                        return '#38bdf8'
  if (/^rh$/.test(n))                                       return '#94a3b8'
  if (/^vpd$/.test(n))                                      return '#c084fc'
  if (/et0/.test(n))                                        return '#67e8f9'
  return '#64748b'
}

// ── variable units ───────────────────────────────────────
const VAR_UNITS = {
  gpp:'µmol m⁻² s⁻¹', gppover:'µmol m⁻² s⁻¹', gppunder:'µmol m⁻² s⁻¹',
  reco:'µmol m⁻² s⁻¹', recoover:'µmol m⁻² s⁻¹', recounder:'µmol m⁻² s⁻¹',
  recohetero:'µmol m⁻² s⁻¹', recotandws:'µmol m⁻² s⁻¹', recogpp:'µmol m⁻² s⁻¹',
  nee:'µmol m⁻² s⁻¹',
  swell:'EVI', reference:'EVI', vegetationcover:'-',
  t:'°C', soilt:'°C', tleafover:'°C', tleafunder:'°C',
  sw:'W m⁻²', p:'mm h⁻¹', rh:'%', vpd:'kPa', et0:'mm h⁻¹',
  tscale:'0–1', tscaleover:'0–1', tscaleunder:'0–1', tscalereco:'0–1',
  parscale:'0–1', parscaleover:'0–1', parscaleunder:'0–1',
  waterstress:'0–1', vpdscale:'0–1',
  phenologyscale:'0–1', phenoscale:'0–1', phenoreco:'0–1',
  laiover:'m² m⁻²', laiunder:'m² m⁻²', lai:'m² m⁻²',
  eviover:'EVI', eviunder:'EVI',
}
function varUnit(name) { return VAR_UNITS[name.toLowerCase()] ?? '' }

// ── chart assignment ─────────────────────────────────────────
const IS_FLUX    = n => /^(gpp|reco|nee|gppover|gppunder|recoover|recounder|recohetero|trecoref|recotandws|recogpp)$/i.test(n)
const IS_WEATHER = n => /^(t|sw|p|rh|vpd|et0|soilt|tleafover|tleafunder)$/i.test(n)

function chartFor(name) { return IS_FLUX(name) ? 'flux' : 'swell' }
function yAxisFor(chart, name) {
  return (chart === 'swell' && IS_WEATHER(name)) ? 'yRight' : 'yLeft'
}

// ── aggregation ──────────────────────────────────────────────
function dailyAgg(rows, cols) {
  const d = {}
  for (const r of rows) {
    if (!d[r.date]) { d[r.date] = {}; cols.forEach(c => { d[r.date][c] = [] }) }
    cols.forEach(c => { const v = r[c]; if (v != null && isFinite(v)) d[r.date][c].push(v) })
  }
  return Object.entries(d).sort(([a],[b])=>a<b?-1:1)
    .map(([date,v]) => { const row={date}; cols.forEach(c=>{ row[c]=mean(v[c]) }); return row })
}
function monthlyAgg(daily, cols) {
  const m = {}
  for (const r of daily) {
    const k = r.date.slice(0,7)
    if (!m[k]) { m[k]={date:k+'-15'}; cols.forEach(c=>{ m[k][c]=[] }) }
    cols.forEach(c => m[k][c].push(r[c]))
  }
  return Object.values(m).sort((a,b)=>a.date<b.date?-1:1)
    .map(r => { const row={date:r.date}; cols.forEach(c=>{ row[c]=mean(r[c]) }); return row })
}

// ── SWELL var groups ─────────────────────────────────────────
const SWELL_GROUPS = [
  { label:'Phenology',  match: n => /^swell$|reference|vegetationcover|phenoscale|phenologyscale|phenoreco|lai/i.test(n) },
  { label:'Scalers ×',  match: n => /tscale|parscale|waterstress|vpdscale/i.test(n) },
  { label:'Weather ↗',  match: n => IS_WEATHER(n) },
]
const FLUX_GROUPS = [
  { label:'Carbon exchange', match: n => /^(gpp|reco|nee)$/i.test(n) },
  { label:'Components',      match: n => /gppover|gppunder|recoover|recounder|recohetero|trecoref/i.test(n) },
]

function makeGroups(cols, groupDefs) {
  const used = new Set(); const result = []
  for (const g of groupDefs) {
    const gc = cols.filter(c => g.match(c) && !used.has(c))
    gc.forEach(c => used.add(c))
    if (gc.length) result.push({ label: g.label, cols: gc })
  }
  const rest = cols.filter(c => !used.has(c))
  if (rest.length) result.push({ label:'Other', cols: rest })
  return result
}

// ── component ────────────────────────────────────────────────
window.ResultsPanel = defineComponent({
  name: 'ResultsPanel',

  template: `
    <div>
      <div v-if="!hasData" class="results-empty">
        <div>Run the model to see results</div>
        <small>GPP · RECO · NEE simulated at hourly resolution</small>
      </div>

      <template v-else>

        <!-- ── Metric cards ── -->
        <div class="metric-grid">
          <div :class="['metric-card', stats.annNEE < 0 ? 'metric-sink' : 'metric-source']">
            <div class="metric-label">Annual NEE</div>
            <div class="metric-value">{{ fmt(stats.annNEE) }}</div>
            <div class="metric-unit">gC m⁻² yr⁻¹{{ stats.filtered ? ' · filtered' : '' }}</div>
            <div class="metric-badge">{{ stats.annNEE < 0 ? '🌱 Carbon sink' : '🔥 Carbon source' }}</div>
          </div>
          <div class="metric-card metric-gpp">
            <div class="metric-label">Annual GPP</div>
            <div class="metric-value">{{ fmt(stats.annGPP) }}</div>
            <div class="metric-unit">gC m⁻² yr⁻¹</div>
          </div>
          <div class="metric-card metric-reco">
            <div class="metric-label">Annual RECO</div>
            <div class="metric-value">{{ fmt(stats.annRECO) }}</div>
            <div class="metric-unit">gC m⁻² yr⁻¹</div>
          </div>
          <div class="metric-card metric-peak">
            <div class="metric-label">Peak GPP</div>
            <div class="metric-value">{{ stats.peakGPP }}</div>
            <div class="metric-unit">µmol m⁻² s⁻¹</div>
          </div>
        </div>

        <!-- ── Per-year KPI table ── -->
        <div class="year-table-wrap" v-if="yearlyStats.length > 1">
          <div class="table-toggle" @click="showYearTable=!showYearTable">
            <span>Annual summary</span>
            <span class="toggle-arrow">{{ showYearTable ? '▲' : '▼' }}</span>
          </div>
          <table v-if="showYearTable" class="year-table">
            <thead>
              <tr>
                <th>Year</th>
                <th>GPP</th>
                <th>RECO</th>
                <th>NEE</th>
                <th>Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="y in yearlyStats" :key="y.year"
                  :class="y.isSink ? 'yr-sink' : 'yr-source'">
                <td class="yr-year">{{ y.year }}</td>
                <td class="yr-gpp">{{ y.gpp }}</td>
                <td class="yr-reco">{{ y.reco }}</td>
                <td :class="['yr-nee', y.isSink ? 'yr-nee-sink' : 'yr-nee-src']">{{ y.nee }}</td>
                <td class="yr-badge">
                  <span :class="y.isSink ? 'sink-chip' : 'src-chip'">
                    {{ y.isSink ? 'sink' : 'source' }}
                  </span>
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr class="yr-unit">
                <td colspan="4">All values gC m⁻² yr⁻¹</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <!-- ── Phenological metrics ── -->
        <div v-if="phenoMetrics.length" class="pheno-table-wrap">
          <div class="table-toggle" @click="showPhenoTable=!showPhenoTable">
            <span>Phenological dates (DOY)</span>
            <span class="toggle-arrow">{{ showPhenoTable ? '▲' : '▼' }}</span>
          </div>
          <table v-if="showPhenoTable" class="year-table">
            <thead>
              <tr>
                <th>Year</th>
                <th title="Start of Growing Season — first day phenoCode=Growth">SGS</th>
                <th title="Maturity — first day phenoCode=Greendown">MAT</th>
                <th title="Start of Senescence">SEN</th>
                <th title="End of Growing Season — return to Dormancy">EGS</th>
                <th title="Growing Season Length (EGS−SGS)">GSL</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in phenoMetrics" :key="m.year">
                <td class="yr-year">{{ m.year }}</td>
                <td>{{ m.sgs ?? '—' }}</td>
                <td>{{ m.mat ?? '—' }}</td>
                <td>{{ m.sen ?? '—' }}</td>
                <td>{{ m.egs ?? '—' }}</td>
                <td>{{ m.gsl ?? '—' }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr class="yr-unit"><td colspan="6">DOY (day of year) · GSL in days</td></tr>
            </tfoot>
          </table>
        </div>

        <!-- ── Toolbar (shared between both charts) ── -->
        <div class="charts-toolbar">
          <select v-model="chartType">
            <option value="line">Line</option>
            <option value="bar">Bar</option>
          </select>
          <div class="time-brush">
            <span class="brush-lbl">From</span>
            <input class="brush-date" type="date" v-model="dateFrom" :min="dataDateMin" :max="dataDateMax" />
            <span class="brush-lbl">to</span>
            <input class="brush-date" type="date" v-model="dateTo" :min="dataDateMin" :max="dataDateMax" />
            <button v-if="dateFrom||dateTo" class="brush-reset" @click="clearBrush">✕</button>
          </div>
          <span class="toolbar-info">{{ visibleDays }} pts · {{ aggLabel }}</span>
          <a href="/api/results/latest" download="breath_results.csv"
             class="btn-outline btn-sm" style="margin-left:4px;text-decoration:none">⬇ CSV</a>
          <button class="chart-zoom-reset" @click="resetAllZoom" title="Reset zoom (Ctrl+scroll to zoom)">⤢</button>
        </div>

        <!-- ── Charts + Variable panel ── -->
        <div class="charts-layout">

          <!-- Left: two stacked charts -->
          <div class="charts-area">

            <!-- SWELL chart -->
            <div class="chart-card chart-card-tall">
              <div class="chart-hd">
                <span class="chart-title-tag swell-tag">SWELL</span>
                <span class="chart-subtitle-tag">left: 0–1 scale &nbsp;|&nbsp; right: weather units</span>
                <div class="chart-inline-legend">
                  <span v-for="n in swellDatasets" :key="n" class="ci-item">
                    <span class="ci-dot" :style="'background:'+varColor(n)"></span>
                    <span class="ci-name">{{ n }}</span>
                    <span :class="['ci-axis', IS_WEATHER(n) ? 'ci-right' : 'ci-left']">
                      {{ IS_WEATHER(n) ? 'R' : 'L' }}
                    </span>
                  </span>
                </div>
              </div>
              <div class="chart-body">
                <canvas ref="swellCanvas"></canvas>
              </div>
            </div>

            <!-- FLUXES chart -->
            <div class="chart-card chart-card-tall" style="margin-top:8px">
              <div class="chart-hd">
                <span class="chart-title-tag flux-tag">FLUXES</span>
                <span class="chart-subtitle-tag">µmol m⁻² s⁻¹</span>
                <div class="chart-inline-legend">
                  <span v-for="n in fluxDatasets" :key="n" class="ci-item">
                    <span class="ci-dot" :style="'background:'+varColor(n)"></span>
                    <span class="ci-name">{{ n }}</span>
                  </span>
                </div>
              </div>
              <div class="chart-body">
                <canvas ref="fluxCanvas"></canvas>
              </div>
            </div>

          </div>

          <!-- Right: variable toggle panel -->
          <div class="var-panel">

            <!-- SWELL section -->
            <div class="var-section-hd">
              <span class="var-section-dot swell-dot"></span> SWELL
            </div>
            <div v-for="g in swellVarGroups" :key="'sg_'+g.label" class="var-group">
              <div class="var-group-lbl">{{ g.label }}</div>
              <div v-for="col in g.cols" :key="col"
                   :class="['var-row', isSwellOn(col) && 'on']"
                   @click="toggleSwell(col)">
                <span class="var-dot" :style="'background:'+varColor(col)+'44;border:1.5px solid '+varColor(col)"></span>
                <span class="var-name">{{ col }}</span>
                <span :class="['var-axis-tag', IS_WEATHER(col) ? 'ax-right' : 'ax-left']">
                  {{ IS_WEATHER(col) ? 'R' : 'L' }}
                </span>
                <span :class="['var-sw', isSwellOn(col) && 'on']"></span>
              </div>
            </div>

            <div class="var-divider"></div>

            <!-- FLUXES section -->
            <div class="var-section-hd">
              <span class="var-section-dot flux-dot"></span> FLUXES
            </div>
            <div v-for="g in fluxVarGroups" :key="'fg_'+g.label" class="var-group">
              <div class="var-group-lbl">{{ g.label }}</div>
              <div v-for="col in g.cols" :key="col"
                   :class="['var-row', isFluxOn(col) && 'on']"
                   @click="toggleFlux(col)">
                <span class="var-dot" :style="'background:'+varColor(col)+'44;border:1.5px solid '+varColor(col)"></span>
                <span class="var-name">{{ col }}</span>
                <span :class="['var-sw', isFluxOn(col) && 'on']"></span>
              </div>
            </div>

          </div>

        </div>
      </template>
    </div>
  `,

  data() {
    return {
      hourly:        [],
      numericCols:   [],
      chartType:     'line',
      swellDatasets: ['SWELL'],
      fluxDatasets:  ['GPP','RECO','NEE'],
      dateFrom:      '',
      dateTo:        '',
      _swellChart:   null,
      _fluxChart:    null,
      _hasZoom:      typeof Chart !== 'undefined' && !!Chart.registry?.plugins?.get('zoom'),
      _hasAnnotation:typeof Chart !== 'undefined' && !!Chart.registry?.plugins?.get('annotation'),
      _csvKey:       0,
      _zoomDays:     9999,   // current visible zoom range in days (updated on zoom/pan)
      showYearTable:  false,
      showPhenoTable: false,
    }
  },

  computed: {
    hasData()  { return this.hourly.length > 0 },
    daily()    { return dailyAgg(this.hourly, this.numericCols) },

    // zoom-based aggregation: hourly when zoomed in < 90 days, else daily
    agg() {
      return this._zoomDays < 90 ? this.hourly : this.daily
    },

    filteredAgg() {
      let d = this.agg
      if (this.dateFrom) d = d.filter(r => r.date >= this.dateFrom)
      if (this.dateTo)   d = d.filter(r => r.date <= this.dateTo)
      return d.length ? d : this.agg
    },

    dataDateMin() { return this.daily[0]?.date ?? '' },
    dataDateMax() { return this.daily[this.daily.length-1]?.date ?? '' },
    visibleDays()  { return this.filteredAgg.length },
    aggLabel()     { return this._zoomDays < 90 ? 'hourly' : 'daily' },

    stats() {
      let daily = this.daily
      if (this.dateFrom) daily = daily.filter(r => r.date >= this.dateFrom)
      if (this.dateTo)   daily = daily.filter(r => r.date <= this.dateTo)
      const nDays  = daily.length
      const nYears = Math.max(1, nDays / 365)
      const get = (...keys) => daily.map(r => { for(const k of keys){if(r[k]!=null)return r[k]} return 0 })
      const gpp  = get('GPP','gpp')
      const reco = get('RECO','reco')
      const nee  = get('NEE','nee')
      const toGC = arr => Math.round(arr.reduce((a,b)=>a+b,0) * 86400 * 12.01 / 1e6 / nYears)
      return {
        annNEE:  toGC(nee), annGPP: toGC(gpp), annRECO: toGC(reco),
        peakGPP: +Math.max(0,...gpp).toFixed(2), nDays,
        filtered: !!(this.dateFrom || this.dateTo),
      }
    },

    swellVarGroups() {
      const cols = this.numericCols.filter(c => !IS_FLUX(c) && !HIDDEN_VARS.has(c.toLowerCase()))
      return makeGroups(cols, SWELL_GROUPS)
    },

    fluxVarGroups() {
      const cols = this.numericCols.filter(c => IS_FLUX(c))
      return makeGroups(cols, FLUX_GROUPS)
    },

    // ── Phenological metrics (per year, from hourly rows) ──────────────
    phenoMetrics() {
      // find phenoPhase column key (case-insensitive)
      const phaseKey = this.hourly.length
        ? Object.keys(this.hourly[0]).find(k => k.toLowerCase() === 'phenophase') ?? null
        : null
      if (!phaseKey) return []

      const doyFromDate = dateStr => {
        if (!dateStr) return null
        const d = new Date(dateStr)
        const start = new Date(d.getFullYear(), 0, 0)
        return Math.floor((d - start) / 86400000)
      }

      const byYear = {}
      const prevPhase = {}  // track previous phase per year for transition detection

      for (const r of this.hourly) {
        const yr = r.date?.slice(0,4); if (!yr) continue
        if (!byYear[yr]) byYear[yr] = { sgs:null, mat:null, sen:null, egs:null }
        const m    = byYear[yr]
        const cur  = (r[phaseKey] ?? '').toString()
        const prev = prevPhase[yr] ?? ''
        const doy  = r.doy ?? doyFromDate(r.date)
        if (!doy) { prevPhase[yr] = cur; continue }

        const changed = cur !== prev   // true at phase transition

        // SGS: enter Growth (phenoCode 3)
        if (m.sgs == null && /growth/i.test(cur) && changed)
          m.sgs = doy
        // MAT: enter Greendown (phenoCode 4) after SGS
        if (m.mat == null && /green/i.test(cur) && changed && m.sgs != null)
          m.mat = doy
        // SEN: transition 4→5 (Greendown→Senescence)
        if (m.sen == null && /senesci/i.test(cur) && changed)
          m.sen = doy
        // EGS: return to Dormancy after growing season (no SEN required)
        if (m.egs == null && /dorm|induct/i.test(cur) && changed && m.mat != null)
          m.egs = doy

        prevPhase[yr] = cur
      }

      return Object.entries(byYear).sort(([a],[b])=>a<b?-1:1)
        .map(([yr, m]) => ({
          year: yr, sgs: m.sgs, mat: m.mat, sen: m.sen, egs: m.egs,
          gsl: (m.sgs && m.egs) ? m.egs - m.sgs : null,
        }))
    },

    // Per-year annual totals from the FULL daily series (ignores date filter)
    yearlyStats() {
      const byYear = {}
      for (const r of this.daily) {
        const yr = r.date?.slice(0,4); if (!yr) continue
        if (!byYear[yr]) byYear[yr] = { gpp:[], reco:[], nee:[], n:0 }
        const acc = byYear[yr]
        if (r.GPP  != null) { acc.gpp.push(r.GPP);   acc.n++ }
        if (r.RECO != null)   acc.reco.push(r.RECO)
        if (r.NEE  != null)   acc.nee.push(r.NEE)
      }
      const toGC = arr => arr.length
        ? Math.round(arr.reduce((a,b)=>a+b,0) * 86400 * 12.01 / 1e6)
        : null
      return Object.entries(byYear)
        .sort(([a],[b]) => a < b ? -1 : 1)
        .map(([yr, d]) => {
          const nee = toGC(d.nee)
          return { year: yr, gpp: toGC(d.gpp), reco: toGC(d.reco), nee, isSink: (nee ?? 0) < 0 }
        })
    },
  },

  watch: {
    chartType(){ nextTick(() => this.rebuild()) },
    dateFrom() { nextTick(() => this.rebuild()) },
    dateTo()   { nextTick(() => this.rebuild()) },
    _csvKey()  { this.dateFrom=''; this.dateTo=''; nextTick(()=>this.rebuild()) },
    _zoomDays(){ nextTick(() => this.rebuild()) },
  },

  beforeUnmount() {
    this._swellChart?.destroy()
    this._fluxChart?.destroy()
  },

  methods: {
    fmt(n) { return n.toLocaleString() },
    clearBrush() { this.dateFrom=''; this.dateTo='' },
    varColor, IS_WEATHER,
    isSwellOn(col) { return this.swellDatasets.includes(col) },
    isFluxOn(col)  { return this.fluxDatasets.includes(col) },

    toggleSwell(col) {
      const idx = this.swellDatasets.indexOf(col)
      if (idx >= 0) {
        if (this.swellDatasets.length <= 1) return
        this.swellDatasets = this.swellDatasets.filter((_,i)=>i!==idx)
      } else {
        this.swellDatasets = [...this.swellDatasets, col]
      }
      nextTick(() => this.buildSwellChart())
    },

    toggleFlux(col) {
      const idx = this.fluxDatasets.indexOf(col)
      if (idx >= 0) {
        if (this.fluxDatasets.length <= 1) return
        this.fluxDatasets = this.fluxDatasets.filter((_,i)=>i!==idx)
      } else {
        this.fluxDatasets = [...this.fluxDatasets, col]
      }
      nextTick(() => this.buildFluxChart())
    },

    // ── Zoom sync ─────────────────────────────────────────────
    _syncZoom(source) {
      if (this.__syncing) return
      this.__syncing = true
      const { min, max } = source.scales.x
      // Update zoom-days for agg switching
      try {
        const d1 = new Date(min), d2 = new Date(max)
        if (!isNaN(d1) && !isNaN(d2))
          this._zoomDays = Math.round((d2 - d1) / 86400000)
      } catch {}
      for (const c of [this._swellChart, this._fluxChart]) {
        if (!c || c === source) continue
        if (typeof c.zoomScale === 'function') {
          c.zoomScale('x', { min, max }, 'none')
        } else {
          c.options.scales.x.min = min
          c.options.scales.x.max = max
          c.update('none')
        }
      }
      this.__syncing = false
    },

    resetAllZoom() {
      this.__syncing = true
      this._zoomDays = 9999
      this._swellChart?.resetZoom?.()
      this._fluxChart?.resetZoom?.()
      this.__syncing = false
    },

    // ── Phenological annotations for SWELL chart ─────────────
    _phenoAnnotations() {
      if (!this._hasAnnotation) return {}
      const MARKERS = {
        sgs: { color: '#4ade80', label: 'SGS' },
        mat: { color: '#facc15', label: 'MAT' },
        sen: { color: '#f97316', label: 'SEN' },
        egs: { color: '#f87171', label: 'EGS' },
      }
      const doyToDate = (yr, doy) => {
        const d = new Date(parseInt(yr), 0, doy)
        return d.toISOString().slice(0,10)
      }
      const annotations = {}
      for (const m of this.phenoMetrics) {
        for (const [key, cfg] of Object.entries(MARKERS)) {
          if (m[key] == null) continue
          const dateStr = doyToDate(m.year, m[key])
          // Only annotate if the date is within filtered range
          annotations[`${key}_${m.year}`] = {
            type: 'line',
            xMin: dateStr, xMax: dateStr,
            borderColor: cfg.color,
            borderWidth: 1.5,
            borderDash: [4, 3],
            label: {
              display: true,
              content: cfg.label,
              position: 'start',
              color: cfg.color,
              backgroundColor: 'transparent',
              font: { size: 9 },
              padding: 2,
            },
          }
        }
      }
      return annotations
    },

    // ── Dataset builder ───────────────────────────────────────
    _makeDatasets(names, chartName) {
      const d    = this.filteredAgg
      const isLn = this.chartType === 'line'
      return names.filter(n => this.numericCols.includes(n)).map(n => {
        const c    = varColor(n)
        const yId  = yAxisFor(chartName, n)
        const isRef = n.toLowerCase() === 'reference'

        // 'reference' = MODIS EVI composites (every ~16 days) — render as points only
        if (isRef) {
          return {
            label:           n,
            data:            d.map(r => r[n] ?? null),
            yAxisID:         yId,
            borderColor:     'transparent',
            backgroundColor: c,
            pointRadius:     5,
            pointHoverRadius: 7,
            pointStyle:      'circle',
            showLine:        false,
            fill:            false,
            spanGaps:        false,
          }
        }

        return {
          label:           n,
          data:            d.map(r => r[n] ?? null),
          yAxisID:         yId,
          borderColor:     c,
          backgroundColor: isLn ? 'transparent' : hexA(c, 0.7),
          borderWidth:     isLn ? 1.5 : 0,
          pointRadius:     0,
          fill:            false,
          tension:         0.3,
          spanGaps:        true,
        }
      })
    },

    _zoomPlugin() {
      if (!this._hasZoom) return {}
      return {
        zoom: {
          zoom: {
            wheel:   { enabled: true, modifierKey: 'ctrl' },
            pinch:   { enabled: true },
            mode:    'x',
            onZoomComplete: ({ chart }) => this._syncZoom(chart),
          },
          pan: {
            enabled: true,
            mode:    'x',
            onPanComplete: ({ chart }) => this._syncZoom(chart),
          },
        },
      }
    },

    _xAxis() {
      return { ticks:{color:'#64748b', maxTicksLimit:7, font:{size:9}}, grid:{color:'#1e2d44'} }
    },

    // ── Chart builders ────────────────────────────────────────
    buildSwellChart() {
      this._swellChart?.destroy()
      const canvas = this.$refs.swellCanvas
      if (!canvas) return
      const d      = this.filteredAgg
      const isH    = this.aggMode === 'hourly'
      const labels = d.map(r => isH ? (r._dt??r.date) : r.date)

      this._swellChart = new Chart(canvas, {
        type: this.chartType,
        data: { labels, datasets: this._makeDatasets(this.swellDatasets, 'swell') },
        options: {
          responsive: true, maintainAspectRatio: false, animation: {duration:150},
          interaction: { mode:'index', intersect:false },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor:'#182030', titleColor:'#7080a0', bodyColor:'#c8d8e8',
              borderColor:'#243050', borderWidth:1,
              callbacks: { label: ctx => {
                const u = varUnit(ctx.dataset.label)
                return ` ${ctx.dataset.label}: ${ctx.raw?.toFixed(3)}${u ? ' ' + u : ''}`
              }},
            },
            ...this._zoomPlugin(),
            annotation: { annotations: this._phenoAnnotations() },
          },
          scales: {
            x:      this._xAxis(),
            yLeft:  {
              type:'linear', position:'left',
              ticks:{color:'#64748b',font:{size:9}}, grid:{color:'#1e2d44'},
              title:{display:true, text:'scale (0–1)', color:'#445566', font:{size:8}},
            },
            yRight: {
              type:'linear', position:'right',
              ticks:{color:'#64748b',font:{size:9}}, grid:{drawOnChartArea:false},
              title:{display:true, text:'weather', color:'#445566', font:{size:8}},
            },
          },
        },
      })
    },

    buildFluxChart() {
      this._fluxChart?.destroy()
      const canvas = this.$refs.fluxCanvas
      if (!canvas) return
      const d      = this.filteredAgg
      const isH    = this.aggMode === 'hourly'
      const labels = d.map(r => isH ? (r._dt??r.date) : r.date)

      this._fluxChart = new Chart(canvas, {
        type: this.chartType,
        data: { labels, datasets: this._makeDatasets(this.fluxDatasets, 'flux') },
        options: {
          responsive: true, maintainAspectRatio: false, animation: {duration:150},
          interaction: { mode:'index', intersect:false },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor:'#182030', titleColor:'#7080a0', bodyColor:'#c8d8e8',
              borderColor:'#243050', borderWidth:1,
              callbacks: { label: ctx => {
                const u = varUnit(ctx.dataset.label)
                return ` ${ctx.dataset.label}: ${ctx.raw?.toFixed(3)}${u ? ' ' + u : ''}`
              }},
            },
            ...this._zoomPlugin(),
          },
          scales: {
            x:     this._xAxis(),
            yLeft: {
              type:'linear', position:'left',
              ticks:{color:'#64748b',font:{size:9}}, grid:{color:'#1e2d44'},
              title:{display:true, text:'µmol m⁻² s⁻¹', color:'#445566', font:{size:8}},
            },
          },
        },
      })
    },

    rebuild() {
      this._swellChart?.destroy(); this._swellChart = null
      this._fluxChart?.destroy();  this._fluxChart  = null
      nextTick(() => { this.buildSwellChart(); this.buildFluxChart() })
    },

    // ── CSV ingestion ─────────────────────────────────────────
    loadCsv(csv) {
      const lines = csv.trim().split('\n')
      if (lines.length < 2) return
      const hdr     = lines[0].split(',').map(h=>h.trim())
      const dateIdx = hdr.indexOf('date')
      const hourIdx = hdr.indexOf('hour')

      const rows = lines.slice(1).map(line => {
        const c    = line.split(',')
        const date = c[dateIdx]?.slice(0,10)
        const h    = hourIdx >= 0 ? parseInt(c[hourIdx]) : NaN
        const row  = {
          date,
          _dt: (!isNaN(h) && date) ? `${date} ${String(h).padStart(2,'0')}:00` : date,
        }
        hdr.forEach((col,i) => {
          if (EXCLUDE_COLS.has(col)) return
          const raw = c[i]?.trim() ?? ''
          const v = parseFloat(raw)
          if (!isNaN(v)) {
            row[col] = (col === 'doy') ? Math.round(v) : v
          } else if (raw) {
            row[col] = raw   // store non-numeric (e.g. phenoPhase) as string
          }
        })
        return row
      }).filter(r => r.date && r.date.length === 10)

      this.hourly = rows

      const colSet = new Set()
      for (const row of rows.slice(0, 200))
        Object.keys(row).forEach(k => { if (k!=='date'&&!k.startsWith('_')) colSet.add(k) })
      this.numericCols = [...colSet]

      const avail = new Set(this.numericCols)
      this.swellDatasets = ['SWELL'].filter(v=>avail.has(v))
      if (!this.swellDatasets.length) {
        const f = this.numericCols.find(c=>!IS_FLUX(c))
        if (f) this.swellDatasets = [f]
      }
      this.fluxDatasets = ['GPP','RECO','NEE'].filter(v=>avail.has(v))
      if (!this.fluxDatasets.length) {
        const f = this.numericCols.find(c=>IS_FLUX(c))
        if (f) this.fluxDatasets = [f]
      }
      this.dateFrom=''; this.dateTo=''
      this._csvKey++   // trigger chart rebuild even when data was already present
    },
  },
})
})()
