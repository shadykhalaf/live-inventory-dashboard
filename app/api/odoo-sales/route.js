import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// READ-ONLY probe of Odoo's own sales figures (sale.report / pos.report). Only read_group and fields_get are ever called.
// Cache the session ID so we don't re-authenticate on every image request
let cachedSessionId = null
let sessionExpiry = 0

async function getOdooSession() {
  // Reuse cached session if not expired (refresh every 30 minutes)
  if (cachedSessionId && Date.now() < sessionExpiry) {
    return cachedSessionId
  }

  const authRes = await fetch('https://in-your-shoe.odoo.com/web/session/authenticate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'call',
      params: {
        db: 'in-your-shoe-live-18413101',
        login: process.env.ODOO_LOGIN || 'admin@inyourshoe.com',
        password: process.env.ODOO_PASSWORD || 'Admin@IYS',
      },
    }),
  })

  // Extract session_id from Set-Cookie header
  const cookies = authRes.headers.getSetCookie?.() || []
  let sessionId = null
  for (const cookie of cookies) {
    const match = cookie.match(/session_id=([^;]+)/)
    if (match) {
      sessionId = match[1]
      break
    }
  }

  // Fallback: try raw headers
  if (!sessionId) {
    const rawCookie = authRes.headers.get('set-cookie') || ''
    const match = rawCookie.match(/session_id=([^;]+)/)
    if (match) sessionId = match[1]
  }

  if (sessionId) {
    cachedSessionId = sessionId
    sessionExpiry = Date.now() + 30 * 60 * 1000 // 30 min
    console.log('[img-proxy] Odoo session obtained successfully')
  } else {
    console.error('[img-proxy] Failed to get Odoo session. Auth response status:', authRes.status)
    const body = await authRes.text()
    console.error('[img-proxy] Auth response body (first 500):', body.substring(0, 500))
  }

  return sessionId
}


const ODOO = 'https://in-your-shoe.odoo.com'
const rpc = async (sid, model, method, args, kwargs = {}) => {
  if (!['read_group', 'fields_get'].includes(method) || !['sale.report', 'report.pos.order'].includes(model)) throw new Error('not allowed')
  const r = await fetch(`${ODOO}/web/dataset/call_kw/${model}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `session_id=${sid}` },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { model, method, args, kwargs } }),
  })
  const j = await r.json()
  if (j.error) throw new Error(`${model}.${method} HTTP ${r.status}: ` + JSON.stringify({ n: j.error.data?.name, m: j.error.data?.message || j.error.message }).slice(0, 300))
  return j.result
}
// Cairo day -> UTC bounds (Cairo is UTC+2 in winter, UTC+3 in summer; Egypt observes DST)
const bounds = (from, to) => {
  const off = (d) => new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', timeZoneName: 'shortOffset' }).formatToParts(new Date(d + 'T12:00:00Z')).find((p) => p.type === 'timeZoneName').value.replace('GMT', '') || '+0'
  const iso = (d, t) => { const o = +off(d); return new Date(Date.parse(`${d}T${t}Z`) - o * 3600e3).toISOString().replace('T', ' ').slice(0, 19) }
  return [iso(from, '00:00:00'), iso(to, '23:59:59')]
}
export async function GET(request) {
  try {
    const sp = new URL(request.url).searchParams
    const f = sp.get('from'), t = sp.get('to')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f || '') || !/^\d{4}-\d{2}-\d{2}$/.test(t || '')) return NextResponse.json({ error: 'from/to required' }, { status: 400 })
    const sid = await getOdooSession()
    if (!sid) return NextResponse.json({ error: 'odoo session failed' }, { status: 502 })
    const [lo, hi] = bounds(f, t)
    const out = { from: f, to: t, utc: [lo, hi] }
    if (sp.get('fields')) {
      for (const m of ['sale.report', 'report.pos.order']) { const fg = await rpc(sid, m, 'fields_get', [], { attributes: ['string', 'type'] }); out[m] = Object.fromEntries(Object.entries(fg).map(([k, v]) => [k, v.type])) }
      return NextResponse.json(out)
    }
    const gb = sp.get('by') || 'state'
    const sale = await rpc(sid, 'sale.report', 'read_group', [[['date', '>=', lo], ['date', '<=', hi]], ['price_total:sum', 'price_subtotal:sum', 'product_uom_qty:sum'], [gb]], { lazy: false })
    out.sale = sale.map((g) => ({ k: g[gb], n: g.__count, total: g.price_total, sub: g.price_subtotal, qty: g.product_uom_qty }))
    const pos = await rpc(sid, 'report.pos.order', 'read_group', [[['date', '>=', lo], ['date', '<=', hi]], ['price_total:sum', 'price_sub_total:sum', 'product_qty:sum'], [sp.get('posby') || 'state']], { lazy: false })
    out.pos = pos.map((g) => ({ k: g[sp.get('posby') || 'state'], n: g.__count, total: g.price_total, sub: g.price_sub_total, qty: g.product_qty }))
    return NextResponse.json(out)
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 })
  }
}
