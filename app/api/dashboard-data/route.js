import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const from  = searchParams.get('from')  // YYYY-MM-DD
    const to    = searchParams.get('to')    // YYYY-MM-DD
    const debug = searchParams.get('debug') // set to '1' to see raw Metabase row

    const siteUrl    = process.env.METABASE_SITE_URL
    const questionId = process.env.METABASE_QUESTION_ID
    const apiKey     = process.env.METABASE_API_KEY
    const paramSlug  = process.env.METABASE_DATE_PARAM_SLUG || 'date_filter'

    // ── Step 1: If date range is requested, look up the card's parameter UUID ──
    let paramId = paramSlug
    if (from && to) {
      try {
        const cardRes = await fetch(`${siteUrl}/api/card/${questionId}`, {
          headers: { 'x-api-key': apiKey }
        })
        if (cardRes.ok) {
          const card = await cardRes.json()
          // Find the matching template tag parameter by slug/name
          const paramDef = (card.parameters || []).find(
            p => p.slug === paramSlug || p.id === paramSlug || p.name === paramSlug
          )
          if (paramDef) {
            paramId = paramDef.id
            console.log('[dashboard-data] Found param UUID:', paramId, 'for slug:', paramSlug)
          } else {
            console.log('[dashboard-data] No param found matching slug:', paramSlug,
              'Available params:', JSON.stringify((card.parameters || []).map(p => ({ id: p.id, slug: p.slug, name: p.name, type: p.type }))))
          }
        }
      } catch (e) {
        console.log('[dashboard-data] Could not fetch card metadata:', e.message)
      }
    }

    // ── Step 2: Build the Metabase POST body ──
    const body = {}
    if (from && to) {
      body.parameters = [
        {
          id:     paramId,
          type:   'date/range',
          target: ['dimension', ['template-tag', paramSlug]],
          value:  `${from}~${to}`
        }
      ]
    }

    const metabaseUrl = `${siteUrl}/api/card/${questionId}/query/json`

    console.log('[dashboard-data] Fetching:', metabaseUrl)
    console.log('[dashboard-data] Body:', JSON.stringify(body))

    const res = await fetch(metabaseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey
      },
      body: JSON.stringify(body)
    })

    if (!res.ok) {
      const errorText = await res.text()
      console.error('[dashboard-data] Metabase Error:', res.status, errorText)
      return NextResponse.json({
        error: 'Failed to fetch data from Metabase',
        metabaseStatus: res.status,
        metabaseError: errorText.substring(0, 500)
      }, { status: 502 })
    }

    const data = await res.json()

    // Metabase returns a flat array of objects with these column names
    const rows = Array.isArray(data) ? data : (data.data?.rows || [])

    console.log('[dashboard-data] Rows received:', rows.length)
    if (rows.length > 0) {
      console.log('[dashboard-data] First row keys:', Object.keys(rows[0]).join(', '))
      console.log('[dashboard-data] First row image_url:', rows[0].image_url)
      console.log('[dashboard-data] First row days_in_range:', rows[0].days_in_range)
    }

    const transformedData = {
      // Echo back the active date range so the client can display it
      activeFrom: from || null,
      activeTo:   to   || null,
      paramIdUsed: from && to ? paramId : null,
      periods: [
        {
          id: "whole",
          label: from && to ? `${from} → ${to}` : "Live Data",
          short: "Live",
          days: rows[0]?.days_in_range || 95,
          status: "ongoing",
          rows: rows.map(r => ({
            c:    r.product_category || r.c || r.Category || r.category || 'Uncategorized',
            n:    r.product_name     || r.n || r.Name     || r.name     || 'Unknown Product',
            rev:  Number(r.total_sales          ?? r.rev     ?? r.Revenue  ?? r.revenue  ?? 0),
            sold: Number(r.items_sold           ?? r.sold    ?? r.Sold     ?? 0),
            stock:Number(r.current_stock_level  ?? r.stock   ?? r.Stock    ?? 0),
            ads:  Number(r.avg_units_per_day    ?? r.ads     ?? 0),
            adr:  Number(r.avg_daily_total_sales?? r.adr     ?? 0),
            cov:  Number(r.stock_coverage_days  ?? r.cov     ?? r.coverage ?? 0),
            price: (r.item_price ?? r.true_unit_price ?? r.price) != null
                    ? Number(r.item_price ?? r.true_unit_price ?? r.price)
                    : false,
            img:   r.image_url || r.img || r.Image || r.image || r.image_src || r.photo_url || false,
            isNew: Boolean(r.isNew || r.is_new || false),
            soldMidJul:  r.soldMidJul  != null ? Number(r.soldMidJul)  : null,
            stockMidJul: r.stockMidJul != null ? Number(r.stockMidJul) : null,
          }))
        }
      ]
    }

    // Optional: return a debug snapshot of the raw Metabase row
    if (debug === '1' && rows.length > 0) {
      transformedData._debug = {
        rawKeys: Object.keys(rows[0]),
        rawFirstRow: rows[0],
        totalRows: rows.length,
        bodySent: body,
        paramIdUsed: paramId,
        transformedFirstRow: transformedData.periods[0].rows[0],
      }
    }

    return NextResponse.json(transformedData, {
      headers: {
        'Cache-Control': 's-maxage=60, stale-while-revalidate=300'
      }
    })
  } catch (error) {
    console.error('[dashboard-data] API Route Error:', error)
    return NextResponse.json({ error: 'Internal Server Error', message: error.message }, { status: 500 })
  }
}
