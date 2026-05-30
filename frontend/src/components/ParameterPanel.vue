<template>
  <div class="panel param-panel">
    <div class="flex items-center justify-between">
      <h2>Parameters</h2>
      <button class="btn-ghost text-xs" @click="resetAll">Reset</button>
    </div>

    <div class="tabs mt-2">
      <button v-for="tab in tabs" :key="tab.key"
              :class="['tab-btn', { active: activeTab === tab.key }]"
              @click="activeTab = tab.key">
        {{ tab.label }}
      </button>
    </div>

    <div class="param-list">
      <div v-for="p in visibleParams" :key="p.key" class="param-row">
        <div class="param-header">
          <span class="param-name">{{ p.label }}</span>
          <input type="number" class="param-value-input"
                 v-model.number="values[p.key]"
                 :step="p.step" :min="p.min" :max="p.max" />
        </div>
        <input type="range" :min="p.min" :max="p.max" :step="p.step"
               v-model.number="values[p.key]" />
        <div class="param-range-label">
          <span>{{ p.min }}</span>
          <span class="text-muted">{{ p.desc }}</span>
          <span>{{ p.max }}</span>
        </div>
      </div>
    </div>

    <div class="flex gap-2 mt-3">
      <button class="btn-primary w-full text-xs" @click="$emit('apply', values)">
        Apply &amp; Re-run
      </button>
    </div>
  </div>
</template>

<script>
const PARAMS = {
  photosynthesis: [
    { key: 'maximumQuantumYieldOver',  label: 'α overstory',   min: 0.005, max: 0.15,  step: 0.001, default: 0.06,  desc: 'Max quantum yield (overstory)' },
    { key: 'maximumQuantumYieldUnder', label: 'α understory',  min: 0.005, max: 0.10,  step: 0.001, default: 0.035, desc: 'Max quantum yield (understory)' },
    { key: 'halfSaturationTree',       label: 'k overstory',   min: 50,    max: 600,   step: 5,     default: 200,  desc: 'Half-sat PAR overstory (µmol)' },
    { key: 'halfSaturationUnder',      label: 'k understory',  min: 10,    max: 250,   step: 5,     default: 75,   desc: 'Half-sat PAR understory (µmol)' },
    { key: 'LightExtinctionCoefficient', label: 'k extinction',min: 0.3,   max: 0.9,   step: 0.01,  default: 0.5,  desc: 'Light extinction coefficient' },
    { key: 'vpdMin',                   label: 'VPD min',       min: 0,     max: 2,     step: 0.05,  default: 0.5,  desc: 'VPD lower threshold (kPa)' },
    { key: 'vpdMax',                   label: 'VPD max',       min: 1,     max: 8,     step: 0.1,   default: 4.0,  desc: 'VPD upper threshold (kPa)' },
    { key: 'minimumTemperature',       label: 'T min',         min: -10,   max: 5,     step: 0.5,   default: 2.0,  desc: 'Min photosynthesis temp (°C)' },
    { key: 'optimumTemperature',       label: 'T opt',         min: 15,    max: 35,    step: 0.5,   default: 22.0, desc: 'Optimal photosynthesis temp (°C)' },
    { key: 'maximumTemperature',       label: 'T max',         min: 30,    max: 45,    step: 0.5,   default: 38.0, desc: 'Max photosynthesis temp (°C)' },
  ],
  respiration: [
    { key: 'referenceRespirationSoil', label: 'R base soil',   min: 0.1,   max: 5.0,   step: 0.05,  default: 1.5,  desc: 'Soil respiration at Tref (µmol m⁻²s⁻¹)' },
    { key: 'Q10',                      label: 'Q10',           min: 1.2,   max: 3.5,   step: 0.05,  default: 2.0,  desc: 'Temperature sensitivity' },
    { key: 'Tref',                     label: 'T ref',         min: 5,     max: 20,    step: 0.5,   default: 10.0, desc: 'Reference temperature (°C)' },
    { key: 'carbonUseEfficiency',      label: 'CUE',           min: 0.2,   max: 0.8,   step: 0.01,  default: 0.5,  desc: 'Carbon use efficiency' },
    { key: 'fractionGppToFastPoolOver',  label: 'f GPP fast O',min: 0.1,   max: 0.9,   step: 0.01,  default: 0.4,  desc: 'GPP fraction to fast pool (over)' },
    { key: 'fractionGppToFastPoolUnder', label: 'f GPP fast U',min: 0.1,   max: 0.9,   step: 0.01,  default: 0.3,  desc: 'GPP fraction to fast pool (under)' },
    { key: 'fastPoolTurnoverRefOver',  label: 'k fast O',      min: 0.005, max: 0.5,   step: 0.005, default: 0.1,  desc: 'Fast pool turnover rate (overstory)' },
    { key: 'fastPoolTurnoverRefUnder', label: 'k fast U',      min: 0.005, max: 0.5,   step: 0.005, default: 0.08, desc: 'Fast pool turnover rate (understory)' },
    { key: 'lagGPP',                   label: 'GPP lag',       min: 0,     max: 24,    step: 1,     default: 6,    desc: 'GPP→respiration lag (hours)' },
  ],
  phenology: [
    { key: 'limitingPhotoperiod',      label: 'P limiting',    min: 8,     max: 14,    step: 0.1,   default: 10.5, desc: 'Limiting photoperiod (h)' },
    { key: 'notLimitingPhotoperiod',   label: 'P not-limit',   min: 10,    max: 18,    step: 0.1,   default: 14.0, desc: 'Non-limiting photoperiod (h)' },
    { key: 'limitingTemperature',      label: 'T limiting',    min: -5,    max: 10,    step: 0.5,   default: 2.0,  desc: 'Limiting temperature (°C)' },
    { key: 'notLimitingTemperature',   label: 'T not-limit',   min: 5,     max: 20,    step: 0.5,   default: 12.0, desc: 'Non-limiting temperature (°C)' },
    { key: 'chillingThreshold',        label: 'Chill thr',     min: 0,     max: 500,   step: 5,     default: 150,  desc: 'Chilling requirement (units)' },
    { key: 'thermalThreshold',         label: 'Heat thr',      min: 50,    max: 500,   step: 5,     default: 200,  desc: 'Thermal forcing threshold (°C·d)' },
  ],
}

