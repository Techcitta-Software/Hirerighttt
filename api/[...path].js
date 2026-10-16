/**
 * Vercel serverless proxy: browser calls same-origin /api/* → Render Node backend.
 * Set RENDER_API_URL in Vercel (e.g. https://your-service.onrender.com).
 */
export const config = {
  runtime: 'edge',
}

export default async function handler(request) {
  const backend = (process.env.RENDER_API_URL || process.env.BACKEND_URL || '').trim().replace(/\/$/, '')
  if (!backend) {
    return new Response(
      JSON.stringify({ error: 'RENDER_API_URL is not configured on Vercel.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const incoming = new URL(request.url)
  const target = `${backend}${incoming.pathname}${incoming.search}`

  const headers = new Headers(request.headers)
  headers.delete('host')

  let body
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    body = await request.arrayBuffer()
  }

  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: body?.byteLength ? body : undefined,
  })

  const outHeaders = new Headers(upstream.headers)
  outHeaders.set('Access-Control-Allow-Credentials', 'true')

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders,
  })
}
