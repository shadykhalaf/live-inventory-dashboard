import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * Transform Odoo query-param image URL to the path-based public format.
 * /web/image?model=product.product&id=19800&field=image_1024
 *   → /web/image/product.product/19800/image_256
 * The path-based format is Odoo's standard public image endpoint.
 */
function toPublicOdooUrl(originalUrl) {
  try {
    const u = new URL(originalUrl)
    const model = u.searchParams.get('model')
    const id = u.searchParams.get('id')
    if (model && id) {
      // Use image_256 for dashboard (smaller, often publicly accessible)
      return `${u.origin}/web/image/${model}/${id}/image_256`
    }
  } catch {}
  return originalUrl
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

  // Try the public path-based URL first, then fall back to original
  const publicUrl = toPublicOdooUrl(url)
  const urlsToTry = publicUrl !== url ? [publicUrl, url] : [url]

  for (const tryUrl of urlsToTry) {
    try {
      const res = await fetch(tryUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        redirect: 'follow',
      })

      if (!res.ok) {
        console.error('[img-proxy] Failed:', res.status, tryUrl)
        continue
      }

      const contentType = res.headers.get('content-type') || 'image/jpeg'
      const buffer = await res.arrayBuffer()

      // Skip if this is the tiny Odoo placeholder (< 7000 bytes)
      // and we have another URL to try
      if (buffer.byteLength < 7000 && urlsToTry.indexOf(tryUrl) < urlsToTry.length - 1) {
        console.log('[img-proxy] Got placeholder, trying next URL. Size:', buffer.byteLength)
        continue
      }

      console.log('[img-proxy] OK:', tryUrl.substring(0, 80), 'size:', buffer.byteLength)

      return new NextResponse(buffer, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
          'Access-Control-Allow-Origin': '*',
        },
      })
    } catch (err) {
      console.error('[img-proxy] Fetch error:', err.message, tryUrl)
      continue
    }
  }

  return new NextResponse('Failed to fetch image', { status: 502 })
}
