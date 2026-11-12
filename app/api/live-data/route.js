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
