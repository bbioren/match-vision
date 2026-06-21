// Structured match memory: a rolling timeline of recent match states.
// ADC generation and Q&A both read from this, never from raw video.

// Returns the clip's authored timeline, or a single-moment timeline synthesized
// from the flat snapshot fields when no timeline is present.
export function getTimeline(log) {
  if (Array.isArray(log?.timeline) && log.timeline.length) return log.timeline;
  return [{
    atSecond: 0,
    timestamp: log?.time || '00:00',
    team_in_possession: log?.team_in_possession,
    direction: log?.direction,
    ball_location: log?.ball_location,
    event: log?.event,
    danger_level: log?.danger_level || 'unknown',
    summary: log?.improved_description || log?.event || ''
  }];
}

// The latest moment at or before `seconds` (the current visual context).
export function currentMoment(timeline, seconds) {
  if (!timeline?.length) return null;
  let moment = timeline[0];
  for (const entry of timeline) {
    if (entry.atSecond <= seconds) moment = entry;
    else break;
  }
  return moment;
}

// A rolling window of recent moments near `seconds`, oldest first.
export function memoryAt(timeline, seconds, windowSize = 4, windowSeconds = 16) {
  if (!timeline?.length) return [];
  const minSecond = Math.max(0, seconds - windowSeconds);
  const seen = timeline.filter((entry) => entry.atSecond <= seconds && entry.atSecond >= minSecond);
  const window = seen.length ? seen : timeline.filter((entry) => entry.atSecond <= seconds).slice(-1);
  return window.filter(Boolean).slice(-windowSize);
}

// Compact text form of the memory for an LLM prompt.
export function formatMemory(entries) {
  const valid = (entries || []).filter(Boolean);
  if (!valid.length) return '(no match memory yet)';
  return valid
    .map((m) => {
      const parts = [];
      if (m.timestamp) parts.push(`[${m.timestamp}]`);
      if (m.summary) parts.push(m.summary);
      const detail = [];
      if (m.ball_location) detail.push(`ball: ${m.ball_location}`);
      if (m.direction) detail.push(`direction: ${m.direction}`);
      if (m.danger_level && m.danger_level !== 'unknown') detail.push(`danger: ${m.danger_level}`);
      if (detail.length) parts.push(`(${detail.join('; ')})`);
      return `- ${parts.join(' ')}`;
    })
    .join('\n');
}
