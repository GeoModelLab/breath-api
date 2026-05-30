;(function() {
const { defineComponent } = Vue

const VARIANTS = [
  { id:'Baseline', label:'Baseline',  tip:'No phenology — constant canopy, no SWELL cycle.' },
  { id:'Pheno',    label:'Pheno',     tip:'SWELL phenology active — seasonal leaf dynamics.' },
  { id:'Circadian',label:'Circadian', tip:'SWELL + hourly circadian rhythm (diurnal scaling).' },
]

window.ControlPanel = defineComponent({
  name: 'ControlPanel',
  props: {
    point:          { type: Object, default: null },
    status:         { type: String, default: 'Idle' },
    startedAt:      { type: String, default: null },
    finishedAt:     { type: String, default: null },
    selectedPixels: { type: Array,  default: () => [] },
  },
  emits: ['run'],
  template: `
    <div class="panel">
      <div class="flex items-center justify-between">
        <h2>Simulation</h2>
        <span :class="badgeClass">{{ status }}</span>
      </div>
      <hr class="divider" />

      <!-- Model variant tabs -->
      <div class="mb-1">
        <label>Model variant</label>
        <div class="variant-tabs">
          <button v-for="v in VARIANTS" :key="v.id"
                  :class="['variant-btn', modelVariant===v.id && 'active']"
                  :title="v.tip"
                  :disabled="running"
                  @click="modelVariant=v.id">
            {{ v.label }}
          </button>
        </div>
        <div class="variant-tip">{{ currentVariantTip }}</div>
      </div>

      <hr class="divider" />

      <!-- Coordinates -->
      <div class="field-grid">
        <div>
          <label>Latitude</label>
          <input type="number" v-model.number="lat" step="0.0001" min="-90" max="90"
                 :disabled="running" placeholder="Click map…" />
        </div>
        <div>
          <label>Longitude</label>
          <input type="number" v-model.number="lon" step="0.0001" min="-180" max="180"
                 :disabled="running" placeholder="Click map…" />
        </div>
      </div>

      <!-- Year range -->
      <div class="field-grid mt-2">
        <div>
          <label>Start year</label>
          <input type="number" v-model.number="startYear" min="2000" :max="endYear" :disabled="running" />
        </div>
        <div>
          <label>End year</label>
          <input type="number" v-model.number="endYear" :min="startYear" :max="thisYear" :disabled="running" />
        </div>
      </div>

      <!-- Weather source -->
      <div class="mt-2">
        <label>Weather source</label>
        <select v-model="inputWeather" :disabled="running">
          <option value="hourly">NASA POWER — hourly (recommended)</option>
          <option value="daily">NASA POWER — daily (disaggregated)</option>
          <option value="era5land">ERA5-Land — daily (experimental)</option>
        </select>
      </div>

      <!-- Calibration -->
      <div class="flex items-center gap-2 mt-2">
        <input type="checkbox" id="calib" v-model="calibration" :disabled="running" />
        <label for="calib" style="display:inline;margin:0;cursor:pointer">
          Calibrate against MODIS EVI
        </label>
      </div>

      <hr class="divider" />

      <button class="btn-primary btn-full" :disabled="!canRun" @click="emit">
        {{ running ? '⏳  Running…' : selectedPixels.length > 1
             ? '▶  Run ' + selectedPixels.length + ' pixels'
             : '▶  Run BREATH' }}
      </button>

      <div class="timer" v-if="startedAt">
        <span v-if="running">Running {{ elapsed }}s…</span>
        <span v-else-if="finishedAt">Completed in {{ duration }}</span>
      </div>

      <div class="api-note mt-2">
        <span class="text-muted">API: </span>
        <code>POST /api/breath/run</code>
        &nbsp;·&nbsp;
        <a href="/swagger" target="_blank">Swagger ↗</a>
      </div>
    </div>
  `,

  data() {
    return {
      lat:          null,
      lon:          null,
      startYear:    2020,
      endYear:      2025,
      inputWeather: 'hourly',
      calibration:  false,
      modelVariant: 'Circadian',
      thisYear:     new Date().getFullYear(),
      elapsed:      0,
      _tick:        null,
      VARIANTS,
    }
  },

  mounted() {
    // Restore lat/lon when component is re-shown after "← New location"
    if (this.point) {
      this.lat = +this.point.lat.toFixed(5)
      this.lon = +this.point.lon.toFixed(5)
    }
  },

  computed: {
    running()   { return this.status === 'Running' },
    canRun()    { return (this.lat != null || this.selectedPixels.length > 0) && !this.running },
    badgeClass() {
      return { Idle:'badge badge-idle', Running:'badge badge-running',
               Completed:'badge badge-done', Failed:'badge badge-error' }[this.status] ?? 'badge badge-idle'
    },
    duration() {
      if (!this.startedAt || !this.finishedAt) return ''
      const s = Math.round((new Date(this.finishedAt) - new Date(this.startedAt)) / 1000)
      return s < 60 ? `${s}s` : `${Math.floor(s/60)}m ${s%60}s`
    },
    currentVariantTip() {
      return VARIANTS.find(v=>v.id===this.modelVariant)?.tip ?? ''
    },
  },

  watch: {
    point(p) { if (p) { this.lat = +p.lat.toFixed(5); this.lon = +p.lon.toFixed(5) } },
    status(v) {
      if (v === 'Running') { this.elapsed = 0; this._tick = setInterval(() => this.elapsed++, 1000) }
      else clearInterval(this._tick)
    },
  },

  beforeUnmount() { clearInterval(this._tick) },

  methods: {
    emit() {
      const pixel = this.lat != null ? `${this.lat}_${this.lon}` : null
      this.$emit('run', {
        settings: {
          pixelsRun:           pixel ? [pixel] : [],
          startYear:           this.startYear,
          endYear:             this.endYear,
          inputWeather:        this.inputWeather,
          calibration:         this.calibration,
          calibrationVariable: 'Phenology',
          modelVariant:        this.modelVariant,
          simplexes:           3,
          iterations:          200,
          parametersDataFile:  'photothermalRequirements.csv',
        }
      })
    },
  },
})
})()
