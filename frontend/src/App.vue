<template>
  <div class="app-shell">

    <!-- ── Header ────────────────────────────────────────── -->
    <header class="topbar">
      <div class="topbar-brand">
        <span class="brand-icon">🌲</span>
        <span class="brand-name">BREATH</span>
        <span class="brand-sub">Biophysical Rhythm of Ecosystem Activity and Health</span>
      </div>
      <div class="topbar-right">
        <a href="/swagger" target="_blank" class="nav-link">API docs</a>
        <a href="https://github.com" target="_blank" class="nav-link">GitHub</a>
      </div>
    </header>

    <!-- ── Main layout ──────────────────────────────────── -->
    <main class="main-layout">

      <!-- LEFT: map + log -->
      <section class="col-left">
        <div class="map-area">
          <MapPanel @point-selected="onPointSelected" />
        </div>
        <div class="log-area">
          <LogPanel ref="logPanel" />
        </div>
      </section>

      <!-- RIGHT: controls + params + results -->
      <section class="col-right">
        <ControlPanel
          ref="controlPanel"
          :selected-point="selectedPoint"
          :status="simStatus"
          :started-at="startedAt"
          :finished-at="finishedAt"
          @run="onRun"
        />
        <ParameterPanel ref="paramPanel" class="mt-3" @apply="onApplyParams" />
        <ResultsPanel ref="resultsPanel" class="mt-3" />
      </section>

    </main>
  </div>
</template>

<script>
import MapPanel      from './components/MapPanel.vue'
import ControlPanel  from './components/ControlPanel.vue'
import ParameterPanel from './components/ParameterPanel.vue'
import ResultsPanel  from './components/ResultsPanel.vue'
import LogPanel      from './components/LogPanel.vue'
import { runModel, openLogStream, getStatus } from './api.js'

export default {
  name: 'App',
  components: { MapPanel, ControlPanel, ParameterPanel, ResultsPanel, LogPanel },

  data() {
    return {
      selectedPoint: null,
      simStatus:     'Idle',
      startedAt:     null,
      finishedAt:    null,
      _sseSource:    null,
      _pollTimer:    null,
      lastPayload:   null,
    }
  },

  methods: {
    onPointSelected(point) {
      this.selectedPoint = point
    },

    async onRun(payload) {
      this.lastPayload = payload
      this.$refs.logPanel.clear()
      this.$refs.logPanel.append('Starting BREATH model...')
      this.simStatus = 'Running'
      this.startedAt = new Date().toISOString()
      this.finishedAt = null

      // Close any existing SSE connection
      this._sseSource?.close()
      clearInterval(this._pollTimer)

      try {
        await runModel(payload)
      } catch (e) {
        this.$refs.logPanel.append(`ERROR: ${e.message}`)
        this.simStatus = 'Failed'
        return
      }

      // Open SSE for live logs
      this._sseSource = openLogStream(
        msg => this.$refs.logPanel.append(msg),
        ()  => this.startStatusPolling(),
      )

      // Also poll status every 3s as fallback
      this.startStatusPolling()
    },

    startStatusPolling() {
      clearInterval(this._pollTimer)
      this._pollTimer = setInterval(async () => {
        try {
          const s = await getStatus()
          this.simStatus  = s.status ?? 'Idle'
          this.startedAt  = s.startedAt  ?? this.startedAt
          this.finishedAt = s.finishedAt ?? null

          if (s.status === 'Completed' || s.status === 'Failed') {
            clearInterval(this._pollTimer)
            this._sseSource?.close()
            if (s.status === 'Completed') this.loadResults()
          }
        } catch { /* API may not be up yet */ }
      }, 3000)
    },

    async loadResults() {
      try {
        // GET latest CSV via results API
        const r = await fetch('/api/results/latest/json')
        if (!r.ok) return
        const data = await r.json()

        // The results API returns { OutputUrl, Result, ... }
        // Try to load CSV directly from OutputUrl
        const outputUrl = data.OutputUrl ?? data.outputUrl
        if (outputUrl) {
          const csvResp = await fetch(outputUrl)
          if (csvResp.ok) {
            const csv = await csvResp.text()
            this.$refs.resultsPanel.loadResults(csv)
            return
          }
        }

        // Fallback: parse embedded result JSON
        if (data.Result) {
          try {
            const parsed = typeof data.Result === 'string'
              ? JSON.parse(data.Result) : data.Result
            if (Array.isArray(parsed)) {
              this.$refs.resultsPanel.loadResults(
                this.jsonToCsv(parsed)
              )
            }
          } catch { /* ignore */ }
        }
      } catch (e) {
        this.$refs.logPanel.append(`Could not load results: ${e.message}`)
      }
    },

    async onApplyParams(values) {
      if (!this.lastPayload) return
      // Merge parameter overrides into the payload and re-run
      const payload = {
        ...this.lastPayload,
        parameterOverrides: values,
      }
      await this.onRun(payload)
    },

    jsonToCsv(rows) {
      if (!rows.length) return ''
      const keys = Object.keys(rows[0])
      return [keys.join(','), ...rows.map(r => keys.map(k => r[k] ?? '').join(','))].join('\n')
    },
  },

  beforeUnmount() {
    this._sseSource?.close()
    clearInterval(this._pollTimer)
  },
}
</script>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

/* ── Topbar ──────────────────────────────────────────────── */
.topbar {
  flex-shrink: 0;
  height: 48px;
  background: #0a0d14;
  border-bottom: 1px solid #1e2d3d;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
}

.topbar-brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.brand-icon { font-size: 18px; }

.brand-name {
  font-size: 15px;
  font-weight: 700;
  color: #e2e8f0;
  letter-spacing: .05em;
}

.brand-sub {
  font-size: 11px;
  color: #475569;
  display: none;
}

@media (min-width: 900px) { .brand-sub { display: block; } }

.topbar-right { display: flex; gap: 14px; }

.nav-link {
  font-size: 12px;
  color: #64748b;
  text-decoration: none;
}

.nav-link:hover { color: #e2e8f0; }

/* ── Main layout ─────────────────────────────────────────── */
.main-layout {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 360px;
  gap: 12px;
  padding: 12px;
  min-height: 0;
  overflow: hidden;
}

/* ── Left column ─────────────────────────────────────────── */
.col-left {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}

.map-area {
  flex: 1;
  min-height: 300px;
}

.log-area {
  flex-shrink: 0;
  height: 140px;
  display: flex;
  flex-direction: column;
}

.log-area > * { height: 100%; }

/* ── Right column ────────────────────────────────────────── */
.col-right {
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  gap: 0;
  padding-right: 2px;
}

.mt-3 { margin-top: 10px; }

/* ── Responsive: stack on small screens ─────────────────── */
@media (max-width: 768px) {
  .main-layout {
    grid-template-columns: 1fr;
    overflow-y: auto;
  }
  .col-left { height: 55vh; }
  .col-right { overflow-y: visible; }
  .brand-sub { display: none; }
}
</style>
