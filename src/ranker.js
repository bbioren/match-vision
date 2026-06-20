export const DEFAULT_WEIGHTS = {
  ball_location: 2.0,
  direction: 1.5,
  key_event: 2.0,
  concise: 0.8,
  hallucination_risk: -2.5
};

export function scoreCandidate(candidate, weights = DEFAULT_WEIGHTS) {
  const f = candidate.features || {};
  return Object.entries(weights).reduce((sum, [key, weight]) => sum + weight * Number(f[key] || 0), 0);
}

export function selectBestCandidate(candidates, weights = DEFAULT_WEIGHTS) {
  return [...candidates].sort((a, b) => scoreCandidate(b, weights) - scoreCandidate(a, weights))[0];
}
