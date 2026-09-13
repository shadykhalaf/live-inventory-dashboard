import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const url = searchParams.get('url')

  if (!url) {
    return new NextResponse('Missing url param', { status: 400 })
  }

  // Only allow http/https URLs
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
    const res = await fetch(url, {
      headers: {
        // Mimic a browser to avoid bot-blocking
        'User-Agent': 'Mozilla/5.0 (compatible; DashboardBot/1.0)',
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
      // Server-side fetch has no CORS restrictions
    })

    if (!res.ok) {
      return new NextResponse(`Upstream error: ${res.status}`, { status: 502 })
    }

    const contentType = res.headers.get('content-type') || 'image/jpeg'
    const buffer = await res.arrayBuffer()

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
      },
    })
  } catch (err) {
    console.error('img-proxy error:', err)
    return new NextResponse('Failed to fetch image', { status: 502 })
  }
}
