<template>
  <div class="panel results-panel">
    <div class="flex items-center justify-between">
      <h2>Results — Carbon Fluxes</h2>
      <div class="flex gap-2 items-center">
        <label style="display:inline;margin:0">
          <select v-model="aggMode" class="select-sm">
            <option value="daily">Daily</option>
            <option value="monthly">Monthly mean</option>
          </select>
        </label>
        <label style="display:inline;margin:0">
          <select v-model="chartType" class="select-sm">
            <option value="line">Line</option>
            <option value="bar">Bar</option>
          </select>
        </label>
      </div>
    </div>

    <div v-if="!hasData" class="empty-state">
      <p>Run the model to see carbon flux results.</p>
      <p class="text-muted text-xs">GPP · RECO · NEE at hourly resolution</p>
    </div>

    <div v-else class="charts-grid">
      <!-- stats row -->
      <div class="stats-row">
        <div class="stat-card">
          <div class="stat-label">Mean GPP</div>
          <div class="stat-value text-green">{{ stats.meanGPP }} <span>µmol m⁻²s⁻¹</span></div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Mean RECO</div>
          <div class="stat-value text-red">{{ stats.meanRECO }} <span>µmol m⁻²s⁻¹</span></div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Annual NEE</div>
          <div class="stat-value" :class="stats.annualNEE < 0 ? 'text-green' : 'text-red'">
            {{ stats.annualNEE }} <span>gC m⁻²yr⁻¹</span>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Peak GPP</div>
          <div class="stat-value text-green">{{ stats.peakGPP }} <span>µmol m⁻²s⁻¹</span></div>
        </div>
      </div>

      <!-- charts -->
      <div class="chart-wrap">
        <canvas ref="gppCanvas"></canvas>
      </div>
      <div class="chart-wrap">
        <canvas ref="recoCanvas"></canvas>
      </div>
      <div class="chart-wrap">
        <canvas ref="neeCanvas"></canvas>
      </div>
    </div>
  </div>
</template>

<script>
import { Chart, registerables } from 'chart.js'
Chart.register(...registerables)

function mean(arr) {
  if (!arr.length) return 0
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

function aggregate(rows, mode) {
  if (mode === 'daily' || !rows.length) return rows
  // Monthly mean
  const monthly = {}
  for (const r of rows) {
    const key = r.date.slice(0, 7) // YYYY-MM
    if (!monthly[key]) monthly[key] = { date: key + '-15', gpp: [], reco: [], nee: [] }
    monthly[key].gpp.push(r.gpp)
    monthly[key].reco.push(r.reco)
    monthly[key].nee.push(r.nee)
  }
  return Object.values(monthly).map(m => ({
    date: m.date,
    gpp:  mean(m.gpp),
    reco: mean(m.reco),
    nee:  mean(m.nee),
  }))
}

const CHART_DEFAULTS = {
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 400 },
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: '#1e293b',
      titleColor: '#94a3b8',
      bodyColor: '#e2e8f0',
      borderColor: '#334155',
      borderWidth: 1,
    },
  },
  scales: {
    x: {
      ticks: { color: '#64748b', maxTicksLimit: 12, font: { size: 10 } },
      grid: { color: '#1e2d3d' },
    },
    y: {
      ticks: { color: '#64748b', font: { size: 10 } },
      grid: { color: '#1e2d3d' },
    },
  },
}