export default {
  name: 'ParameterPanel',
  emits: ['apply'],

  data() {
    const values = {}
    Object.values(PARAMS).flat().forEach(p => { values[p.key] = p.default })
    return {
      values,
      activeTab: 'photosynthesis',
      tabs: [
        { key: 'photosynthesis', label: 'Photosynthesis' },
        { key: 'respiration',    label: 'Respiration' },
        { key: 'phenology',      label: 'Phenology' },
      ],
    }
  },

  computed: {
    visibleParams() {
      return PARAMS[this.activeTab] ?? []
    },
  },

  methods: {
    resetAll() {
      Object.values(PARAMS).flat().forEach(p => { this.values[p.key] = p.default })
    },

    // Called by parent to load parameters from API
    loadFromApi(apiParams) {
      if (!apiParams) return
      Object.keys(this.values).forEach(k => {
        if (apiParams[k] != null) this.values[k] = apiParams[k]
      })
    },
  },
}
</script>

<style scoped>
.param-panel {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.tabs {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.tab-btn {
  flex: 1;
  padding: 5px 4px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 6px;
  background: #1e293b;
  color: #64748b;
  border: none;
  cursor: pointer;
  transition: all .15s;
}

.tab-btn.active {
  background: #1e3a6e;
  color: #60a5fa;
}

.tab-btn:hover:not(.active) {
  background: #263348;
  color: #94a3b8;
}

.param-list {
  flex: 1;
  overflow-y: auto;
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-right: 2px;
}

.param-row {
  padding: 8px 10px;
  background: #1a2233;
  border-radius: 8px;
  border: 1px solid #1e2d3d;
}

.param-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.param-name {
  font-size: 12px;
  font-weight: 600;
  color: #cbd5e1;
  font-family: 'Consolas', monospace;
}

.param-value-input {
  width: 72px;
  padding: 2px 6px;
  font-size: 12px;
  text-align: right;
  background: #0f1117;
  border: 1px solid #334155;
  border-radius: 4px;
  color: #60a5fa;
}

.param-range-label {
  display: flex;
  justify-content: space-between;
  margin-top: 2px;
  font-size: 10px;
  color: #475569;
}
</style>
