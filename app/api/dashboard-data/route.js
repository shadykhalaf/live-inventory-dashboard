import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const metabaseUrl = `${process.env.METABASE_SITE_URL}/api/card/${process.env.METABASE_QUESTION_ID}/query/json`
    const res = await fetch(metabaseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.METABASE_API_KEY
      }
    })

    if (!res.ok) {
      console.error('Metabase Error:', await res.text())
      return NextResponse.json({ error: 'Failed to fetch data from Metabase' }, { status: 502 })
    }

    const data = await res.json()

    // Metabase returns a flat array of objects with these column names
    const rows = Array.isArray(data) ? data : (data.data?.rows || [])

    const transformedData = {
      periods: [
        {
          id: "whole",
          label: "Live Data",
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
            img:   r.img || r.Image || r.image || false,
            isNew: Boolean(r.isNew || r.is_new || false),
            soldMidJul:  r.soldMidJul  != null ? Number(r.soldMidJul)  : null,
            stockMidJul: r.stockMidJul != null ? Number(r.stockMidJul) : null,
          }))
        }
      ]
    }

    return NextResponse.json(transformedData, {
      headers: {
        'Cache-Control': 's-maxage=60, stale-while-revalidate=300'
      }
    })
  } catch (error) {
    console.error('API Route Error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
