import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const allowedEmails = (process.env.ALLOWED_EMAILS || '').split(',').map(e => e.trim().toLowerCase())
  if (!allowedEmails.includes(user.email.toLowerCase())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

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
    
    // Ensure we handle case where Metabase returns an array of objects
    const rows = Array.isArray(data) ? data : (data.data?.rows || [])

    const transformedData = {
      periods: [
        {
          id: "whole",
          label: "Live Data",
          short: "Live",
          days: 95, // Default fallback
          status: "ongoing",
          rows: rows.map(r => ({
            c: r.c || r.Category || r.category || 'Uncategorized',
            n: r.n || r.Name || r.name || 'Unknown Product',
            rev: Number(r.rev || r.Revenue || r.revenue || 0),
            sold: Number(r.sold || r.Sold || r.sold_units || 0),
            stock: Number(r.stock || r.Stock || r.available_stock || 0),
            ads: Number(r.ads || r.Ads || 0),
            adr: Number(r.adr || r.Adr || 0),
            cov: Number(r.cov || r.Cov || r.coverage || 0),
            price: r.price ? Number(r.price) : false,
            img: r.img || r.Image || r.image || false,
            isNew: Boolean(r.isNew || r.is_new || false),
            soldMidJul: r.soldMidJul != null ? Number(r.soldMidJul) : null,
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
