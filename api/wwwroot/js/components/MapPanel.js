;(function() {
const { defineComponent } = Vue

const DARK_TILE    = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
const DARK_ATTR    = '&copy; <a href="https://carto.com/">CartoDB</a> &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
const FOREST_WMS   = 'https://services.terrascope.be/wms/v2'
const FOREST_ATTR  = '&copy; <a href="https://esa-worldcover.org/">ESA WorldCover 2021</a>'

const MARKER_ICON = L.icon({
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize:    [22, 36], iconAnchor:  [11, 36],
  popupAnchor: [1, -30], shadowSize:  [36, 36],
})

const LAND_CLASSES = [
  { cls: 10, color: '#006400', rgb: [0,100,0],     label: 'Tree cover (10)',     target: true },
  { cls: 20, color: '#ffbb22', rgb: [255,187,34],  label: 'Shrubland (20)',      target: false },
  { cls: 30, color: '#ffff4c', rgb: [255,255,76],  label: 'Grassland (30)',      target: false },
  { cls: 40, color: '#f096ff', rgb: [240,150,255], label: 'Cropland (40)',       target: false },
  { cls: 50, color: '#fa0000', rgb: [250,0,0],     label: 'Built-up (50)',       target: false },
  { cls: 60, color: '#b4b4b4', rgb: [180,180,180], label: 'Bare / sparse (60)', target: false },
  { cls: 80, color: '#0064c8', rgb: [0,100,200],   label: 'Water (80)',          target: false },
]

// Canvas GridLayer: fetches WMS tiles and dims pixels that don't match targetRgb.
// Gracefully degrades if CORS blocks pixel access.
function makeSpotlightLayer(targetRgb) {
  const [tr, tg, tb] = targetRgb
  const THRESH = 50

  function tileToMercator(x, y, z) {
    const R = 6378137, n = Math.pow(2, z), full = 2 * Math.PI * R
    const xMin = x     / n * full - Math.PI * R
    const xMax = (x+1) / n * full - Math.PI * R
    const yMax = Math.PI * R - y     / n * full
    const yMin = Math.PI * R - (y+1) / n * full
    return `${xMin},${yMin},${xMax},${yMax}`
  }

  return L.GridLayer.extend({
    createTile(coords, done) {
      const size  = this.getTileSize()
      const tile  = L.DomUtil.create('canvas')
      tile.width  = size.x
      tile.height = size.y
      const bbox = tileToMercator(coords.x, coords.y, coords.z)
      const url  = `${FOREST_WMS}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap`
                 + `&LAYERS=WORLDCOVER_2021_MAP&FORMAT=image/png&TRANSPARENT=true`
                 + `&WIDTH=${size.x}&HEIGHT=${size.y}&SRS=EPSG:3857&BBOX=${bbox}`
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        const ctx = tile.getContext('2d')
        ctx.drawImage(img, 0, 0, size.x, size.y)
        try {
          const id = ctx.getImageData(0, 0, size.x, size.y)
          const d  = id.data
          for (let i = 0; i < d.length; i += 4) {
            if (d[i+3] < 10) continue
            if (Math.abs(d[i]-tr) + Math.abs(d[i+1]-tg) + Math.abs(d[i+2]-tb) > THRESH)
              d[i+3] = 18
          }
          ctx.putImageData(id, 0, 0)
        } catch { /* CORS blocked — show tile unfiltered */ }
        done(null, tile)
      }
      img.onerror = () => done(null, tile)
      img.src = url
      return tile
    }
  })
}

window.MapPanel = defineComponent({
  name: 'MapPanel',
  emits: ['point-selected', 'area-selected'],
  template: `
    <div class="map-area">
      <div id="leaflet-map"></div>

      <div class="map-toolbar">
        <div class="toggle-wrap" @click="toggleForest">
          <div :class="['toggle-track', forestOn ? 'on' : '']"></div>
          <span class="toggle-lbl">Forest mask</span>
        </div>

        <button :class="['legend-btn', drawMode && 'draw-active']"
                @click="toggleDrawMode"
                :title="drawMode ? 'Cancel (ESC)' : 'Drag to draw an area grid'">
          {{ drawMode ? '⬚ Drawing…' : '⬚ Area' }}
        </button>

        <span v-if="gridPixels.length && !drawMode" class="grid-pill">
          {{ gridPixels.length }} pixels
        </span>

        <div v-if="coord" class="coord-pill">{{ coord }}</div>
        <button class="legend-btn" @click="legendOpen=!legendOpen" title="Map legend">▤</button>
      </div>

      <!-- ── Legend ── -->
      <div v-if="legendOpen" class="map-legend">
        <div class="legend-title">ESA WorldCover 2021</div>
        <div v-for="lc in LAND_CLASSES" :key="lc.cls"
             :class="['legend-row', lc.target && 'legend-target', spotlightClass===lc.cls && 'legend-active']"
             @click="toggleSpotlight(lc.cls)"
             :title="spotlightClass===lc.cls ? 'Click to remove highlight' : 'Click to highlight on map'">
          <span class="legend-swatch" :style="'background:'+lc.color"></span>
          {{ lc.label }}
          <span v-if="spotlightClass===lc.cls" class="legend-spot-icon">●</span>
        </div>
        <div class="legend-note">
          Model valid for deciduous broadleaf forests only.<br>
          Click a class to highlight it on the map.
        </div>
      </div>

      <div v-if="forestWarn" class="forest-warn">
        ⚠️ Point may not be in dense tree cover. Proceed with care.
      </div>
    </div>
  `,

  data() {
    return {
      map:          null,
      forestLayer:  null,
      marker:       null,
      forestOn:     true,
      coord:        '',
      forestWarn:   false,
      legendOpen:   false,
      LAND_CLASSES,

      locationName: '',

      spotlightClass:  null,
      _spotlightLayer: null,

      // Drag-based area selection
      drawMode:           false,
      _drawStart:         null,
      _drawRect:          null,
      _suppressNextClick: false,
      gridMarkers:        [],
      gridPixels:         [],

      pixelMarkers: [],
    }
  },

  mounted() {
    this.map = L.map('leaflet-map', { center: [47, 12], zoom: 5 })
    L.tileLayer(DARK_TILE, { attribution: DARK_ATTR, maxZoom: 19 }).addTo(this.map)

    this.forestLayer = L.tileLayer.wms(FOREST_WMS, {
      layers: 'WORLDCOVER_2021_MAP', format: 'image/png',
      transparent: true, opacity: 0.55, attribution: FOREST_ATTR,
    })
    this.forestLayer.addTo(this.map)

    // Normal click → place point (suppressed during drag)
    this.map.on('click', e => this.onClick(e))

    // Drag-based area selection — mousedown starts the rectangle
    this.__drawMousedown = e => {
      if (!this.drawMode) return
      L.DomEvent.stopPropagation(e)
      this._drawStart = e.latlng
      this._drawRect  = L.rectangle([e.latlng, e.latlng], {
        color: '#3b82f6', weight: 2,
        fillColor: '#60a5fa', fillOpacity: 0.08, dashArray: '6,4',
      }).addTo(this.map)
    }
    this.map.on('mousedown', this.__drawMousedown)

    // Mousemove: rubber-band preview while dragging
    this.__drawMousemove = e => {
      if (!this.drawMode || !this._drawStart || !this._drawRect) return
      this._drawRect.setBounds(L.latLngBounds(this._drawStart, e.latlng))
    }
    this.map.on('mousemove', this.__drawMousemove)

    // Mouseup: commit the rectangle and build grid
    this.__drawMouseup = e => {
      if (!this.drawMode || !this._drawStart) return
      const bounds = L.latLngBounds(this._drawStart, e.latlng)
      if (this._drawRect) { this.map.removeLayer(this._drawRect); this._drawRect = null }
      this._drawStart         = null
      this.drawMode           = false
      this._suppressNextClick = true   // swallow the click Leaflet fires after mouseup
      L.DomUtil.removeClass(this.map._container, 'crosshair-cursor-active')
      this.map.dragging.enable()
      this._buildGrid(bounds)
    }
    this.map.on('mouseup', this.__drawMouseup)

    // ESC cancels draw mode
    this._kbHandler = e => { if (e.key === 'Escape') this.cancelDraw() }
    document.addEventListener('keydown', this._kbHandler)

    // Default: highlight TreeCover (class 10)
    this.$nextTick(() => this.toggleSpotlight(10))
  },

  beforeUnmount() {
    this.map?.remove()
    document.removeEventListener('keydown', this._kbHandler)
  },

  methods: {
    resize() { this.map?.invalidateSize() },

    // ── Forest toggle ──────────────────────────────────────────────────────
    toggleForest() {
      this.forestOn = !this.forestOn
      if (this.forestOn) this.forestLayer.addTo(this.map)
      else this.map.removeLayer(this.forestLayer)
    },

    // ── Click handler — only fires for real point clicks ──────────────────
    onClick(e) {
      // Swallow the click event that Leaflet fires after a drag mouseup
      if (this._suppressNextClick) { this._suppressNextClick = false; return }
      // Ignore clicks while draw mode is active (handled by mousedown/mouseup)
      if (this.drawMode) return

      const { lat, lng: lon } = e.latlng
      this.coord = `${lat.toFixed(4)}°N  ${lon.toFixed(4)}°E`
      this.forestWarn = false
      this.gridMarkers.forEach(m => this.map.removeLayer(m))
      this.gridMarkers = []; this.gridPixels = []
      if (this.marker) this.map.removeLayer(this.marker)
      this.marker = L.marker([lat, lon], { icon: MARKER_ICON })
        .addTo(this.map).bindPopup(`<b>${this.coord}</b>`).openPopup()
      this.$emit('point-selected', { lat, lon })
      this.checkForest(lat, lon)

      // Reverse geocoding via Nominatim
      fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`)
        .then(r => r.json())
        .then(d => {
          const parts = [
            d.address?.village || d.address?.town || d.address?.city || d.address?.county,
            d.address?.state,
            d.address?.country
          ].filter(Boolean)
          this.coord = parts.join(', ') + ` (${lat.toFixed(3)}° ${lon.toFixed(3)}°)`
        })
        .catch(() => {}) // keep existing coord on error
    },

    async checkForest(lat, lon) {
      try {
        const bbox = `${lon-.001},${lat-.001},${lon+.001},${lat+.001}`
        const url  = `${FOREST_WMS}?SERVICE=WMS&VERSION=1.1.1`
          + `&REQUEST=GetFeatureInfo&LAYERS=WORLDCOVER_2021_MAP&QUERY_LAYERS=WORLDCOVER_2021_MAP`
          + `&BBOX=${bbox}&WIDTH=3&HEIGHT=3&X=1&Y=1&SRS=EPSG:4326&INFO_FORMAT=application/json`
        const r = await fetch(url, { signal: AbortSignal.timeout(5000) })
        if (!r.ok) return
        const data = await r.json()
        const isForest = (data.features ?? []).some(f => {
          const cls = f.properties?.Map_Display_Class ?? f.properties?.class ?? f.properties?.DN
          return String(cls) === '10'
        })
        this.forestWarn = !isForest
      } catch { /* fail silently */ }
    },

    // ── Area draw mode ─────────────────────────────────────────────────────
    toggleDrawMode() {
      if (this.drawMode) { this.cancelDraw(); return }
      this.drawMode = true
      L.DomUtil.addClass(this.map._container, 'crosshair-cursor-active')
      this.map.dragging.disable()
    },

    cancelDraw() {
      if (!this.drawMode) return
      this.drawMode   = false
      this._drawStart = null
      this._suppressNextClick = false
      L.DomUtil.removeClass(this.map._container, 'crosshair-cursor-active')
      this.map.dragging.enable()
      if (this._drawRect) { this.map.removeLayer(this._drawRect); this._drawRect = null }
    },

    _buildGrid(bounds) {
      this.gridMarkers.forEach(m => this.map.removeLayer(m))
      this.gridMarkers = []; this.gridPixels = []
      if (this.marker) { this.map.removeLayer(this.marker); this.marker = null }

      const s = bounds.getSouth(), n = bounds.getNorth()
      const w = bounds.getWest(),  e = bounds.getEast()
      const span = Math.max(Math.abs(n - s), Math.abs(e - w))
      const step = span < 0.5  ? 0.1
                 : span < 1.5  ? 0.25
                 : span < 3.0  ? 0.5
                 : span < 6.0  ? 1.0
                 :               2.0

      for (let lat = Math.min(s,n); lat <= Math.max(s,n) + step * 0.01; lat += step) {
        for (let lon = Math.min(w,e); lon <= Math.max(w,e) + step * 0.01; lon += step) {
          if (this.gridPixels.length >= 25) break
          const latR = +lat.toFixed(4), lonR = +lon.toFixed(4)
          this.gridPixels.push(`${latR}_${lonR}`)
          const m = L.circleMarker([latR, lonR], {
            radius: 5, color: '#1e3a5f', weight: 1.5,
            fillColor: '#60a5fa', fillOpacity: 0.85,
          }).bindTooltip(`${latR}°N ${lonR}°E`, { className: 'leaf-tip' }).addTo(this.map)
          this.gridMarkers.push(m)
        }
        if (this.gridPixels.length >= 25) break
      }
      if (this.gridPixels.length) this.$emit('area-selected', this.gridPixels)
    },

    // ── Legend spotlight ───────────────────────────────────────────────────
    toggleSpotlight(cls) {
      if (this.spotlightClass === cls) {
        this.spotlightClass = null
        if (this._spotlightLayer) { this.map.removeLayer(this._spotlightLayer); this._spotlightLayer = null }
        if (this.forestOn) this.forestLayer.setOpacity(0.55)
        return
      }
      if (this._spotlightLayer) { this.map.removeLayer(this._spotlightLayer); this._spotlightLayer = null }
      this.spotlightClass = cls
      const lc = LAND_CLASSES.find(l => l.cls === cls)
      if (!lc) return
      if (this.forestOn) this.forestLayer.setOpacity(0.10)
      const SpotlightLayer = makeSpotlightLayer(lc.rgb)
      this._spotlightLayer = new SpotlightLayer({ opacity: 1, zIndex: 300 }).addTo(this.map)
    },

    // ── Multi-pixel result display ─────────────────────────────────────────
    showPixelStats(stats) {
      this.pixelMarkers.forEach(m => this.map.removeLayer(m))
      this.pixelMarkers = []
      if (!stats || stats.length < 1) return
      const maxAbs = Math.max(1, ...stats.map(s => Math.abs(s.annNEE)))
      for (const s of stats) {
        const t    = Math.abs(s.annNEE) / maxAbs
        const fill = s.annNEE < 0 ? '#4ade80' : '#f87171'
        const m = L.circleMarker([s.lat, s.lon], {
          radius: 10 + t * 12, color: '#0a0d14', weight: 1.5,
          fillColor: fill, fillOpacity: 0.72 + t * 0.2,
        }).bindPopup(
          `<div style="font-family:monospace;font-size:11px;line-height:1.7">
            <b>${s.lat.toFixed(2)}°N  ${s.lon.toFixed(2)}°E</b><br>
            <span style="color:#4ade80">GPP ${s.annGPP} gC m⁻² yr⁻¹</span><br>
            <span style="color:${s.annNEE<0?'#4ade80':'#f87171'}">NEE ${s.annNEE} gC m⁻² yr⁻¹</span>
          </div>`
        ).addTo(this.map)
        this.pixelMarkers.push(m)
      }
    },
  },
})
})()