export default {
  name: 'ResultsPanel',

  data() {
    return {
      rows: [],
      aggMode: 'daily',
      chartType: 'line',
      charts: { gpp: null, reco: null, nee: null },
    }
  },

  computed: {
    hasData() { return this.rows.length > 0 },

    aggregated() { return aggregate(this.rows, this.aggMode) },

    stats() {
      if (!this.rows.length) return {}
      const gpp  = this.rows.map(r => r.gpp)
      const reco = this.rows.map(r => r.reco)
      const nee  = this.rows.map(r => r.nee)
      // Convert µmol m⁻²s⁻¹ to gC m⁻²yr⁻¹: × 12.01 × 3600 / 1e6 × 8760
      const toAnnual = v => +(v * 12.01 * 3600 / 1e6 * 8760).toFixed(1)
      return {
        meanGPP:   +mean(gpp).toFixed(2),
        meanRECO:  +mean(reco).toFixed(2),
        peakGPP:   +Math.max(...gpp).toFixed(2),
        annualNEE: toAnnual(mean(nee)),
      }
    },
  },

  watch: {
    aggMode()    { this.$nextTick(this.rebuildCharts) },
    chartType()  { this.$nextTick(this.rebuildCharts) },
    rows()       { this.$nextTick(this.rebuildCharts) },
  },

  methods: {
    // Called by App.vue with raw CSV rows
    loadResults(csvText) {
      const lines = csvText.trim().split('\n')
      if (lines.length < 2) return

      const headers = lines[0].split(',').map(h => h.trim().toLowerCase())
      const iDate = headers.findIndex(h => h.includes('date'))
      const iGPP  = headers.findIndex(h => h === 'gpp')
      const iRECO = headers.findIndex(h => h === 'reco' || h === 'r_eco' || h === 'ecosystem_respiration')
      const iNEE  = headers.findIndex(h => h === 'nee')

      if (iGPP < 0 || iRECO < 0 || iNEE < 0) {
        console.warn('Could not find GPP/RECO/NEE columns in CSV', headers)
        return
      }

      // Daily aggregation from hourly data
      const daily = {}
      for (const line of lines.slice(1)) {
        const cols = line.split(',')
        if (cols.length < 4) continue
        const dateStr = cols[iDate]?.slice(0, 10)
        if (!dateStr) continue
        const gpp  = parseFloat(cols[iGPP])
        const reco = parseFloat(cols[iRECO])
        const nee  = parseFloat(cols[iNEE])
        if (isNaN(gpp)) continue
        if (!daily[dateStr]) daily[dateStr] = { gpp: [], reco: [], nee: [] }
        daily[dateStr].gpp.push(gpp)
        daily[dateStr].reco.push(reco)
        daily[dateStr].nee.push(nee)
      }

      this.rows = Object.entries(daily)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, v]) => ({
          date,
          gpp:  mean(v.gpp),
          reco: mean(v.reco),
          nee:  mean(v.nee),
        }))
    },

    makeChart(canvas, label, color, data) {
      const labels = this.aggregated.map(r => r.date)
      const values = this.aggregated.map(r => r[data])
      const type = this.chartType
      const isLine = type === 'line'

      return new Chart(canvas, {
        type,
        data: {
          labels,
          datasets: [{
            label,
            data: values,
            borderColor: color,
            backgroundColor: isLine
              ? color.replace(')', ', 0.15)').replace('rgb', 'rgba')
              : color.replace(')', ', 0.7)').replace('rgb', 'rgba'),
            borderWidth: isLine ? 1.5 : 0,
            pointRadius: 0,
            fill: isLine,
            tension: 0.3,
          }],
        },
        options: {
          ...CHART_DEFAULTS,
          plugins: {
            ...CHART_DEFAULTS.plugins,
            title: {
              display: true,
              text: label,
              color: '#94a3b8',
              font: { size: 11, weight: '600' },
              padding: { bottom: 4 },
            },
          },
        },
      })
    },

    rebuildCharts() {
      if (!this.hasData) return
      const canvases = { gpp: this.$refs.gppCanvas, reco: this.$refs.recoCanvas, nee: this.$refs.neeCanvas }
      const specs = {
        gpp:  { label: 'GPP (µmol m⁻²s⁻¹)',   color: 'rgb(74, 222, 128)',  data: 'gpp' },
        reco: { label: 'RECO (µmol m⁻²s⁻¹)',  color: 'rgb(248, 113, 113)', data: 'reco' },
        nee:  { label: 'NEE (µmol m⁻²s⁻¹)',   color: 'rgb(96, 165, 250)',  data: 'nee' },
      }
      for (const [key, spec] of Object.entries(specs)) {
        if (this.charts[key]) this.charts[key].destroy()
        if (canvases[key]) this.charts[key] = this.makeChart(canvases[key], spec.label, spec.color, spec.data)
      }
    },
  },

  beforeUnmount() {
    Object.values(this.charts).forEach(c => c?.destroy())
  },
}
</script>

<style scoped>
.results-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: #475569;
  font-size: 13px;
}

.select-sm {
  padding: 3px 6px;
  font-size: 11px;
  background: #1e293b;
  border: 1px solid #334155;
  border-radius: 5px;
  color: #94a3b8;
  width: auto;
}

.charts-grid {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  overflow-y: auto;
}

.stats-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  flex-shrink: 0;
}

.stat-card {
  background: #1a2233;
  border: 1px solid #1e2d3d;
  border-radius: 8px;
  padding: 8px 10px;
  text-align: center;
}

.stat-label {
  font-size: 10px;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: .06em;
}

.stat-value {
  font-size: 16px;
  font-weight: 700;
  margin-top: 2px;
}

.stat-value span {
  font-size: 9px;
  font-weight: 400;
  color: #64748b;
}

.chart-wrap {
  background: #1a2233;
  border: 1px solid #1e2d3d;
  border-radius: 8px;
  padding: 10px;
  height: 160px;
  flex-shrink: 0;
}

.chart-wrap canvas {
  width: 100% !important;
  height: 100% !important;
}
</style>
