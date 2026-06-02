;(function() {
const { defineComponent } = Vue

const DARK_TILE    = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
const DARK_ATTR    = '&copy; <a href="https://carto.com/">CartoDB</a> &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
// NASA GIBS — MODIS Terra Land Cover Type 1 (IGBP) 2021, publicly accessible, CORS-enabled
const GIBS_LC = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best'
             + '/MODIS_Terra_Land_Cover_Type1/default/2021-01-01'
             + '/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png'
const FOREST_ATTR = '&copy; <a href="https://nasa.gov/">NASA</a> MODIS Land Cover · '
                  + '<a href="https://earthdata.nasa.gov/eosdis/science-system-description/eosdis-components/gibs">GIBS</a>'

const MARKER_ICON = L.icon({
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize:    [22, 36], iconAnchor:  [11, 36],
  popupAnchor: [1, -30], shadowSize:  [36, 36],
})

// MODIS IGBP Land Cover Type 1 — RGB values match GIBS colormap
const LAND_CLASSES = [
  { cls:  1, color: '#05450a', rgb: [  5, 69, 10], label: 'Evergreen Needleleaf Forest', target: false },
  { cls:  2, color: '#086a10', rgb: [  8,106, 16], label: 'Evergreen Broadleaf Forest',  target: false },
  { cls:  3, color: '#54a708', rgb: [ 84,167,  8], label: 'Deciduous Needleleaf Forest', target: false },
  { cls:  4, color: '#78d203', rgb: [120,210,  3], label: 'Deciduous Broadleaf Forest',  target: true  },
  { cls:  5, color: '#009900', rgb: [  0,153,  0], label: 'Mixed Forests',               target: false },
  { cls:  6, color: '#c6b044', rgb: [198,176, 68], label: 'Closed Shrublands',           target: false },
  { cls:  7, color: '#dcd159', rgb: [220,209, 89], label: 'Open Shrublands',             target: false },
  { cls:  9, color: '#fbff13', rgb: [251,255, 19], label: 'Savannas',                    target: false },
  { cls: 10, color: '#b6ff05', rgb: [182,255,  5], label: 'Grasslands',                  target: false },
  { cls: 12, color: '#c24f44', rgb: [194, 79, 68], label: 'Croplands',                   target: false },
  { cls: 13, color: '#a5a5a5', rgb: [165,165,165], label: 'Urban / Built-up',             target: false },
  { cls: 17, color: '#1c0dff', rgb: [ 28, 13,255], label: 'Water Bodies',                target: false },
]

// Canvas GridLayer: fetches GIBS MODIS tiles and dims pixels that don't match targetRgb.
function makeSpotlightLayer(targetRgb) {
  const [tr, tg, tb] = targetRgb
  const THRESH = 40

  return L.GridLayer.extend({
    createTile(coords, done) {
      const size  = this.getTileSize()
      const tile  = L.DomUtil.create('canvas')
      tile.width  = size.x
      tile.height = size.y
      // Clamp zoom to GIBS max native zoom (7) for tile fetching
      const tz   = Math.min(coords.z, 7)
      const scale = Math.pow(2, coords.z - tz)
      const tx   = Math.floor(coords.x / scale)
      const ty   = Math.floor(coords.y / scale)
      const url  = `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best`
                 + `/MODIS_Terra_Land_Cover_Type1/default/2021-01-01`
                 + `/GoogleMapsCompatible_Level7/${tz}/${ty}/${tx}.png`
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

// Color scales for map pixel display
function neeColor(nee) {
  return nee < 0 ? '#4ade80' : '#f87171'
}
function gppColor() { return '#4ade80' }
function recoColor() { return '#f87171' }

window.MapPanel = defineComponent({
  name: 'MapPanel',
  emits: ['point-selected', 'area-selected', 'history-point-selected'],
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

        <!-- Grid variable selector (only visible when grid results are shown) -->
        <select v-if="hasGridStats" v-model="gridVar" class="grid-var-sel"
                @change="refreshGridDisplay" title="Variable shown on grid pixels">
          <option value="nee">NEE</option>
          <option value="gpp">GPP</option>
          <option value="reco">RECO</option>
        </select>

        <div v-if="coord" class="coord-pill">{{ coord }}</div>
        <button class="legend-btn" @click="legendOpen=!legendOpen" title="Map legend">▤</button>
      </div>

      <!-- ── Legend ── -->
      <div v-if="legendOpen" class="map-legend">
        <div class="legend-title">MODIS Land Cover 2021</div>
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

      // Grid results display
      pixelMarkers:   [],
      _lastGridStats: null,
      gridVar:        'nee',   // variable shown on grid pixels

      // History of simulated single points (kept across re-selections)
      pointHistory:   [],   // [{ lat, lon, label, stats, marker }]
    }
  },

  computed: {
    hasGridStats() { return this._lastGridStats && this._lastGridStats.length > 0 },
  },

  mounted() {
    this.map = L.map('leaflet-map', { center: [47, 12], zoom: 5 })
    L.tileLayer(DARK_TILE, { attribution: DARK_ATTR, maxZoom: 19 }).addTo(this.map)

    this.forestLayer = L.tileLayer(GIBS_LC, {
      opacity: 0.55, attribution: FOREST_ATTR,
      maxNativeZoom: 7, maxZoom: 13,
    })
    this.forestLayer.addTo(this.map)

    this.map.on('click', e => this.onClick(e))

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

    this.__drawMousemove = e => {
      if (!this.drawMode || !this._drawStart || !this._drawRect) return
      this._drawRect.setBounds(L.latLngBounds(this._drawStart, e.latlng))
    }
    this.map.on('mousemove', this.__drawMousemove)

    this.__drawMouseup = e => {
      if (!this.drawMode || !this._drawStart) return
      const bounds = L.latLngBounds(this._drawStart, e.latlng)
      if (this._drawRect) { this.map.removeLayer(this._drawRect); this._drawRect = null }
      this._drawStart         = null
      this.drawMode           = false
      this._suppressNextClick = true
      L.DomUtil.removeClass(this.map._container, 'crosshair-cursor-active')
      this.map.dragging.enable()
      this._buildGrid(bounds)
    }
    this.map.on('mouseup', this.__drawMouseup)

    this._kbHandler = e => { if (e.key === 'Escape') this.cancelDraw() }
    document.addEventListener('keydown', this._kbHandler)

    this.$nextTick(() => this.toggleSpotlight(10))

    // Automatically re-invalidate when the container actually resizes (CSS transitions)
    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => this.resize())
      this._resizeObserver.observe(document.getElementById('leaflet-map'))
    }
  },

  beforeUnmount() {
    this._resizeObserver?.disconnect()
    this.map?.remove()
    document.removeEventListener('keydown', this._kbHandler)
  },

  methods: {
    resize() {
      if (!this.map) return
      this.map.invalidateSize({ debounceMoveend: false })
      // Re-center the view at the same position to force all overlays (markers, SVG) to reposition
      this.map.setView(this.map.getCenter(), this.map.getZoom(), { animate: false })
    },

    toggleForest() {
      this.forestOn = !this.forestOn
      if (this.forestOn) this.forestLayer.addTo(this.map)
      else this.map.removeLayer(this.forestLayer)
    },

    onClick(e) {
      if (this._suppressNextClick) { this._suppressNextClick = false; return }
      if (this.drawMode) return

      const { lat, lng: lon } = e.latlng
      this.coord = `${lat.toFixed(4)}°N  ${lon.toFixed(4)}°E`
      this.forestWarn = false
      this.gridMarkers.forEach(m => this.map.removeLayer(m))
      this.gridMarkers = []; this.gridPixels = []

      // Remove current (un-simulated) marker if present
      if (this.marker) this.map.removeLayer(this.marker)
      this.marker = L.marker([lat, lon], { icon: MARKER_ICON })
        .addTo(this.map).bindPopup(`<b>${this.coord}</b>`).openPopup()
      this.$emit('point-selected', { lat, lon })
      this.checkForest(lat, lon)

      // Reverse geocoding via Nominatim
      fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`)
        .then(r => r.json())
        .then(d => {
          const addr = d.address ?? {}
          const place = addr.natural || addr.forest || addr.wood || addr.nature_reserve
                     || addr.village || addr.town || addr.city || addr.county
          const parts = [
            place,
            addr.state,
            addr.country
          ].filter(Boolean)
          const label = parts.join(', ')
          const coordStr = `${lat.toFixed(3)}°N ${lon.toFixed(3)}°E`
          this.coord = label ? `${label} (${coordStr})` : coordStr
          this.locationName = label || `${lat.toFixed(3)}_${lon.toFixed(3)}`
          // Update the current marker popup with enriched info
          if (this.marker) {
            this.marker.getPopup()?.setContent(
              `<div style="font-family:monospace;font-size:11px;line-height:1.7">
                <b>${place || coordStr}</b><br>
                ${addr.state ? addr.state + ', ' : ''}${addr.country || ''}<br>
                <span style="color:#94a3b8">${coordStr}</span>
              </div>`
            )
          }
          // Save the enriched label for history
          this._pendingLabel = this.coord
        })
        .catch(() => { this._pendingLabel = null })
    },

    async checkForest(lat, lon) {
      try {
        const url = `/api/landcover/featureinfo?lat=${lat}&lon=${lon}`
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
          // Show as a square "pixel" (half-step padding) instead of a point
          const half = step / 2
          const rect = L.rectangle(
            [[latR - half, lonR - half], [latR + half, lonR + half]],
            { color: '#1e3a5f', weight: 1.5, fillColor: '#60a5fa', fillOpacity: 0.45 }
          ).bindTooltip(`${latR}°N ${lonR}°E`, { className: 'leaf-tip' }).addTo(this.map)
          this.gridMarkers.push(rect)
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

    // ── Attach simulation KPIs to the current single-point marker ──────────
    attachPointStats(lat, lon, stats, label, csv) {
      const existing = this.pointHistory.find(h => h.lat === lat && h.lon === lon)
      if (existing) {
        existing.stats = stats
        existing.csv   = csv ?? existing.csv
        existing.label = label || existing.label
        this._refreshHistoryMarker(existing)
        return
      }

      if (this.marker) { this.map.removeLayer(this.marker); this.marker = null }

      const entry = { lat, lon, label: label || `${lat.toFixed(3)}°N ${lon.toFixed(3)}°E`, stats, csv: csv ?? null }
      this._refreshHistoryMarker(entry)
      this.pointHistory.push(entry)
    },

    _refreshHistoryMarker(entry) {
      if (entry.marker) { this.map.removeLayer(entry.marker); entry.marker = null }
      const { lat, lon, label, stats } = entry
      const fill = (stats?.annNEE ?? 0) < 0 ? '#4ade80' : '#f87171'
      entry.marker = L.circleMarker([lat, lon], {
        radius: 10, color: '#0a0d14', weight: 2,
        fillColor: fill, fillOpacity: 0.85,
      }).bindPopup(
        `<div style="font-family:monospace;font-size:11px;line-height:1.9;min-width:180px">
          <b style="color:#e2e8f0">${label}</b><br>
          <span style="color:#4ade80">GPP ${stats?.annGPP ?? '—'} gC m⁻² yr⁻¹</span><br>
          <span style="color:#f87171">RECO ${stats?.annRECO ?? '—'} gC m⁻² yr⁻¹</span><br>
          <span style="color:${fill}">NEE ${stats?.annNEE ?? '—'} gC m⁻² yr⁻¹</span><br>
          <span style="color:#94a3b8">CUE ${stats?.cue ?? '—'}</span><br>
          ${stats?.koppen ? `<span style="color:#a78bfa">🌍 ${stats.koppen}</span><br>` : ''}
          <a href="#" onclick="event.preventDefault()" style="color:#60a5fa;font-size:10px"
             data-lat="${lat}" data-lon="${lon}">📊 View results</a>
        </div>`
      ).on('popupopen', (ev) => {
        // Wire up the "View results" link inside the popup
        const link = ev.popup.getElement()?.querySelector('[data-lat]')
        if (link) {
          link.addEventListener('click', () => {
            this.$emit('history-point-selected', { lat, lon })
          })
        }
      }).addTo(this.map)
    },

    // ── Multi-pixel result display ─────────────────────────────────────────
    showPixelStats(stats) {
      this._lastGridStats = stats
      this.pixelMarkers.forEach(m => this.map.removeLayer(m))
      this.pixelMarkers = []
      if (!stats || stats.length < 1) return
      this._renderGridVar()
    },

    refreshGridDisplay() {
      this._renderGridVar()
    },

    _renderGridVar() {
      this.pixelMarkers.forEach(m => this.map.removeLayer(m))
      this.pixelMarkers = []
      const stats = this._lastGridStats
      if (!stats || !stats.length) return

      const varKey = this.gridVar   // 'nee' | 'gpp' | 'reco'
      const values = stats.map(s => {
        if (varKey === 'nee')  return s.annNEE  ?? 0
        if (varKey === 'gpp')  return s.annGPP  ?? 0
        if (varKey === 'reco') return s.annRECO ?? 0
        return 0
      })
      const maxAbs = Math.max(1, ...values.map(v => Math.abs(v)))

      // Infer pixel step from actual lat/lon spacing in stats
      const lats = [...new Set(stats.map(s => s.lat))].sort((a,b) => a-b)
      const lons = [...new Set(stats.map(s => s.lon))].sort((a,b) => a-b)
      const stepLat = lats.length > 1 ? lats[1] - lats[0] : 0.1
      const stepLon = lons.length > 1 ? lons[1] - lons[0] : 0.1
      const step = Math.max(stepLat, stepLon) || 0.1

      for (let i = 0; i < stats.length; i++) {
        const s   = stats[i]
        const val = values[i]
        const t   = Math.abs(val) / maxAbs

        let fill, label
        if (varKey === 'nee') {
          fill  = val < 0 ? '#4ade80' : '#f87171'
          label = `NEE ${val} gC m⁻² yr⁻¹`
        } else if (varKey === 'gpp') {
          const g = Math.round(t * 200)
          fill  = `rgb(${255-g},${100+g},${50})`
          label = `GPP ${val} gC m⁻² yr⁻¹`
        } else {
          const g = Math.round(t * 200)
          fill  = `rgb(${100+g},${50},${50})`
          label = `RECO ${val} gC m⁻² yr⁻¹`
        }

        const half = step / 2
        const rect = L.rectangle(
          [[s.lat - half, s.lon - half], [s.lat + half, s.lon + half]],
          {
            color: '#0a0d14', weight: 1,
            fillColor: fill, fillOpacity: 0.72 + t * 0.2,
          }
        ).bindPopup(
          `<div style="font-family:monospace;font-size:11px;line-height:1.7">
            <b>${s.lat.toFixed(2)}°N  ${s.lon.toFixed(2)}°E</b><br>
            <span style="color:#4ade80">GPP ${s.annGPP} gC m⁻² yr⁻¹</span><br>
            <span style="color:#f87171">RECO ${s.annRECO ?? '—'} gC m⁻² yr⁻¹</span><br>
            <span style="color:${s.annNEE<0?'#4ade80':'#f87171'}">NEE ${s.annNEE} gC m⁻² yr⁻¹</span>
          </div>`
        ).addTo(this.map)
        this.pixelMarkers.push(rect)
      }
    },
  },
})
})()
