import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Raw, unmodified rows of the Metabase question, for the redesigned dashboard.
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD   date range (any day, not only whole months)
//   ?tag=winter                      Metabase's tag_filter  (only products carrying that Shopify tag)
//   ?exclude=winter                  Metabase's exclude_tag_filter (the reverse)
//   ?meta=1                          also return the question's parameter definitions (names, slugs, types — no secrets)
export async function GET(request) {
  try {
    const sp = new URL(request.url).searchParams
    const from = sp.get('from'), to = sp.get('to'), tag = sp.get('tag'), exclude = sp.get('exclude'), meta = sp.get('meta')
    const siteUrl = process.env.METABASE_SITE_URL
    const questionId = process.env.METABASE_QUESTION_ID
    const apiKey = process.env.METABASE_API_KEY
    const headers = { 'x-api-key': apiKey }

    // Diagnostics (read-only): ?list=1 lists saved questions; ?def=ID returns a question's definition.
    if (sp.get('list')) {
      const r = await fetch(`${siteUrl}/api/card`, { headers })
      const all = r.ok ? await r.json() : []
      return NextResponse.json({ cards: all.map((c) => ({ id: c.id, name: c.name, type: c.display, collection: c.collection?.name })) })
    }
    if (sp.get('api') && /^\/api\/(dashboard|field|table)(\/[0-9]+)?(\/query_metadata)?$/.test(sp.get('api'))) {
      const r = await fetch(`${siteUrl}${sp.get('api')}`, { headers })
      const j = r.ok ? await r.json() : { status: r.status }
      return NextResponse.json(j)
    }
    // Sales exactly as the Metabase Main Dashboard counts them ("Total Sales" = revenue + tax, the figure Odoo's dashboard shows too) (detailed_orders, Cairo days, not cancelled/draft):
    // per product revenue + units (total and Shopify Web), plus the discount / loyalty / shipping lines that have no product.
    if (sp.get('sales')) {
      const f = sp.get('from'), t = sp.get('to')
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f || '') || !/^\d{4}-\d{2}-\d{2}$/.test(t || '')) return NextResponse.json({ error: 'from/to required (YYYY-MM-DD)' }, { status: 400 })
      const query = `SELECT line_type, IF(line_type = 'Product', TRIM(product_name), '') AS name, ANY_VALUE(product_type) AS category,
        SUM(revenue + COALESCE(tax_amount, 0)) AS rev, SUM(revenue) AS rev_ex_tax, SUM(quantity) AS qty,
        SUM(IF(store_location = 'Shopify Web', revenue + COALESCE(tax_amount, 0), 0)) AS on_rev, SUM(IF(store_location = 'Shopify Web', quantity, 0)) AS on_qty
        FROM \`dark-bit-489910-q1.odoo_metrics.detailed_orders\`
        WHERE order_status NOT IN ('cancel', 'draft') AND DATE(sale_date, 'Africa/Cairo') BETWEEN DATE '${f}' AND DATE '${t}'
        GROUP BY line_type, name`
      const r = await fetch(`${siteUrl}/api/dataset`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ database: 2, type: 'native', native: { query } }) })
      const j = await r.json()
      if (!r.ok || j.error) return NextResponse.json({ error: 'sales query failed', detail: String(j.error || r.status).slice(0, 300) }, { status: 502 })
      const cols = (j.data?.cols || []).map((c) => c.name)
      const rows = (j.data?.rows || []).map((row) => Object.fromEntries(cols.map((c, i) => [c, row[i]])))
      return NextResponse.json({ from: f, to: t, count: rows.length, rows }, { headers: { 'Cache-Control': 's-maxage=60, stale-while-revalidate=300' } })
    }
    // Totals exactly as the Metabase "Main Dashboard" computes them (same questions, same date filter).
    if (sp.get('summary')) {
      const dash = await (await fetch(`${siteUrl}/api/dashboard/2`, { headers })).json()
      const dp = (dash.parameters || []).find((p) => p.slug === 'date')
      const ids = { total: 75, channel: 77, store: 72, category: 177 }
      const out = {}
      for (const [k, cid] of Object.entries(ids)) {
        const dc = (dash.dashcards || []).find((d) => d.card_id === cid)
        if (!dc || !dp) { out[k] = { error: 'not on dashboard' }; continue }
        const body = { parameters: sp.get('from') && sp.get('to') ? [{ id: dp.id, type: dp.type, value: `${sp.get('from')}~${sp.get('to')}`, target: undefined }] : [] }
        const r = await fetch(`${siteUrl}/api/dashboard/2/dashcard/${dc.id}/card/${cid}/query`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        const j = await r.json()
        out[k] = r.ok ? { cols: (j.data?.cols || []).map((c) => c.name), rows: j.data?.rows } : { status: r.status, detail: JSON.stringify(j).slice(0, 300) }
      }
      return NextResponse.json(out)
    }
    if (sp.get('def')) {
      const r = await fetch(`${siteUrl}/api/card/${encodeURIComponent(sp.get('def'))}`, { headers })
      const c = r.ok ? await r.json() : {}
      return NextResponse.json({ id: c.id, name: c.name, query: c.dataset_query, params: (c.parameters || []).map((p) => ({ name: p.name, slug: p.slug, type: p.type })) })
    }
    const cardRes = await fetch(`${siteUrl}/api/card/${questionId}`, { headers })
    if (!cardRes.ok) return NextResponse.json({ error: 'card lookup failed', status: cardRes.status }, { status: 502 })
    const card = await cardRes.json()
    const defs = card.parameters || []
    const find = (slug) => defs.find((p) => p.slug === slug || p.name === slug || p.id === slug)

    const parameters = []
    const add = (slug, value) => {
      const d = find(slug)
      if (!d) return
      parameters.push({ id: d.id, type: d.type, value })
    }
    if (from && to) add(process.env.METABASE_DATE_PARAM_SLUG || 'date_filter', `${from}~${to}`)
    const textVal = (slug, v) => {
      const d = find(slug)
      return d && /^string|category|text/.test(d.type || '') ? [v] : v
    }
    if (tag) add('tag_filter', textVal('tag_filter', tag))
    if (exclude) add('exclude_tag_filter', textVal('exclude_tag_filter', exclude))

    const res = await fetch(`${siteUrl}/api/card/${questionId}/query/json`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(parameters.length ? { parameters } : {}),
    })
    if (!res.ok) {
      const t = await res.text()
      return NextResponse.json({ error: 'Metabase query failed', status: res.status, detail: t.substring(0, 400) }, { status: 502 })
    }
    const data = await res.json()
    const rows = Array.isArray(data) ? data : data.data?.rows || []
    const out = { from, to, tag, exclude, count: rows.length, rows }
    if (meta === '1') {
      out.meta = { columns: rows[0] ? Object.keys(rows[0]) : [], parameters: defs.map((p) => ({ id: p.id, name: p.name, slug: p.slug, type: p.type })), sent: parameters.map((p) => ({ ...p, id: p.id.slice(0, 8) })) }
    }
    return NextResponse.json(out, { headers: { 'Cache-Control': 's-maxage=60, stale-while-revalidate=300' } })
  } catch (e) {
    return NextResponse.json({ error: 'Internal error', message: e.message }, { status: 500 })
  }
}
