<template>
  <div class="panel control-panel">
    <div class="flex items-center justify-between">
      <h2>Simulation</h2>
      <span :class="statusBadgeClass">{{ status }}</span>
    </div>

    <hr class="divider" />

    <!-- Location -->
    <div class="field-row">
      <div class="field">
        <label>Latitude</label>
        <input type="number" v-model.number="lat" step="0.0001" min="-90" max="90"
               :disabled="running" placeholder="Click map" />
      </div>
      <div class="field">
        <label>Longitude</label>
        <input type="number" v-model.number="lon" step="0.0001" min="-180" max="180"
               :disabled="running" placeholder="Click map" />
      </div>
    </div>

    <!-- Year range -->
    <div class="field-row mt-2">
      <div class="field">
        <label>Start year</label>
        <input type="number" v-model.number="startYear" min="2000" :max="endYear"
               :disabled="running" />
      </div>
      <div class="field">
        <label>End year</label>
        <input type="number" v-model.number="endYear" :min="startYear" :max="currentYear"
               :disabled="running" />
      </div>
    </div>

    <!-- Weather source -->
    <div class="mt-2">
      <label>Weather source</label>
      <select v-model="inputWeather" :disabled="running">
        <option value="hourly">NASA POWER — hourly (recommended)</option>
        <option value="daily">NASA POWER — daily (disaggregated)</option>
      </select>
    </div>

    <!-- Calibration -->
    <div class="mt-2 flex items-center gap-2">
      <input type="checkbox" id="calib" v-model="calibration" :disabled="running" />
      <label for="calib" style="display:inline;margin:0">
        Calibrate parameters against MODIS EVI
      </label>
    </div>

    <hr class="divider" />

    <!-- Action buttons -->
    <div class="flex gap-2">
      <button class="btn-primary w-full" :disabled="!canRun" @click="$emit('run', buildPayload())">
        {{ running ? 'Running…' : 'Run BREATH' }}
      </button>
    </div>

    <!-- Progress / timing -->
    <div v-if="startedAt" class="text-xs text-muted mt-2 text-center">
      <span v-if="running">Running for {{ elapsed }}s</span>
      <span v-else-if="finishedAt">Finished in {{ durationStr }}</span>
    </div>

    <!-- API hint -->
    <div class="api-hint mt-3">
      <span class="text-muted text-xs">External API: </span>
      <code class="text-xs">POST /api/breath/run</code>
      &nbsp;·&nbsp;
      <a href="/swagger" target="_blank" class="text-xs text-blue">Swagger docs</a>
    </div>
  </div>
</template>

<script>
export default {
  name: 'ControlPanel',
  props: {
    selectedPoint: { type: Object, default: null },   // { lat, lon }
    status:        { type: String,  default: 'Idle' },
    startedAt:     { type: String,  default: null },
    finishedAt:    { type: String,  default: null },
  },
  emits: ['run'],

  data() {
    return {
      lat:          null,
      lon:          null,
      startYear:    2018,
      endYear:      2022,
      inputWeather: 'hourly',
      calibration:  false,
      currentYear:  new Date().getFullYear(),
      elapsed:      0,
      _timer:       null,
    }
  },

  computed: {
    running()   { return this.status === 'Running' },
    canRun()    { return this.lat != null && this.lon != null && !this.running },
    statusBadgeClass() {
      const m = { Idle: 'badge badge-idle', Running: 'badge badge-running',
                  Completed: 'badge badge-done', Failed: 'badge badge-error' }
      return m[this.status] ?? 'badge badge-idle'
    },
    durationStr() {
      if (!this.startedAt || !this.finishedAt) return ''
      const s = Math.round((new Date(this.finishedAt) - new Date(this.startedAt)) / 1000)
      return s < 60 ? `${s}s` : `${Math.floor(s/60)}m ${s%60}s`
    },
  },

  watch: {
    selectedPoint(p) {
      if (p) { this.lat = p.lat; this.lon = p.lon }
    },
    status(val) {
      if (val === 'Running') {
        this.elapsed = 0
        this._timer = setInterval(() => this.elapsed++, 1000)
      } else {
        clearInterval(this._timer)
      }
    },
  },

  beforeUnmount() { clearInterval(this._timer) },

  methods: {
    buildPayload() {
      const pixelId = `${this.lat}_${this.lon}`
      return {
        settings: {
          pixelsRun:           [pixelId],
          startYear:           this.startYear,
          endYear:             this.endYear,
          inputWeather:        this.inputWeather,
          calibration:         this.calibration,
          calibrationVariable: 'EVI',
          simplexes:           3,
          iterations:          200,
          parametersDataFile:  'photothermalRequirements.csv',
        }
      }
    },
  },
}
</script>

<style scoped>
.control-panel { display: flex; flex-direction: column; }

.field-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.field label { margin-bottom: 4px; }

.api-hint {
  border-top: 1px solid #1e2d3d;
  padding-top: 10px;
  text-align: center;
}

code {
  background: #1e293b;
  padding: 1px 5px;
  border-radius: 4px;
  font-family: 'Consolas', monospace;
  color: #94a3b8;
}

a { color: #3b82f6; text-decoration: none; }
a:hover { text-decoration: underline; }
</style>
