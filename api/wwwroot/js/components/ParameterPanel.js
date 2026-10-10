;(function() {
const { defineComponent } = Vue

// Keys MUST match the nameParam format used by the optimizer: "className_propertyName"
const PARAM_DEFS = {
  photosynthesis: [
    { key:'parPhotosynthesis_maximumQuantumYieldOver', label:'α overstory', min:0.06, max:0.24, step:0.001, def:0.123, desc:'Max quantum yield — overstory (µmol CO₂ µmol⁻¹ photons)' },
    { key:'parPhotosynthesis_maximumQuantumYieldUnder', label:'α understory', min:0.02, max:0.23, step:0.001, def:0.111, desc:'Max quantum yield — understory' },
    { key:'parPhotosynthesis_halfSaturationTree', label:'k½ PAR overstory', min:300, max:680, step:0.1, def:511.1, desc:'Half-saturation PAR — overstory (µmol m⁻² s⁻¹)' },
    { key:'parPhotosynthesis_halfSaturationUnder', label:'k½ PAR understory', min:50, max:350, step:0.1, def:172, desc:'Half-saturation PAR — understory (µmol m⁻² s⁻¹)' },
    { key:'parPhotosynthesis_minimumTemperature', label:'T min phot (°C)', min:-8, max:-2, step:0.01, def:-6.67, desc:'Minimum temperature for photosynthesis' },
    { key:'parPhotosynthesis_optimumTemperature', label:'T opt phot (°C)', min:15, max:30, step:0.01, def:25.96, desc:'Optimum temperature for photosynthesis' },
    { key:'parPhotosynthesis_maximumTemperature', label:'T max phot (°C)', min:40, max:50, step:0.1, def:45.3, desc:'Maximum temperature for photosynthesis' },
    { key:'parPhotosynthesis_vpdMin', label:'VPD min (kPa)', min:0.5, max:2.5, step:0.01, def:1.64, desc:'VPD below which no stress is applied (kPa)' },
    { key:'parPhotosynthesis_vpdMax', label:'VPD max (kPa)', min:4, max:6.5, step:0.01, def:5.38, desc:'VPD above which full stress is applied (kPa)' },
    { key:'parPhotosynthesis_vpdSensitivity', label:'VPD sensitivity', min:3, max:7, step:0.01, def:4.56, desc:'VPD response steepness' },
    { key:'parPhotosynthesis_waterStressDays', label:'Water stress days', min:30, max:60, step:0.1, def:59, desc:'Rolling memory window for water stress (days)' },
    { key:'parPhotosynthesis_waterStressThreshold', label:'Water stress thr.', min:0.2, max:0.9, step:0.001, def:0.328, desc:'Water availability below which stress begins (0–1)' },
    { key:'parPhotosynthesis_waterStressSensitivity', label:'Water stress sens.', min:0.3, max:0.9, step:0.001, def:0.548, desc:'Water stress sensitivity slope' },
    { key:'parPhotosynthesis_declineSteepness', label:'Decline steepness', min:1, max:4, step:0.01, def:2.43, desc:'Power exponent for autumn phenology decline (1=linear, >1=convex)' },
    { key:'parPhotosynthesis_declineStartSteep', label:'Decline start (0–1)', min:0.1, max:0.6, step:0.001, def:0.4, desc:'Fraction of senescence progress before steep decline begins' },
    { key:'parPhotosynthesis_circadianActivationPhoto', label:'β photo (circadian)', min:0, max:0.25, step:0.001, def:0.074, desc:'Amplitude of circadian modulation of GPP (pheno_circ only)' },
    { key:'parPhotosynthesis_circadianDayShiftHours', label:'Δt circadian (h)', min:-2, max:2, step:0.01, def:-1, desc:'Phase shift of the circadian cycle (hours)' },
  ],
  respiration: [
    { key:'parRespiration_referenceRespiration', label:'R base (µmol m⁻²s⁻¹)', min:1, max:4.5, step:0.001, def:1.898, desc:'Basal heterotrophic respiration at Tref (µmol m⁻² s⁻¹)' },
    { key:'parRespiration_activationEnergyParameter', label:'E₀ activation (K)', min:70, max:350, step:0.1, def:106.7, desc:'Lloyd–Taylor activation energy parameter (K)' },
    { key:'parRespiration_Tref', label:'T reference (°C)', min:10, max:20, step:0.1, def:15, desc:'Reference temperature for Lloyd–Taylor respiration' },
    { key:'parRespiration_carbonUseEfficiencyOver', label:'CUE overstory', min:0.4, max:0.85, step:0.001, def:0.586, desc:'Carbon use efficiency — overstory (autotrophic R = 1−CUE)' },
    { key:'parRespiration_carbonUseEfficiencyUnder', label:'CUE understory', min:0.4, max:0.8, step:0.001, def:0.477, desc:'Carbon use efficiency — understory' },
    { key:'parRespiration_fractionGppToFastPool', label:'f fast pool', min:0.15, max:0.5, step:0.001, def:0.21, desc:'Fraction of GPP allocated to fast carbon pool' },
    { key:'parRespiration_fastPoolTurnover', label:'k fast pool (d⁻¹)', min:0.01, max:0.22, step:0.001, def:0.1, desc:'Fast carbon pool turnover rate (d⁻¹)' },
    { key:'parRespiration_slowPoolTurnover', label:'k slow pool (d⁻¹)', min:0.005, max:0.09, step:0.0001, def:0.06, desc:'Slow carbon pool turnover rate (d⁻¹)' },
    { key:'parRespiration_respirationYoungBoost', label:'Young R boost', min:1.5, max:3, step:0.01, def:2.12, desc:'Respiration boost factor during early leaf growth' },
    { key:'parRespiration_respirationYoungPow', label:'Young R shape', min:1, max:5, step:0.01, def:3.16, desc:'Power shape of young-tissue respiration boost' },
    { key:'parRespiration_respirationSenescenceBoost', label:'Senescence R boost', min:1, max:2, step:0.01, def:1.43, desc:'Respiration boost factor during senescence' },
    { key:'parRespiration_respirationSenescencePow', label:'Senescence R shape', min:3, max:5, step:0.01, def:3.58, desc:'Power shape of senescence respiration boost' },
    { key:'parRespiration_circadianActivationReco', label:'β resp (circadian)', min:0, max:0.2, step:0.001, def:0.066, desc:'Amplitude of circadian modulation of RECO (pheno_circ only)' },
  ],
  phenology: [
    { key:'parEndodormancy_chillingThreshold', label:'Chilling req. (CU)', min:68, max:106, step:0.1, def:91.7, desc:'Chilling units required to complete endodormancy' },
    { key:'parEcodormancy_photoThermalThreshold', label:'Ecodorm threshold', min:5, max:20, step:0.01, def:12.09, desc:'Photothermal units to complete ecodormancy' },
    { key:'parGrowth_optimumTemperature', label:'T opt growth (°C)', min:15, max:23, step:0.01, def:16, desc:'Optimum temperature for spring forcing accumulation' },
    { key:'parGrowth_thermalThreshold', label:'Growth threshold', min:25, max:45, step:0.01, def:38.93, desc:'Thermal forcing units required for leaf-out' },
    { key:'parGreendown_thermalThreshold', label:'Greendown threshold', min:55, max:101, step:0.01, def:80.78, desc:'Thermal units to complete the greendown phase' },
    { key:'parSenescence_photoThermalThreshold', label:'Senescence threshold', min:64, max:79, step:0.01, def:72.42, desc:'Photothermal units to complete senescence' },
    { key:'parVegetationIndex_nVIGrowth', label:'nVI growth', min:1.5, max:4, step:0.001, def:3.133, desc:'VI dynamics shape — spring growth phase' },
    { key:'parVegetationIndex_nVIEndodormancy', label:'nVI endodorm', min:0.2, max:0.8, step:0.001, def:0.524, desc:'VI dynamics shape — endodormancy' },
    { key:'parVegetationIndex_nVISenescence', label:'nVI senescence', min:0.25, max:0.7, step:0.001, def:0.539, desc:'VI dynamics shape — senescence' },
    { key:'parVegetationIndex_nVIGreendown', label:'nVI greendown', min:0.05, max:0.2, step:0.001, def:0.142, desc:'VI dynamics shape — greendown' },
    { key:'parVegetationIndex_nVIEcodormancy', label:'nVI ecodorm', min:0.25, max:1.2, step:0.001, def:0.544, desc:'VI dynamics shape — ecodormancy' },
    { key:'parVegetationIndex_minimumVI', label:'VI minimum (EVI)', min:0.05, max:0.25, step:0.001, def:0.136, desc:'Minimum vegetation index (winter minimum EVI)' },
    { key:'parVegetationIndex_maximumVI', label:'VI maximum (EVI)', min:0.55, max:0.75, step:0.001, def:0.67, desc:'Maximum vegetation index (peak summer EVI)' },
  ],
}

window.ParameterPanel = defineComponent({
  name: 'ParameterPanel',
  emits: ['apply'],
  template: `
    <div class="panel">
      <div class="flex items-center justify-between">
        <h2>Parameters</h2>
        <button class="btn-ghost btn-sm" @click="resetAll">Reset</button>
      </div>

      <div class="param-tabs">
        <button v-for="t in tabs" :key="t.key"
                :class="['tab-btn', activeTab===t.key?'active':'']"
                @click="activeTab=t.key">{{ t.label }}</button>
      </div>

      <div class="param-list">
        <div v-for="p in visible" :key="p.key" class="param-row2" :title="p.desc">
          <span class="p2-name">{{ p.label }}</span>
          <span class="p2-bound">{{ p.min }}</span>
          <input type="range" :min="p.min" :max="p.max" :step="p.step"
                 v-model.number="values[p.key]" />
          <span class="p2-bound">{{ p.max }}</span>
          <input class="p2-num p2-num-nospinner" type="number"
                 :min="p.min" :max="p.max" :step="p.step"
                 v-model.number="values[p.key]" />
        </div>
      </div>

      <button class="btn-primary btn-full mt-2" @click="$emit('apply', {...values})">
        Apply &amp; Re-run
      </button>
    </div>
  `,

  data() {
    const values = {}
    Object.values(PARAM_DEFS).flat().forEach(p => { values[p.key] = p.def })
    return {
      values,
      activeTab: 'photosynthesis',
      tabs: [
        { key:'photosynthesis', label:'Photosyn.' },
        { key:'respiration',    label:'Respiration' },
        { key:'phenology',      label:'Phenology' },
      ],
    }
  },

  computed: {
    visible() { return PARAM_DEFS[this.activeTab] ?? [] },
  },

  methods: {
    resetAll() {
      Object.values(PARAM_DEFS).flat().forEach(p => { this.values[p.key] = p.def })
    },
    loadFromApi(apiParams) {
      if (!apiParams) return
      Object.keys(this.values).forEach(k => {
        if (apiParams[k] != null) this.values[k] = apiParams[k]
      })
    },
  },
})
})()
