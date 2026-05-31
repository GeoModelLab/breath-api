;(function() {
const { createApp } = Vue

createApp({
  components: { MapPanel, ControlPanel, ParameterPanel, ResultsPanel, LogPanel, HelpPanel },

  template: `
    <div :class="['app-shell', appState]">

      <!-- ── Topbar ──────────────────────────────────────────── -->
      <header class="topbar">
        <div class="brand">
          <span class="brand-icon">🌳</span>
          <span class="brand-name">BREATH</span>
          <span class="brand-sub">Biophysical Rhythm of Ecosystem Activity &amp; Health</span>
        </div>

        <div class="topbar-meta" v-if="appState === 'completed' || (point && status === 'Running')">
          <span class="location-pill">📍 {{ locationLabel }}</span>
          <span class="period-pill">{{ periodLabel }}</span>
        </div>

        <!-- Single-line log strip — only during simulation -->
        <div v-if="status === 'Running'" class="topbar-log-strip">
          <span class="tls-dot"></span>
          <span class="tls-text">{{ lastLog }}</span>
        </div>

        <div class="topbar-right">

          <!-- Back to results when user went to map but results still exist -->
          <button v-if="appState === 'selecting' && lastCsvText"
                  class="btn-outline btn-sm" @click="restoreResults">
            📊 Back to results
          </button>

          <!-- Stop simulation -->
          <button v-if="status === 'Running'"
                  class="btn-stop btn-sm" @click="onStop" title="Stop simulation">
            ⏹ Stop
          </button>

          <span v-if="status !== 'Running'" :class="['badge', badgeClass]">{{ statusLabel }}</span>

          <button v-if="appState === 'completed' && status !== 'Running'"
                  class="btn-outline btn-sm" @click="resetToMap">
            ← New location
          </button>

          <a class="nav-link" href="/swagger" target="_blank">API ↗</a>
          <button class="help-btn" @click="helpOpen=!helpOpen; localStorage.setItem('breath_help_seen','1')" title="Help &amp; Tutorial">?</button>
        </div>
      </header>

      <!-- ── Workspace ───────────────────────────────────────── -->
      <div class="workspace">

        <!-- Map column (full height, no log strip) -->
        <div class="map-col">
          <MapPanel ref="mapPanel" @point-selected="onPoint" @area-selected="onAreaSelected"
                    @history-point-selected="onHistoryPoint" />
        </div>

        <!-- Side column: controls (v-show keeps lat/lon state for re-run) -->
        <div class="side-col">
          <ControlPanel
            v-show="appState !== 'completed'"
            :point="point"
            :status="status"
            :started-at="startedAt"
            :finished-at="finishedAt"
            :selected-pixels="selectedPixels"
            @run="onRun"
          />
          <LogPanel ref="log" style="display:none" />
          <div v-if="appState === 'selecting' && !point && !selectedPixels.length" class="map-hint">
            <strong>Click on the map</strong> to select a forest pixel,<br>
            or use <strong>⬚ Area</strong> to draw a multi-pixel grid.<br>
            <small>The model simulates GPP, RECO and NEE at hourly resolution.</small>
          </div>
          <div v-if="selectedPixels.length" class="map-hint" style="padding:12px 16px">
            <strong>{{ selectedPixels.length }} pixels selected</strong><br>
            <small>Grid simulation — results shown as colored circles on the map.</small>
          </div>
        </div>

        <!-- Results column: only in completed state -->
        <div class="results-col">
          <ResultsPanel ref="results" />

          <!-- Collapsible parameters -->
          <div class="params-accordion">
            <button class="params-toggle" @click="paramsOpen = !paramsOpen">
              ⚙ Adjust Parameters &amp; Re-run
              <span>{{ paramsOpen ? '▲' : '▼' }}</span>
            </button>
            <div v-show="paramsOpen" class="params-body">
              <div class="rerun-settings">
                <label class="rerun-lbl">From
                  <input type="number" class="rerun-yr" v-model.number="rerunStartYear" min="2000" :max="rerunEndYear" />
                </label>
                <label class="rerun-lbl">To
                  <input type="number" class="rerun-yr" v-model.number="rerunEndYear" :min="rerunStartYear" :max="currentYear" />
                </label>
                <label class="rerun-lbl">Variant
                  <select class="rerun-sel" v-model="rerunVariant">
                    <option>Baseline</option><option>Pheno</option><option>Circadian</option>
                  </select>
                </label>
              </div>
              <ParameterPanel ref="params" @apply="onApply" />
            </div>
          </div>
        </div>

      </div>

      <!-- ── Help modal ──────────────────────────────────────── -->
      <HelpPanel v-if="helpOpen" @close="helpOpen=false; localStorage.setItem('breath_help_seen','1')" />

    </div>
  `,

  data() {
    return {
      point:          null,
      status:         'Idle',
      startedAt:      null,
      finishedAt:     null,
      appState:       'selecting',
      paramsOpen:     false,
      lastPayload:    null,
      rerunStartYear: new Date().getFullYear() - 3,
      rerunEndYear:   new Date().getFullYear(),
      rerunVariant:   'Circadian',
      currentYear:    new Date().getFullYear(),
      lastCsvText:    null,
      helpOpen:       !localStorage.getItem('breath_help_seen'),
      selectedPixels: [],
      _logLines:      [],     // shared log state for topbar strip
      _sse:           null,
      _poll:          null,
    }
  },

  computed: {
    lastLog() {
      const lines = this._logLines
      return lines.length ? lines[lines.length-1] : ''
    },
    badgeClass() {
      return { Idle:'badge-idle', Running:'badge-running',
               Completed:'badge-done', Failed:'badge-error' }[this.status] ?? 'badge-idle'
    },
    statusLabel() {
      return { Idle:'Ready', Running:'Running…',
               Completed:'Completed', Failed:'Error' }[this.status] ?? this.status
    },
    locationLabel() {
      if (this.selectedPixels.length > 1)
        return `${this.selectedPixels.length} pixels`
      if (!this.point) return ''
      return `${this.point.lat.toFixed(3)}°  ${this.point.lon.toFixed(3)}°`
    },
    periodLabel() {
      const s = this.lastPayload?.settings
      return s ? `${s.startYear} – ${s.endYear}` : ''
    },
  },

  methods: {
    onPoint(p) {
      this.point = p
      this.selectedPixels = []   // clear area selection when a point is picked
    },

    onAreaSelected(pixels) {
      this.selectedPixels = pixels
      this.point = null
    },

    onHistoryPoint({ lat, lon }) {
      const entry = this.$refs.mapPanel?.pointHistory?.find(h => h.lat === lat && h.lon === lon)
      const csv = entry?.csv ?? this.lastCsvText
      if (!csv) return
      this.$refs.results?.loadCsv(csv)
      this.$refs.results.locationName = this.$refs.mapPanel?.locationName || entry?.label || ''
      this.appState = 'completed'
      this.$nextTick(() => this.$refs.mapPanel?.resize())
    },

    resetToMap() {
      this.appState = 'selecting'
      setTimeout(() => this.$refs.mapPanel?.resize(), 380)
    },

    restoreResults() {
      if (!this.lastCsvText) return
      this.$refs.results.loadCsv(this.lastCsvText)
      this.appState = 'completed'
      this.$nextTick(() => this.$refs.mapPanel?.resize())
    },

    async onRun(payload) {
      const rerun = this.appState === 'completed'

      // If an area grid is selected, override pixelsRun
      if (this.selectedPixels.length > 0) {
        payload = {
          ...payload,
          settings: { ...payload.settings, pixelsRun: this.selectedPixels },
        }
      }

      this.lastPayload    = payload
      this.rerunStartYear = payload.settings?.startYear ?? this.rerunStartYear
      this.rerunEndYear   = payload.settings?.endYear   ?? this.rerunEndYear
      this.rerunVariant   = payload.settings?.modelVariant ?? this.rerunVariant
      this._logLines = ['▶ Starting BREATH model…']
      this.$refs.log?.clear()
      this.$refs.log?.append('▶ Starting BREATH model…')
      if (this.selectedPixels.length > 1)
        this.$refs.log?.append(`📍 Running ${this.selectedPixels.length} pixels in grid…`)
      this.status     = 'Running'
      this.startedAt  = new Date().toISOString()
      this.finishedAt = null
      this._sse?.close()
      clearInterval(this._poll)

      if (!rerun) {
        this.appState = 'running'
        this.$nextTick(() => this.$refs.mapPanel?.resize())
      }

      try {
        await breathRun(payload)
      } catch (e) {
        this.$refs.log?.append(`ERROR: ${e.message}`)
        this.status = 'Failed'
        if (!rerun) this.appState = 'selecting'
        return
      }

      this._sse = breathLogStream(
        msg => { this.$refs.log?.append(msg); this._logLines.push(msg) },
        ()  => this.startPoll(),
      )
      this.startPoll()
    },

    startPoll() {
      clearInterval(this._poll)
      this._poll = setInterval(async () => {
        try {
          const s = await breathStatus()
          this.status     = s.status ?? 'Idle'
          this.startedAt  = s.startedAt  ?? this.startedAt
          this.finishedAt = s.finishedAt ?? null

          if (s.status === 'Completed' || s.status === 'Failed') {
            clearInterval(this._poll)
            this._sse?.close()
            if (s.status === 'Completed') {
              // Set state FIRST so results-col is visible before charts try to render
              this.appState = 'completed'
              this.$nextTick(() => {
                this.$refs.mapPanel?.resize()
                this.loadResults()
              })
            } else if (this.appState !== 'completed') {
              this.appState = 'selecting'
            }
          }
        } catch { /* API starting */ }
      }, 3000)
    },

    async loadResults() {
      try {
        const r = await fetch(`/api/results/latest?t=${Date.now()}`)
        if (r.ok) {
          const csv = await r.text()
          if (csv && csv.trim().length > 50) {
            this.lastCsvText = csv
            this.$refs.results.loadCsv(csv)
            this.$refs.results.locationName = this.$refs.mapPanel?.locationName || ''

            const pixelStats = this._getPixelStats(csv)

            if (this.selectedPixels.length > 1) {
              // Grid simulation: show pixel rectangles on map
              this.$refs.mapPanel?.showPixelStats(pixelStats)
            } else if (this.point) {
              // Single point: attach KPIs to the map marker
              const singleStats = pixelStats[0] ?? null
              const klimaStats  = this.$refs.results?.climateStats
              const annStats    = this.$refs.results?.stats
              const combined    = singleStats
                ? { ...singleStats,
                    cue:    annStats?.cue    ?? '—',
                    koppen: klimaStats?.koppen ?? null }
                : null
              const label = this.$refs.mapPanel?.coord || null
              this.$refs.mapPanel?.attachPointStats(
                this.point.lat, this.point.lon, combined, label, csv
              )
            }
            return
          }
        }
        this.$refs.log?.append('⚠️ No result CSV found.')
      } catch (e) {
        this.$refs.log?.append(`Could not load results: ${e.message}`)
      }
    },

    // Parse CSV → per-pixel annual stats for map display
    _getPixelStats(csv) {
      try {
        const lines = csv.trim().split('\n')
        if (lines.length < 2) return []
        const hdr   = lines[0].split(',')
        const pxI   = hdr.indexOf('pixel')
        const gppI  = hdr.indexOf('GPP')
        const neeI  = hdr.indexOf('NEE')
        const recoI = hdr.indexOf('RECO')
        if (pxI < 0 || gppI < 0) return []

        const acc = {}
        for (const line of lines.slice(1)) {
          const c  = line.split(',')
          const px = c[pxI]?.trim()
          if (!px) continue
          const g  = parseFloat(c[gppI])
          const n  = neeI  >= 0 ? parseFloat(c[neeI])  : NaN
          const rc = recoI >= 0 ? parseFloat(c[recoI]) : NaN
          if (!acc[px]) acc[px] = { g: 0, n: 0, rc: 0, cnt: 0 }
          if (!isNaN(g))  { acc[px].g += g;  acc[px].cnt++ }
          if (!isNaN(n))    acc[px].n  += n
          if (!isNaN(rc))   acc[px].rc += rc
        }

        return Object.entries(acc).map(([px, d]) => {
          const parts = px.split('_')
          const lat = parseFloat(parts[0])
          const lon = parseFloat(parts[1])
          if (isNaN(lat) || isNaN(lon)) return null
          const toAnn = v => Math.round(v / d.cnt * 86400 * 365 * 12.01 / 1e6)
          return {
            lat, lon,
            annGPP:  toAnn(d.g),
            annNEE:  toAnn(d.n),
            annRECO: toAnn(d.rc),
          }
        }).filter(Boolean)
      } catch { return [] }
    },

    async onStop() {
      try {
        await fetch('/api/breath/stop', { method: 'POST' })
        this.$refs.log?.append('⏹ Simulation stopped.')
        this.status = 'Failed'
        clearInterval(this._poll)
        this._sse?.close()
        if (this.appState !== 'completed') this.appState = 'selecting'
      } catch(e) {
        this.$refs.log?.append(`Stop error: ${e.message}`)
      }
    },

    async onApply(paramValues) {
      if (!this.lastPayload) return
      await this.onRun({
        ...this.lastPayload,
        settings: {
          ...this.lastPayload.settings,
          startYear:    this.rerunStartYear,
          endYear:      this.rerunEndYear,
          modelVariant: this.rerunVariant,
        },
        parameterOverrides: paramValues,
      })
    },
  },

  beforeUnmount() {
    this._sse?.close()
    clearInterval(this._poll)
  },
}).mount('#app')
})()
