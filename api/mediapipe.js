// GET /mediapipe/*  → proxy to the @mediapipe CDN on jsDelivr.
//
// WebGazer's bundled FaceMesh loads its WASM/model assets from root-relative
// paths like /mediapipe/face_mesh/face_mesh_solution_simd.wasm. The local dev
// server (local-server.mjs) proxies these; this serverless function is the
// production equivalent so eye tracking works on Vercel. Routed via vercel.json:
//   { "src": "/mediapipe/(.*)", "dest": "/api/mediapipe.js?path=$1" }
const CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe';

export default async function handler(req, res) {
  // path is supplied by the rewrite ($1). Fall back to parsing req.url just in case.
  let rel = req.query?.path;
  if (Array.isArray(rel)) rel = rel.join('/');
  if (!rel) {
    const m = (req.url || '').match(/[?&]path=([^&]+)/);
    rel = m ? decodeURIComponent(m[1]) : '';
  }
  rel = String(rel).replace(/^\/+/, '');
  if (!rel) return res.status(400).send('Missing asset path');

  try {
    const upstream = await fetch(`${CDN}/${rel}`);
    if (!upstream.ok) return res.status(upstream.status).send('Upstream asset not found');
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).send(buf);
  } catch (err) {
    return res.status(502).send(`Proxy error: ${err.message}`);
  }
}
