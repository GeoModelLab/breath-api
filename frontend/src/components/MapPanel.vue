<template>
  <div class="map-wrapper">
    <div ref="mapEl" class="map-container"></div>

    <!-- toolbar -->
    <div class="map-toolbar">
      <label class="toggle">
        <input type="checkbox" v-model="showForest" @change="toggleForestLayer" />
        <span class="toggle-track"></span>
        <span class="toggle-label">Forest mask</span>
      </label>
      <div v-if="selected" class="coord-badge">
        {{ selected.lat.toFixed(4) }}°N, {{ selected.lon.toFixed(4) }}°E
      </div>
    </div>

    <!-- forest warning -->
    <div v-if="forestWarning" class="forest-warning">
      ⚠️ This point may not be in dense forest cover. Proceed with care.
    </div>
  </div>
</template>

<script>
import L from 'leaflet'

const OSM_TILE = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
const OSM_ATTR = '&copy; <a href="https://carto.com/">CartoDB</a>'

// Hansen Global Forest Change — tree cover 2000 (public tiles)
const FOREST_TILE = 'https://storage.googleapis.com/earthenginepartners-hansen/tiles/gfc_v1.7/tree_alpha/{z}/{x}/{y}.png'
const FOREST_ATTR = '&copy; <a href="https://www.science.org/doi/10.1126/science.1244693">Hansen/UMD/Google/USGS/NASA</a>'

// Marker icon (Leaflet default broken in Vite builds without asset copy)
const markerIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
})

export default {
  name: 'MapPanel',
  emits: ['point-selected'],

  data() {
    return {
      map: null,
      marker: null,
      forestLayer: null,
      showForest: true,
      selected: null,
      forestWarning: false,
    }
  },

  mounted() {
    this.map = L.map(this.$refs.mapEl, {
      center: [47, 10],
      zoom: 4,
      zoomControl: true,
    })

    L.tileLayer(OSM_TILE, {
      attribution: OSM_ATTR,
      maxZoom: 19,
    }).addTo(this.map)

    this.forestLayer = L.tileLayer(FOREST_TILE, {
      attribution: FOREST_ATTR,
      opacity: 0.65,
      maxZoom: 12,
    })

    if (this.showForest) this.forestLayer.addTo(this.map)

    this.map.on('click', this.onMapClick)
  },

  beforeUnmount() {
    this.map?.remove()
  },

  methods: {
    toggleForestLayer() {
      if (this.showForest) this.forestLayer.addTo(this.map)
      else this.map.removeLayer(this.forestLayer)
    },

    async onMapClick(e) {
      const { lat, lng: lon } = e.latlng

      if (this.marker) this.map.removeLayer(this.marker)
      this.marker = L.marker([lat, lon], { icon: markerIcon })
        .addTo(this.map)
        .bindPopup(`<b>${lat.toFixed(4)}°N, ${lon.toFixed(4)}°E</b>`)
        .openPopup()

      this.selected = { lat, lon }
      this.forestWarning = false

      this.$emit('point-selected', { lat, lon })

      // Async forest check via ESA WorldCover WMS GetFeatureInfo
      this.checkForestCover(lat, lon)
    },

    async checkForestCover(lat, lon) {
      try {
        // ESA WorldCover 2021 WMS (free, no auth)
        const wmsBase = 'https://services.terrascope.be/wms/v2'
        const bbox = `${lon - 0.001},${lat - 0.001},${lon + 0.001},${lat + 0.001}`
        const url = `${wmsBase}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo` +
          `&LAYERS=WORLDCOVER_2021_MAP&QUERY_LAYERS=WORLDCOVER_2021_MAP` +
          `&BBOX=${bbox}&WIDTH=3&HEIGHT=3&X=1&Y=1` +
          `&SRS=EPSG:4326&INFO_FORMAT=application/json`

        const r = await fetch(url, { signal: AbortSignal.timeout(5000) })
        if (!r.ok) return

        const data = await r.json()
        // Class 10 = Tree cover in ESA WorldCover
        const features = data.features ?? []
        const isForest = features.some(f => f.properties?.Map_Display_Class === 10 ||
                                            f.properties?.class === 10 ||
                                            String(f.properties?.DN ?? '') === '10')
        this.forestWarning = !isForest
      } catch {
        // Silently ignore — WMS may be unavailable
      }
    },
  },
}
</script>

<style scoped>
.map-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
}

.map-container {
  width: 100%;
  height: 100%;
  border-radius: 10px;
  overflow: hidden;
}

.map-toolbar {
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
  background: rgba(15, 17, 23, 0.88);
  border: 1px solid #1e2d3d;
  border-radius: 8px;
  padding: 6px 12px;
  display: flex;
  align-items: center;
  gap: 16px;
  backdrop-filter: blur(6px);
}

.toggle {
  display: flex;
  align-items: center;
  gap: 7px;
  cursor: pointer;
  user-select: none;
}

.toggle input { display: none; }

.toggle-track {
  width: 32px;
  height: 18px;
  background: #334155;
  border-radius: 999px;
  position: relative;
  transition: background .2s;
}

.toggle input:checked + .toggle-track {
  background: #3b82f6;
}

.toggle-track::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  background: #fff;
  border-radius: 50%;
  transition: left .2s;
}

.toggle input:checked + .toggle-track::after {
  left: 16px;
}

.toggle-label { font-size: 12px; color: #94a3b8; }

.coord-badge {
  font-size: 12px;
  font-family: 'Consolas', monospace;
  color: #60a5fa;
  background: #1e3a6e;
  padding: 2px 8px;
  border-radius: 6px;
}

.forest-warning {
  position: absolute;
  bottom: 10px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
  background: rgba(120, 80, 0, 0.9);
  border: 1px solid #92400e;
  color: #fcd34d;
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 12px;
  backdrop-filter: blur(4px);
}
</style>
