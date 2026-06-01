;(function() {
const { defineComponent, nextTick } = Vue

// ── helpers ──────────────────────────────────────────────────
function mean(arr) { return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0 }
const EXCLUDE_COLS  = new Set(['year','hour','date','pixel','doy'])
const STRING_COLS   = new Set(['phenophase','phenoPhase'])
const HIDDEN_VARS  = new Set(['tleafover','tleafunder','phenophase','phenoPhase'])

function hexA(hex, a) {
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

const IS_FLUX    = n => /^(gpp|reco|nee|gppover|gppunder|recoover|recounder|recohetero|trecoref|recotandws|recogpp)$/i.test(n)
const IS_WEATHER = n => /^(t|sw|p|rh|vpd|et0|soilt|tleafover|tleafunder)$/i.test(n)

function chartFor(name) { return IS_FLUX(name) ? 'flux' : 'swell' }
function yAxisFor(chart, name) {
  return (chart === 'swell' && IS_WEATHER(name)) ? 'yRight' : 'yLeft'
}

// parscale is 0 at night by definition; average only daytime (non-zero) values for daily display
const DAYTIME_ONLY = /parscale/i

function dailyAgg(rows, cols) {
  const d = {}
  for (const r of rows) {
    if (!d[r.date]) { d[r.date] = {}; cols.forEach(c => { d[r.date][c] = [] }) }
    cols.forEach(c => {
      const v = r[c]
      if (v == null || !isFinite(v)) return
      if (DAYTIME_ONLY.test(c) && v <= 0) return
      d[r.date][c].push(v)
    })
  }
  return Object.entries(d).sort(([a],[b])=>a<b?-1:1)
    .map(([date,v]) => { const row={date}; cols.forEach(c=>{ row[c]=mean(v[c]) }); return row })
}

const VAR_TAB_GROUPS = [
  { key:'main',    label:'Main',    match: n => /^(swell|reference|gpp|reco|nee)$/i.test(n) },
  { key:'scalers', label:'Scalers', match: n => /tscale|parscale|waterstress|vpdscale|phenoscale|phenoreco/i.test(n) },
  { key:'weather', label:'Weather', match: n => IS_WEATHER(n) },
  { key:'other',   label:'Other',   match: () => true },
]

// ── Full Köppen-Geiger classification ───────────────────────────────────
function koppenClassify(annT, tCold, tWarm, annP, pMonthly, tMonthly) {
  if (tMonthly.filter(v => v != null).length === 0) return '—'
  const P = parseFloat(annP)
  const T = parseFloat(annT)

  // Polar
  if (tWarm < 10) return tWarm < 0 ? 'EF (Ice cap)' : 'ET (Tundra)'

  // Arid threshold
  const pSummer = pMonthly.slice(3,9).filter(v=>v!=null).reduce((a,b)=>a+b,0)
  const pWinter = [...pMonthly.slice(0,3), ...pMonthly.slice(9)].filter(v=>v!=null).reduce((a,b)=>a+b,0)
  const summerHeavy = pSummer > pWinter * 2.33
  const winterHeavy = pWinter > pSummer * 2.33
  let pThresh = summerHeavy ? 2*T + 28 : winterHeavy ? 2*T : 2*T + 14
  pThresh *= 10   // monthly→annual (×12 already factored in above)

  if (P < pThresh / 2) return T < 18 ? 'BWk (Cold desert)' : 'BWh (Hot desert)'
  if (P < pThresh)     return T < 18 ? 'BSk (Cold steppe)' : 'BSh (Hot steppe)'

  // Tropical
  if (tCold >= 18) {
    const pDry = Math.min(...pMonthly.filter(v=>v!=null))
    if (pDry >= 60) return 'Af (Tropical rainforest)'
    if (pDry >= 100 - P / 25) return 'Am (Tropical monsoon)'
    return 'Aw (Tropical savanna)'
  }

  // Temperate / Continental
  const summerP    = pMonthly.slice(3,9).filter(v => v != null)
  const winterP    = [...pMonthly.slice(0,3), ...pMonthly.slice(9)].filter(v => v != null)
  const minSummerP = summerP.length ? Math.min(...summerP) : Infinity
  const maxSummerP = summerP.length ? Math.max(...summerP) : 0
  const maxWinterP = winterP.length ? Math.max(...winterP) : 0
  const minWinterP = winterP.length ? Math.min(...winterP) : Infinity
  // Cs: driest summer month < 40 mm AND < 1/3 of wettest winter month
  const hasDrySummer = minSummerP < 40 && maxWinterP > 0 && minSummerP < maxWinterP / 3
  // Cw: driest winter month < 1/10 of wettest summer month
  const hasDryWinter = maxSummerP > 0 && minWinterP < maxSummerP / 10

  const hotSummer  = tWarm >= 22
  const warmSummer = tMonthly.filter(v=>v!=null).filter(v=>v>=10).length >= 4

  if (tCold > -3) {
    // Temperate (C)
    if (hasDrySummer) return hotSummer ? 'Csa (Hot-summer Mediterranean)' : 'Csb (Warm-summer Mediterranean)'
    if (hasDryWinter) return hotSummer ? 'Cwa (Humid subtropical)' : 'Cwb (Subtropical highland)'
    return hotSummer ? 'Cfa (Humid subtropical)' : warmSummer ? 'Cfb (Oceanic)' : 'Cfc (Subpolar oceanic)'
  } else {
    // Continental (D)
    if (hasDrySummer) return hotSummer ? 'Dsa (Continental hot-dry summer)' : 'Dsb/Dsc (Continental dry summer)'
    if (hasDryWinter) return hotSummer ? 'Dwa (Humid continental)' : 'Dwb/Dwc (Continental dry winter)'
    if (hotSummer)    return 'Dfa (Hot-summer humid continental)'
    if (warmSummer)   return 'Dfb (Warm-summer humid continental)'
    if (tCold > -38)  return 'Dfc (Subarctic)'
    return 'Dfd/Dwd (Extreme subarctic)'
  }
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

        <!-- ── Phase flux chips ── -->
        <div v-if="phaseFluxStats" class="phase-flux-wrap">
          <div class="phase-flux-hd" @click="phaseFluxOpen=!phaseFluxOpen">
            <span>🌱 Mean fluxes by phenological phase (gC m⁻² yr⁻¹)</span>
            <span class="toggle-arrow">{{ phaseFluxOpen ? '▲' : '▼' }}</span>
          </div>
          <div v-show="phaseFluxOpen" class="phase-flux-body">
            <div v-for="ph in phaseFluxStats" :key="ph.label" class="phase-flux-row"
                 :style="{borderLeftColor: ph.color}">
              <span class="pfr-label" :style="{color: ph.color}">{{ ph.label }}</span>
              <span class="pfr-kv"><span class="pfr-k">GPP</span> <span class="pfr-v">{{ ph.gpp }}</span></span>
              <span class="pfr-kv"><span class="pfr-k">RECO</span> <span class="pfr-v">{{ ph.reco }}</span></span>
              <span class="pfr-kv"><span class="pfr-k" :style="{color: ph.nee<0?'#4ade80':'#f87171'}">NEE</span>
                <span class="pfr-v" :style="{color: ph.nee<0?'#4ade80':'#f87171'}">{{ ph.nee }}</span></span>
            </div>
          </div>
        </div>
        <!-- ── Scaler KPIs ── -->
        <div v-if="healthStats" class="scaler-kpi-wrap">
          <div class="scaler-kpi-hd" @click="healthOpen=!healthOpen">
            <span>🌿 Scalers (simulation mean)</span>
            <span class="toggle-arrow">{{ healthOpen ? '▲' : '▼' }}</span>
          </div>
          <div v-show="healthOpen" class="scaler-kpi-body">
            <div v-for="s in healthStats.scores" :key="s.label" class="scaler-chip"
                 :style="{borderColor: s.color + '88'}">
              <span class="scaler-dot" :style="{background:s.color}"></span>
              <span class="scaler-label">{{ s.label }}</span>
              <span class="scaler-val" :style="{color:s.color}">{{ s.pct }}%</span>
            </div>
          </div>
        </div>

        <!-- ── Climate synthetics ── -->
        <div v-if="climateStats" class="climate-strip">
          <div class="cs-koppen">{{ climateStats.koppen }}</div>
          <div class="cs-grid">
            <div v-for="(s, name) in climateStats.seasonal" :key="name" class="cs-season">
              <span class="cs-sname">{{ name }}</span>
              <span class="cs-t">{{ s.t }}°C</span>
              <span class="cs-p">{{ s.p }} mm</span>
            </div>
            <div class="cs-season cs-ann">
              <span class="cs-sname">Annual</span>
              <span class="cs-t">{{ climateStats.annT }}°C</span>
              <span class="cs-p">{{ climateStats.annP }} mm</span>
            </div>
          </div>
          <!-- Climogram (collapsible) -->
          <div class="cs-climo-wrap">
            <div class="cs-climo-hd" @click="climoOpen=!climoOpen">
              <span>Climogram</span>
              <span class="toggle-arrow">{{ climoOpen ? '▲' : '▼' }}</span>
            </div>
            <div v-show="climoOpen" class="cs-climo-body">
              <canvas ref="climoCanvas" style="height:160px"></canvas>
            </div>
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
                <th>Year</th><th>GPP</th><th>RECO</th><th>NEE</th>
                <th title="Carbon Use Efficiency">CUE</th>
                <th>T mean</th><th>P total</th><th>Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="y in yearlyStats" :key="y.year"
                  :class="y.isSink ? 'yr-sink' : 'yr-source'">
                <td class="yr-year">{{ y.year }}</td>
                <td class="yr-gpp">{{ y.gpp }}</td>
                <td class="yr-reco">{{ y.reco }}</td>
                <td :class="['yr-nee', y.isSink ? 'yr-nee-sink' : 'yr-nee-src']">{{ y.nee }}</td>
                <td>{{ y.cue }}</td>
                <td>{{ y.tMean ?? '—' }}°C</td>
                <td>{{ y.pTotal ?? '—' }} mm</td>
                <td class="yr-badge">
                  <span :class="y.isSink ? 'sink-chip' : 'src-chip'">
                    {{ y.isSink ? 'sink' : 'source' }}
                  </span>
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr class="yr-unit">
                <td colspan="4">GPP/RECO/NEE in gC m⁻² yr⁻¹</td>
                <td colspan="4"></td>
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
                <th title="Start of Growing Season">SGS</th>
                <th title="Maturity — first day Greendown">MAT</th>
                <th title="Start of Senescence">SEN</th>
                <th title="End of Growing Season">EGS</th>
                <th title="Growing Season Length">GSL</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in phenoMetrics" :key="m.year">
                <td class="yr-year">{{ m.year }}</td>
                <td>{{ doyToLabel(m.year, m.sgs) }}</td>
                <td>{{ doyToLabel(m.year, m.mat) }}</td>
                <td>{{ doyToLabel(m.year, m.sen) }}</td>
                <td>{{ doyToLabel(m.year, m.egs) }}</td>
                <td>{{ m.gsl != null ? m.gsl + ' d' : '—' }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr class="yr-unit"><td colspan="6">Calendar dates · GSL = growing season length</td></tr>
            </tfoot>
          </table>
        </div>

        <!-- ── Toolbar ── -->
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
          <span class="toolbar-info">{{ visibleDays }} pts</span>
          <div class="agg-toggle">
            <button :class="['agg-btn', aggMode==='daily'  && 'active']" @click="aggMode='daily'">Day</button>
            <button :class="['agg-btn', aggMode==='hourly' && 'active']" @click="aggMode='hourly'">Hr</button>
          </div>
          <button class="btn-outline btn-sm" style="margin-left:4px" @click="downloadCsv" :disabled="!rawCsvText">⬇ CSV</button>
          <button class="chart-zoom-reset" @click="resetAllZoom" title="Reset zoom">⤢</button>
          <!-- 3D toggle -->
          <button :class="['agg-btn', show3D && 'active']" @click="toggle3D" title="3D surface (DOY × Hour)">🌐 3D</button>
        </div>

        <!-- ── Charts + Variable panel ── -->
        <div class="charts-layout">

          <div class="charts-area">

            <!-- 3D surface panel: takes full chart area when active -->
            <div v-if="show3D" class="chart-card" style="height:600px;margin-bottom:8px;display:flex;flex-direction:column">
              <div class="chart-hd">
                <span class="chart-title-tag" style="background:#6366f1">3D</span>
                <span class="chart-subtitle-tag">Seasonal × Diurnal cycle (DOY × Hour)</span>
                <select v-model="var3D" @change="build3D" class="var3d-sel" style="margin-left:8px;font-size:11px;background:#1e2d44;color:#94a3b8;border:1px solid #243050;border-radius:4px;padding:2px 4px">
                  <option v-for="v in numeric3DVars" :key="v" :value="v">{{ v }}</option>
                </select>
              </div>
              <div ref="surf3D" style="flex:1;min-height:0"></div>
            </div>

            <!-- SWELL chart: hidden when 3D active -->
            <div v-show="!show3D" class="chart-card chart-card-tall">
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

            <!-- FLUXES chart: hidden when 3D active -->
            <div v-show="!show3D" class="chart-card chart-card-tall" style="margin-top:8px">
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

          <!-- Right: variable toggle panel (tabbed) -->
          <div class="var-panel">
            <div class="var-tab-bar">
              <button v-for="t in varTabList" :key="t.key"
                      :class="['var-tab-btn', varTab===t.key && 'active']"
                      @click="varTab=t.key">{{ t.label }}</button>
            </div>
            <div v-for="col in varTabCols" :key="col"
                 :class="['var-row', isVarOn(col) && 'on']"
                 @click="toggleVar(col)">
              <span class="var-dot" :style="'background:'+varColor(col)+'44;border:1.5px solid '+varColor(col)"></span>
              <span class="var-name">{{ col }}</span>
              <span :class="['var-axis-tag', IS_FLUX(col) ? 'ax-flux' : IS_WEATHER(col) ? 'ax-right' : 'ax-left']">
                {{ IS_FLUX(col) ? 'F' : IS_WEATHER(col) ? 'R' : 'L' }}
              </span>
              <span :class="['var-sw', isVarOn(col) && 'on']"></span>
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
      aggMode:       'daily',
      chartType:     'line',
      swellDatasets: ['SWELL'],
      fluxDatasets:  ['GPP','RECO','NEE'],
      dateFrom:      '',
      dateTo:        '',
      _swellChart:   null,
      _fluxChart:    null,
      _hasZoom:      typeof Chart !== 'undefined' && !!Chart.registry?.plugins?.get('zoom'),
      _hasAnnotation:typeof Chart !== 'undefined' && !!Chart.registry?.plugins?.get('annotation'),
      _rebuilding:      false,
      _settingFromLoad: false,
      showYearTable:  false,
      showPhenoTable: false,
      show3D:         false,
      var3D:          'GPP',
      climoOpen:      true,
      _climoChart:    null,
      varTab:         'main',
      locationName:   '',
      healthOpen:     true,
      phaseFluxOpen:  true,
      healthStats:    null,
      rawCsvText:        '',
      MONTH_NAMES:    ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
    }
  },

  computed: {
    hasData()  { return this.hourly.length > 0 },
    daily()    { return dailyAgg(this.hourly, this.numericCols) },

    agg() {
      if (this.aggMode === 'hourly') {
        let d = this.hourly
        if (this.dateFrom) d = d.filter(r => r.date >= this.dateFrom)
        if (this.dateTo)   d = d.filter(r => r.date <= this.dateTo)
        return d
      }
      return this.daily
    },

    filteredAgg() {
      if (this.aggMode === 'hourly') return this.agg
      let d = this.daily
      if (this.dateFrom) d = d.filter(r => r.date >= this.dateFrom)
      if (this.dateTo)   d = d.filter(r => r.date <= this.dateTo)
      return d.length ? d : this.daily
    },

    dataDateMin() { return this.daily[0]?.date ?? '' },
    dataDateMax() { return this.daily[this.daily.length-1]?.date ?? '' },
    visibleDays()  { return this.filteredAgg.length },

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
      const toGC = arr => +((arr.reduce((a,b)=>a+b,0) * 86400 * 12.01 / 1e6 / nYears).toFixed(1))
      const annGPP  = toGC(gpp)
      const annRECO = toGC(reco)
      const annNEE  = toGC(nee)

      return {
        annNEE, annGPP, annRECO,
        peakGPP: +Math.max(0,...gpp).toFixed(2), nDays,
        filtered: !!(this.dateFrom || this.dateTo),
      }
    },

    varTabGroups() {
      const cols = this.numericCols.filter(c => !HIDDEN_VARS.has(c.toLowerCase()))
      const used = new Set()
      const result = {}
      for (const g of VAR_TAB_GROUPS) {
        if (g.key === 'other') {
          result.other = cols.filter(c => !used.has(c))
        } else {
          result[g.key] = cols.filter(c => g.match(c) && !used.has(c))
          result[g.key].forEach(c => used.add(c))
        }
      }
      return result
    },

    varTabList() {
      const tabs = this.varTabGroups
      return VAR_TAB_GROUPS
        .filter(g => (tabs[g.key] ?? []).length > 0)
        .map(g => ({ key: g.key, label: g.label }))
    },

    varTabCols() {
      return this.varTabGroups[this.varTab] ?? []
    },

    csvFilename() {
      const name = (this.locationName || 'breath').replace(/[^a-zA-Z0-9_\-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')
      const rows = this.hourly
      const y1 = rows[0]?.date?.slice(0,4) || ''
      const y2 = rows[rows.length-1]?.date?.slice(0,4) || ''
      const period = y1 && y2 ? (y1 === y2 ? y1 : `${y1}-${y2}`) : 'results'
      return `${name || 'breath'}_${period}.csv`
    },

    numeric3DVars() {
      return this.numericCols.filter(c => !HIDDEN_VARS.has(c.toLowerCase()) && !EXCLUDE_COLS.has(c.toLowerCase()))
    },

    phenoMetrics() {
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
      const prevPhase = {}

      for (const r of this.hourly) {
        const yr = r.date?.slice(0,4); if (!yr) continue
        if (!byYear[yr]) byYear[yr] = { sgs:null, mat:null, sen:null, egs:null }
        const m    = byYear[yr]
        const cur  = (r[phaseKey] ?? '').toString()
        const prev = prevPhase[yr] ?? ''
        const doy  = r.doy ?? doyFromDate(r.date)
        if (!doy) { prevPhase[yr] = cur; continue }
        const changed = cur !== prev
        if (m.sgs == null && /growth/i.test(cur) && changed)        m.sgs = doy
        if (m.mat == null && /green/i.test(cur) && changed && m.sgs != null) m.mat = doy
        if (m.sen == null && /senesc/i.test(cur) && changed)          m.sen = doy
        if (m.egs == null && /dorm|induct/i.test(cur) && changed && m.mat != null) m.egs = doy
        prevPhase[yr] = cur
      }

      return Object.entries(byYear).sort(([a],[b])=>a<b?-1:1)
        .map(([yr, m]) => ({
          year: yr, sgs: m.sgs, mat: m.mat, sen: m.sen, egs: m.egs,
          gsl: (m.sgs && m.egs) ? m.egs - m.sgs : null,
        }))
    },

    phaseFluxStats() {
      if (!this.phenoMetrics.length || !this.daily.length) return null
      // Phases: dormancy (EGS→SGS next year), growth (SGS→MAT), greendown (MAT→SEN), senescence (SEN→EGS)
      const acc = {
        growth:     { gpp:0, reco:0, nee:0, n:0 },
        greendown:  { gpp:0, reco:0, nee:0, n:0 },
        senescence: { gpp:0, reco:0, nee:0, n:0 },
        dormancy:   { gpp:0, reco:0, nee:0, n:0 },
      }
      const toGC = (sum, n) => n ? +(sum / n * 86400 * 12.01 / 1e6).toFixed(1) : 0
      const phaseFor = (yr, doy) => {
        const m = this.phenoMetrics.find(p => p.year == yr)
        if (!m) return null
        if (m.sgs && m.mat && doy >= m.sgs && doy < m.mat) return 'growth'
        if (m.mat && m.sen && doy >= m.mat && doy < m.sen) return 'greendown'
        if (m.sen && m.egs && doy >= m.sen && doy < m.egs) return 'senescence'
        if (m.sgs) return 'dormancy'
        return null
      }
      for (const r of this.daily) {
        if (!r.date) continue
        const yr = r.date.slice(0,4)
        const doy = r.doy ?? (() => {
          const d = new Date(r.date); const s = new Date(d.getFullYear(),0,0)
          return Math.floor((d-s)/86400000)
        })()
        const ph = phaseFor(yr, doy)
        if (!ph) continue
        const g = r.GPP ?? r.gpp ?? 0
        const rc = r.RECO ?? r.reco ?? 0
        const n = r.NEE ?? r.nee ?? 0
        acc[ph].gpp  += g;  acc[ph].reco += rc; acc[ph].nee += n; acc[ph].n++
      }
      const result = [
        { label: 'Growth',     color: '#4ade80', gpp: toGC(acc.growth.gpp,    acc.growth.n),    reco: toGC(acc.growth.reco,    acc.growth.n),    nee: toGC(acc.growth.nee,    acc.growth.n),    n: acc.growth.n },
        { label: 'Greendown',  color: '#facc15', gpp: toGC(acc.greendown.gpp, acc.greendown.n), reco: toGC(acc.greendown.reco, acc.greendown.n), nee: toGC(acc.greendown.nee, acc.greendown.n), n: acc.greendown.n },
        { label: 'Senescence', color: '#f97316', gpp: toGC(acc.senescence.gpp,acc.senescence.n),reco: toGC(acc.senescence.reco,acc.senescence.n),nee: toGC(acc.senescence.nee,acc.senescence.n),n: acc.senescence.n },
        { label: 'Dormancy',   color: '#94a3b8', gpp: toGC(acc.dormancy.gpp,  acc.dormancy.n),  reco: toGC(acc.dormancy.reco,  acc.dormancy.n),  nee: toGC(acc.dormancy.nee,  acc.dormancy.n),  n: acc.dormancy.n },
      ].filter(p => p.n > 0)
      return result.length ? result : null
    },

    climateStats() {
      if (!this.daily.length) return null

      // Temperature: from daily aggregated rows (mean of hourly values)
      // Precipitation: sum hourly p values per day (gives mm/day regardless of input units),
      //   then accumulate per year-month and average across years → avg mm/month
      const monthlyT  = {}   // '01'…'12' → [daily mean °C]
      const dayPrecip = {}   // 'YYYY-MM-DD' → mm that day (sum of hourly p)
      for (const r of this.hourly) {
        if (!r.date) continue
        const mm = r.date.slice(5,7)
        if (r.t != null && isFinite(r.t)) {
          // only once per day for temperature (use daily rows below instead)
        }
        if (r.p != null && isFinite(r.p))
          dayPrecip[r.date] = (dayPrecip[r.date] ?? 0) + r.p
      }
      for (const r of this.daily) {
        const mm = r.date?.slice(5,7); if (!mm) continue
        if (r.t != null && isFinite(r.t)) {
          if (!monthlyT[mm]) monthlyT[mm] = []
          monthlyT[mm].push(r.t)
        }
      }
      // Accumulate daily mm to year-month totals, then average across years
      const ymPrecip = {}
      for (const [date, mm_day] of Object.entries(dayPrecip)) {
        const ym = date.slice(0,7)
        ymPrecip[ym] = (ymPrecip[ym] ?? 0) + mm_day
      }

      const months = Array.from({length:12}, (_,i) => String(i+1).padStart(2,'0'))
      const tMonthly = months.map(mm =>
        monthlyT[mm]?.length ? monthlyT[mm].reduce((a,b)=>a+b,0)/monthlyT[mm].length : null)

      // Average monthly precip: mean of per-year monthly totals
      const pMonthly = months.map(mm => {
        const vals = Object.entries(ymPrecip)
          .filter(([ym]) => ym.slice(5,7) === mm)
          .map(([,v]) => v)
        return vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : null
      })

      // Seasonal (DJF, MAM, JJA, SON)
      const seas = { DJF:[11,0,1], MAM:[2,3,4], JJA:[5,6,7], SON:[8,9,10] }
      const seasonal = {}
      for (const [s, idxs] of Object.entries(seas)) {
        const tVals = idxs.map(i => tMonthly[i]).filter(v => v != null)
        const pMm   = idxs.reduce((sum,i) => sum + (pMonthly[i] ?? 0), 0)
        seasonal[s] = {
          t: tVals.length ? (tVals.reduce((a,b)=>a+b,0)/tVals.length).toFixed(1) : '—',
          p: pMm.toFixed(0)
        }
      }

      const tAnn = tMonthly.filter(v=>v!=null)
      const annT = tAnn.length ? (tAnn.reduce((a,b)=>a+b,0)/tAnn.length).toFixed(1) : '—'
      const annP = pMonthly.filter(v=>v!=null).reduce((a,b)=>a+(b??0),0).toFixed(0)
      const tCold = tAnn.length ? Math.min(...tAnn) : 0
      const tWarm = tAnn.length ? Math.max(...tAnn) : 0

      const koppen = koppenClassify(annT, tCold, tWarm, annP, pMonthly, tMonthly)

      // Monthly mini-chart values: normalize for display
      const maxP = Math.max(1, ...pMonthly.filter(v=>v!=null))
      const minT = Math.min(...tAnn), maxT = Math.max(...tAnn)
      const monthly12 = months.map((m,i) => {
        const p = pMonthly[i] ?? 0
        const t = tMonthly[i] ?? ((minT+maxT)/2)
        return {
          p:  p.toFixed(0),
          t:  t.toFixed(1),
          pH: Math.round(p / maxP * 40),
          tPos: Math.round((t - minT) / Math.max(1, maxT - minT) * 30) + 5,
        }
      })

      return { seasonal, annT, annP, koppen, tMonthly, pMonthly, monthly: monthly12 }
    },

    yearlyStats() {
      const byYear = {}
      for (const r of this.daily) {
        const yr = r.date?.slice(0,4); if (!yr) continue
        if (!byYear[yr]) byYear[yr] = { gpp:[], reco:[], nee:[], t:[], p:[], n:0 }
        const acc = byYear[yr]
        if (r.GPP  != null) { acc.gpp.push(r.GPP);   acc.n++ }
        if (r.RECO != null)   acc.reco.push(r.RECO)
        if (r.NEE  != null)   acc.nee.push(r.NEE)
        if (r.t    != null)   acc.t.push(r.t)
        if (r.p    != null)   acc.p.push(r.p * 24)  // mm/h → mm/day
      }
      const toGC = arr => arr.length
        ? Math.round(arr.reduce((a,b)=>a+b,0) * 86400 * 12.01 / 1e6)
        : null
      return Object.entries(byYear)
        .sort(([a],[b]) => a < b ? -1 : 1)
        .map(([yr, d]) => {
          const gpp  = toGC(d.gpp)
          const reco = toGC(d.reco)
          const nee  = toGC(d.nee)
          const tMean = d.t.length ? (d.t.reduce((a,b)=>a+b,0)/d.t.length).toFixed(1) : null
          const pTotal = d.p.length ? Math.round(d.p.reduce((a,b)=>a+b,0)) : null
          const cue = gpp && reco ? (gpp/reco).toFixed(2) : '—'
          return { year: yr, gpp, reco, nee, cue, tMean, pTotal, isSink: (nee ?? 0) < 0 }
        })
    },

  },

  watch: {
    aggMode()  { if (!this._settingFromLoad) { this._extractZoomToDates(); nextTick(() => this.rebuild()) } },
    chartType(){ if (!this._settingFromLoad) nextTick(() => this.rebuild()) },
    dateFrom() { if (!this._settingFromLoad) nextTick(() => this.rebuild()) },
    dateTo()   { if (!this._settingFromLoad) nextTick(() => this.rebuild()) },
    climateStats(v) { if (v) nextTick(() => this.buildClimoChart()) },
    climoOpen(v)    { if (v) nextTick(() => this.buildClimoChart()) },
  },

  mounted() {
    this._keyHandler = e => {
      if (!this.hasData) return
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      // Only pan when focus is not in an input/select
      if (['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName)) return
      const panPx = e.shiftKey ? 200 : 60
      const delta = e.key === 'ArrowRight' ? -panPx : panPx
      for (const c of [this._swellChart, this._fluxChart]) {
        if (c && typeof c.pan === 'function') {
          try { c.pan({ x: delta }); this._syncZoom(c) } catch {}
        }
      }
      e.preventDefault()
    }
    document.addEventListener('keydown', this._keyHandler)
  },

  beforeUnmount() {
    document.removeEventListener('keydown', this._keyHandler)
    this._swellChart?.destroy()
    this._fluxChart?.destroy()
    this._climoChart?.destroy()
  },

  methods: {
    fmt(n) { return n.toLocaleString() },
    downloadCsv() {
      if (!this.rawCsvText) return
      const blob = new Blob([this.rawCsvText], { type: 'text/csv' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = this.csvFilename
      a.click()
      URL.revokeObjectURL(url)
    },
    doyToLabel(year, doy) {
      if (doy == null) return '—'
      const d = new Date(parseInt(year), 0, doy)
      return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    },
    clearBrush() { this.dateFrom=''; this.dateTo='' },
    varColor, IS_WEATHER, IS_FLUX,
    isVarOn(col)   { return IS_FLUX(col) ? this.fluxDatasets.includes(col) : this.swellDatasets.includes(col) },

    toggleVar(col) {
      if (IS_FLUX(col)) {
        const idx = this.fluxDatasets.indexOf(col)
        if (idx >= 0) {
          if (this.fluxDatasets.length <= 1) return
          this.fluxDatasets = this.fluxDatasets.filter((_,i) => i !== idx)
        } else {
          this.fluxDatasets = [...this.fluxDatasets, col]
        }
        this._patchChart('flux')
      } else {
        const idx = this.swellDatasets.indexOf(col)
        if (idx >= 0) {
          if (this.swellDatasets.length <= 1) return
          this.swellDatasets = this.swellDatasets.filter((_,i) => i !== idx)
        } else {
          this.swellDatasets = [...this.swellDatasets, col]
        }
        this._patchChart('swell')
      }
    },

    _patchChart(which) {
      // Save current zoom before destroying the chart
      const old = which === 'swell' ? this._swellChart : this._fluxChart
      let savedMin, savedMax
      if (old?.scales?.x) { savedMin = old.scales.x.min; savedMax = old.scales.x.max }
      nextTick(() => {
        if (which === 'swell') this.buildSwellChart()
        else this.buildFluxChart()
        // Restore zoom after rebuild
        if (savedMin != null && savedMax != null && this._hasZoom) {
          const c = which === 'swell' ? this._swellChart : this._fluxChart
          try { c?.zoomScale?.('x', { min: savedMin, max: savedMax }, 'none') } catch {}
        }
      })
    },

    _extractZoomToDates() {
      const chart = this._swellChart || this._fluxChart
      if (!chart) return
      const labels = chart.data.labels
      if (!labels?.length) return
      const sc = chart.scales.x
      const minIdx = sc.min != null ? Math.round(sc.min) : 0
      const maxIdx = sc.max != null ? Math.round(sc.max) : labels.length - 1
      if (minIdx > 0 || maxIdx < labels.length - 1) {
        const from = (labels[Math.max(0, minIdx)] ?? '').slice(0, 10)
        const to   = (labels[Math.min(labels.length - 1, maxIdx)] ?? '').slice(0, 10)
        if (from && to) {
          this._settingFromLoad = true
          this.dateFrom = from
          this.dateTo   = to
          this._settingFromLoad = false
        }
      }
    },

    toggle3D() {
      this.show3D = !this.show3D
      if (this.show3D) nextTick(() => this.build3D())
    },

    // ── 3D Surface (Plotly.js) ────────────────────────────────────────────
    build3D() {
      const el = this.$refs.surf3D
      if (!el || typeof Plotly === 'undefined') return
      const varName = this.var3D
      if (!this.numericCols.includes(varName)) return

      const grid = {}
      for (const r of this.hourly) {
        const val = r[varName]
        if (val == null || !isFinite(val)) continue
        const dt  = new Date(r.date)
        const doy = Math.floor((dt - new Date(dt.getFullYear(), 0, 0)) / 86400000)
        const hr  = r.hour != null ? +r.hour : (r._dt ? parseInt(r._dt.slice(11,13)) : 12)
        const k   = `${doy}_${hr}`
        if (!grid[k]) grid[k] = []
        grid[k].push(val)
      }

      const doys  = Array.from({length:365}, (_,i)=>i+1)
      const hours = Array.from({length:24},  (_,i)=>i+1)

      // Matrix: rows=hours, cols=doys → x=doys (long axis), y=hours (short axis)
      const zData = hours.map(hr =>
        doys.map(doy => {
          const v = grid[`${doy}_${hr}`]
          return v && v.length ? v.reduce((a,b)=>a+b,0)/v.length : null
        })
      )

      const colorscale = IS_FLUX(varName) ? 'Viridis' : 'YlOrRd'

      const traces = [{
        type:       'surface',
        x:          doys,   // long axis
        y:          hours,  // short axis
        z:          zData,
        colorscale,
        colorbar: {
          orientation: 'h',
          x: 0.5, xanchor: 'center',
          y: 1.02, yanchor: 'bottom',
          len: 0.6, thickness: 10,
          title: { text: varUnit(varName) || varName, side: 'top', font: { size: 9, color: '#94a3b8' } },
          tickfont: { color: '#94a3b8', size: 8 },
        },
        contours: {
          z: { show: true, usecolormap: true, highlightcolor: '#42f462', project: { z: false } }
        },
      }]

      const swellKey = this.numericCols.find(c => /^swell$/i.test(c))
      if (swellKey && swellKey !== varName) {
        const swellByDoy = {}
        for (const r of this.hourly) {
          const v   = r[swellKey]
          if (v == null || !isFinite(v)) continue
          const dt  = new Date(r.date)
          const doy = Math.floor((dt - new Date(dt.getFullYear(), 0, 0)) / 86400000)
          if (!swellByDoy[doy]) swellByDoy[doy] = []
          swellByDoy[doy].push(v)
        }
        const zRange = zData.flat().filter(v => v != null)
        const zMin   = zRange.length ? Math.min(...zRange) : 0
        const zMax   = zRange.length ? Math.max(...zRange) : 1
        const swellZ = doys.map(d => {
          const vals = swellByDoy[d]
          if (!vals?.length) return null
          const avg = vals.reduce((a,b)=>a+b,0)/vals.length
          return zMin + avg * (zMax - zMin)
        })
        traces.push({
          type: 'scatter3d',
          mode: 'lines',
          x: doys,
          y: Array(doys.length).fill(12),
          z: swellZ,
          line: { color: '#facc15', width: 4 },
          name: 'SWELL',
          hovertemplate: 'DOY %{x}<br>SWELL %{customdata:.2f}<extra></extra>',
          customdata: doys.map(d => {
            const vals = swellByDoy[d]; return vals?.length ? vals.reduce((a,b)=>a+b,0)/vals.length : null
          }),
        })
      }

      Plotly.react(el, traces, {
        paper_bgcolor: '#0e1520',
        plot_bgcolor:  '#0e1520',
        margin: { l:10, r:10, t:60, b:20 },
        scene: {
          xaxis: { title: 'DOY',  color: '#64748b', gridcolor: '#1e2d44', zerolinecolor: '#1e2d44' },
          yaxis: { title: 'Hour', color: '#64748b', gridcolor: '#1e2d44', zerolinecolor: '#1e2d44' },
          zaxis: { title: varUnit(varName) || varName, color: '#64748b', gridcolor: '#1e2d44' },
          bgcolor: '#0e1520',
          aspectmode: 'manual',
          aspectratio: { x: 2, y: 1, z: 0.6 },
          camera: { eye: { x: 1.8, y: -1.2, z: 0.8 } },
        },
        showlegend: true,
        legend: { x: 0.01, y: 0.99, font: { color: '#94a3b8', size: 9 }, bgcolor: 'transparent' },
        font: { color: '#94a3b8' },
      }, { responsive: true, displaylogo: false })
    },

    // ── Zoom sync ─────────────────────────────────────────────
    _syncZoom(source) {
      if (this.__syncing) return
      this.__syncing = true
      const { min, max } = source.scales.x
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
      this._swellChart?.resetZoom?.()
      this._fluxChart?.resetZoom?.()
      this.__syncing = false
    },

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
      const nYears   = this.phenoMetrics.length
      const lastYear = nYears ? this.phenoMetrics[nYears - 1].year : null
      const annotations = {}
      for (const m of this.phenoMetrics) {
        const isLast = m.year === lastYear
        for (const [key, cfg] of Object.entries(MARKERS)) {
          if (m[key] == null) continue
          const dateStr = doyToDate(m.year, m[key])
          annotations[`${key}_${m.year}`] = {
            type: 'line',
            xMin: dateStr, xMax: dateStr,
            borderColor: cfg.color,
            borderWidth: isLast ? 1.5 : 0.6,
            borderDash: [4, 3],
            label: {
              display: isLast,
              content: cfg.label,
              position: 'start',
              color: cfg.color,
              backgroundColor: 'rgba(14,21,32,0.8)',
              font: { size: 9 },
              padding: 2,
            },
          }
        }
      }
      // Extra: one label per non-last year at SGS position showing just the year number
      for (const m of this.phenoMetrics) {
        if (m.year === lastYear || m.sgs == null) continue
        const dateStr = doyToDate(m.year, m.sgs)
        annotations[`year_${m.year}`] = {
          type: 'label',
          xValue: dateStr,
          yAdjust: -4,
          backgroundColor: 'rgba(14,21,32,0.8)',
          borderColor: '#4ade8066',
          borderWidth: 1,
          borderRadius: 3,
          content: [m.year],
          color: '#4ade80',
          font: { size: 8 },
          padding: 2,
        }
      }
      return annotations
    },

    _makeDatasets(names, chartName) {
      const d    = this.filteredAgg
      const isLn = this.chartType === 'line'
      return names.filter(n => this.numericCols.includes(n)).map(n => {
        const c    = varColor(n)
        const yId  = yAxisFor(chartName, n)
        const isRef = n.toLowerCase() === 'reference'

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
            wheel: { enabled: true, modifierKey: 'ctrl' },
            pinch: { enabled: true },
            drag:  { enabled: true, backgroundColor: 'rgba(59,130,246,0.15)', borderColor: '#3b82f6', borderWidth: 1 },
            mode:  'x',
            onZoom:         ({ chart }) => this._syncZoom(chart),
            onZoomComplete: ({ chart }) => this._syncZoom(chart),
          },
          pan: {
            enabled: true,
            mode:    'x',
            modifierKey: 'shift',
            onPan:         ({ chart }) => this._syncZoom(chart),
            onPanComplete: ({ chart }) => this._syncZoom(chart),
          },
        },
      }
    },

    _xAxis() {
      return { ticks:{color:'#64748b', maxTicksLimit:7, font:{size:9}}, grid:{color:'#1e2d44'} }
    },

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
          responsive: true, maintainAspectRatio: false, animation: {duration:0},
          interaction: { mode:'index', intersect:false },
          plugins: {
            decimation: { enabled: this.aggMode==='hourly', algorithm:'lttb', samples:1200, threshold:1200 },
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
          responsive: true, maintainAspectRatio: false, animation: {duration:0},
          interaction: { mode:'index', intersect:false },
          plugins: {
            decimation: { enabled: this.aggMode==='hourly', algorithm:'lttb', samples:1200, threshold:1200 },
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

    buildClimoChart() {
      const stats = this.climateStats
      if (!stats || !this.$refs.climoCanvas) return
      this._climoChart?.destroy()
      const tData = stats.monthly.map(m => parseFloat(m.t))
      const pData = stats.monthly.map(m => parseFloat(m.p))
      this._climoChart = new Chart(this.$refs.climoCanvas, {
        type: 'bar',
        data: {
          labels: this.MONTH_NAMES,
          datasets: [
            {
              type: 'line',
              label: 'T (°C)',
              data: tData,
              yAxisID: 'yT',
              borderColor: '#fb7185',
              backgroundColor: 'transparent',
              borderWidth: 2,
              pointRadius: 3,
              pointHoverRadius: 5,
              tension: 0.4,
              order: 1,
            },
            {
              type: 'bar',
              label: 'P (mm)',
              data: pData,
              yAxisID: 'yP',
              backgroundColor: '#38bdf866',
              borderColor: '#38bdf8',
              borderWidth: 1,
              order: 2,
            },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false, animation: {duration:0},
          interaction: { mode:'index', intersect:false },
          plugins: {
            legend: { display: true, labels: { color:'#94a3b8', font:{size:9}, boxWidth:12 } },
            tooltip: {
              backgroundColor:'#182030', titleColor:'#7080a0', bodyColor:'#c8d8e8',
              borderColor:'#243050', borderWidth:1,
            },
          },
          scales: {
            x: { ticks:{ color:'#64748b', font:{size:9} }, grid:{ color:'#1e2d44' } },
            yT: {
              type:'linear', position:'left',
              ticks:{ color:'#fb7185', font:{size:9} },
              grid:{ color:'#1e2d44' },
              title:{ display:true, text:'°C', color:'#fb7185', font:{size:8} },
            },
            yP: {
              type:'linear', position:'right', min:0,
              ticks:{ color:'#38bdf8', font:{size:9} },
              grid:{ drawOnChartArea:false },
              title:{ display:true, text:'mm', color:'#38bdf8', font:{size:8} },
            },
          },
        },
      })
    },

    _computeHealth(rows, cols) {
      const AXES = [
        { key: 'tscale',      label: 'T scale',   color: '#fbbf24', invert: false },
        { key: 'parscale',    label: 'PAR scale', color: '#fef08a', invert: false },
        { key: 'vpdscale',    label: 'VPD scale', color: '#c084fc', invert: false },
        { key: 'waterstress', label: 'Water',     color: '#818cf8', invert: true  },
      ]
      const colMap = {}
      for (const ax of AXES) {
        const found = cols.find(c => c.toLowerCase() === ax.key)
        if (found) colMap[ax.key] = found
      }
      if (!Object.keys(colMap).length) return null
      const sums = {}, cnts = {}
      for (const ax of AXES) { sums[ax.key] = 0; cnts[ax.key] = 0 }
      for (const r of rows) {
        for (const ax of AXES) {
          const v = colMap[ax.key] ? r[colMap[ax.key]] : null
          if (v != null && isFinite(v)) { sums[ax.key] += v; cnts[ax.key]++ }
        }
      }
      const scores = AXES
        .filter(ax => cnts[ax.key] > 0)
        .map(ax => {
          const mean = sums[ax.key] / cnts[ax.key]
          const val  = ax.invert ? (1 - mean) : mean
          return { label: ax.label, color: ax.color, val: Math.max(0, Math.min(1, val)), pct: Math.round(val * 100) }
        })
      return scores.length ? { scores } : null
    },

    rebuild() {
      if (this._rebuilding) return
      this._rebuilding = true
      this._swellChart?.destroy(); this._swellChart = null
      this._fluxChart?.destroy();  this._fluxChart  = null
      nextTick(() => {
        this.buildSwellChart()
        this.buildFluxChart()
        if (this.show3D) this.build3D()
        this._rebuilding = false
      })
    },

    loadCsv(csv) {
      this.rawCsvText = csv
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
            row[col] = raw
          }
        })
        // Preserve hour as numeric for 3D
        if (hourIdx >= 0 && !isNaN(h)) row.hour = h
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
      // Default 3D variable
      if (!avail.has(this.var3D)) {
        this.var3D = this.numericCols.find(c => IS_FLUX(c)) ?? this.numericCols[0] ?? 'GPP'
      }
      // Suppress watcher cascade while resetting state
      this._settingFromLoad = true
      this.show3D   = false
      this.aggMode  = 'daily'
      this.dateFrom = ''
      this.dateTo   = ''
      this._settingFromLoad = false
      this._rebuilding = false
      // Destroy old charts immediately, build fresh after DOM update
      this.healthStats = this._computeHealth(rows, [...colSet])
      this._swellChart?.destroy(); this._swellChart = null
      this._fluxChart?.destroy();  this._fluxChart  = null
      nextTick(() => {
        this.buildSwellChart()
        this.buildFluxChart()
      })
    },
  },
})
})()
