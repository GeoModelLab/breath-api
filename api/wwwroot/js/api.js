/* ── BREATH API client ──────────────────────────────────────── */
const API = window.BREATH_API_BASE ?? '/api'

async function breathRun(payload) {
  const r = await fetch(`${API}/breath/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!r.ok) { const t = await r.text(); throw new Error(t || r.status) }
  return r.json()
}

async function breathStatus() {
  const r = await fetch(`${API}/breath/status`)
  if (!r.ok) throw new Error(r.status)
  return r.json()
}

function breathLogStream(onMsg, onClose) {
  const es = new EventSource(`${API}/breath/stream/logs`)
  es.onmessage = e => onMsg(e.data.replace(/\\n/g, '\n'))
  es.onerror   = () => { es.close(); onClose?.() }
  return es
}

async function breathLatestResult() {
  const r = await fetch(`${API}/results/latest/json`)
  if (!r.ok) throw new Error(r.status)
  return r.json()
}

async function breathGetParams() {
  const r = await fetch(`${API}/parameters`)
  if (!r.ok) throw new Error(r.status)
  return r.json()
}

async function breathSaveParams(params) {
  const r = await fetch(`${API}/parameters`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  if (!r.ok) throw new Error(r.status)
  return r.json()
}
