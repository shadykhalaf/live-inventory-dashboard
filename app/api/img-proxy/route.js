import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

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

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const url = searchParams.get('url')

  if (!url) {
    return new NextResponse('Missing url param', { status: 400 })
  }

  let parsed
  try {
    parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return new NextResponse('Invalid URL', { status: 400 })
    }
  } catch {
    return new NextResponse('Invalid URL', { status: 400 })
  }

  try {
    // Get authenticated Odoo session
    const sessionId = await getOdooSession()

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    }

    // Attach session cookie if available
    if (sessionId) {
      headers['Cookie'] = `session_id=${sessionId}`
    }

    const res = await fetch(url, {
      headers,
      redirect: 'follow',
    })

    if (!res.ok) {
      console.error('[img-proxy] Upstream error:', res.status, url)
      return new NextResponse(`Upstream error: ${res.status}`, { status: 502 })
    }

    const contentType = res.headers.get('content-type') || 'image/jpeg'
    const buffer = await res.arrayBuffer()

    console.log('[img-proxy] Fetched:', buffer.byteLength, 'bytes, type:', contentType, 'auth:', !!sessionId)

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
        'Access-Control-Allow-Origin': '*',
      },
    })
  } catch (err) {
    console.error('[img-proxy] Fetch error:', err.message, url)
    return new NextResponse('Failed to fetch image', { status: 502 })
  }
}
