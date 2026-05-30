const BASE = import.meta.env.VITE_API_BASE ?? '/api'

export async function runModel(payload) {
  const r = await fetch(`${BASE}/breath/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!r.ok) throw new Error(`Run failed: ${r.status}`)
  return r.json()
}

export async function getStatus() {
  const r = await fetch(`${BASE}/breath/status`)
  if (!r.ok) throw new Error(`Status failed: ${r.status}`)
  return r.json()
}

export function openLogStream(onMessage, onError) {
  const es = new EventSource(`${BASE}/breath/stream/logs`)
  es.onmessage = e => onMessage(e.data.replace(/\\n/g, '\n'))
  es.onerror   = () => { onError?.(); es.close() }
  return es
}

export async function getLatestResults() {
  const r = await fetch(`${BASE}/results/latest/json`)
  if (!r.ok) throw new Error(`Results failed: ${r.status}`)
  return r.json()
}

export async function getParameters() {
  const r = await fetch(`${BASE}/parameters`)
  if (!r.ok) throw new Error(`Params failed: ${r.status}`)
  return r.json()
}

export async function saveParameters(params) {
  const r = await fetch(`${BASE}/parameters`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  if (!r.ok) throw new Error(`Save failed: ${r.status}`)
  return r.json()
}

// External API: POST with own data
export async function computeWithData(payload) {
  const r = await fetch(`${BASE}/breath/compute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!r.ok) throw new Error(`Compute failed: ${r.status}`)
  return r.json()
}
