export function buildDescriptionPrompt(log, question, mode) {
  return `You are MatchVision, an accessibility-grade soccer visual description assistant for blind and low-vision fans.

Goal: answer the user's question with concise spoken language. Include spatial context a sighted viewer would see: ball location, direction of attack, player spacing, key event, and why the moment matters. Avoid unsupported claims.

Mode: ${mode}
Question: ${question}
Match state:
- Team in possession: ${log.team_in_possession}
- Direction: ${log.direction}
- Ball location: ${log.ball_location}
- Event: ${log.event}
- Players: ${log.players}
- Crowd/context: ${log.crowd_reason}`;
}

export async function generateAccessibleDescription({ log, question, mode, fallback }) {
  // Hackathon-safe default: deterministic local generation.
  // Production/credential path: replace this with an API call to Claude using buildDescriptionPrompt().
  if (!window.MATCHVISION_USE_CLAUDE) return fallback();

  try {
    const response = await fetch('/api/describe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: buildDescriptionPrompt(log, question, mode), log, question, mode })
    });
    if (!response.ok) throw new Error(`describe API ${response.status}`);
    const data = await response.json();
    return data.description || fallback();
  } catch (error) {
    console.warn('Claude adapter failed, using local fallback', error);
    return fallback();
  }
}
