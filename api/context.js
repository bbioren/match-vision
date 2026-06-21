// GET /api/context – proxy terac_get_context so the browser can show balance
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const response = await fetch('https://terac.com/api/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'x-api-key': process.env.TERAC_API_KEY,
    },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'tools/call',
      params: { name: 'terac_get_context', arguments: {} },
    }),
  });

  const text = await response.text();
  // Parse SSE data line
  const match = text.match(/^data:\s*(.+)$/m);
  if (!match) return res.status(502).json({ error: 'Bad response from Terac' });
  const json = JSON.parse(match[1]);
  return res.status(200).json(json.result ?? json);
}
