// ADC (audio-descriptive commentary) and Q&A generation.
//
// Architecture: visual understanding is separated from commentary generation.
// Upstream produces structured match memory (JSON); this module turns that
// memory into accessible spoken language via a cloud LLM, with a deterministic
// local fallback so the demo always works without credentials.

import { formatMemory } from './match-memory.js';

const IMPROVED_SYSTEM = `You are MatchVision, a voice-first accessibility assistant for blind and low-vision soccer fans.
Use only the match memory provided. Do not invent players, positions, or events.
If something is unknown, say what is unknown and give the last known information.
Always include ball location and attacking direction when they are known.
Prioritize spatial clarity. Keep responses short enough to be spoken during live play.`;

const BASE_SYSTEM = `You are a soccer commentator. Briefly describe what is happening in one short sentence.`;

const MODE_GUIDANCE = {
  balanced: 'Answer in 2-3 short sentences.',
  brief: 'Answer in 1 short sentence.',
  tactical: 'Answer in 2-3 sentences, emphasizing spacing, shape, and the immediate danger.',
  beginner: 'Answer in 2-3 simple sentences, avoiding jargon and explaining why it matters.',
  emotional: 'Answer in 2-3 sentences that convey the tension of the moment while staying factual.'
};

function modeLine(mode) {
  return MODE_GUIDANCE[mode] || MODE_GUIDANCE.balanced;
}

export function buildAdcPrompt(memoryEntries, mode) {
  return `Current match memory:
${formatMemory(memoryEntries)}

Generate a concise, accessibility-first description of the current moment for someone who cannot see the match. ${modeLine(mode)}`;
}

export function buildQnaPrompt(question, memoryEntries, mode) {
  return `Current match memory:
${formatMemory(memoryEntries)}

User question: ${question}

${modeLine(mode)}`;
}

// Generic prompt from a single match state, used for the Terac base-vs-improved
// comparison (both variants receive the exact same structured state).
export function buildComparisonPrompt(moment) {
  return `Match state:
${formatMemory([moment])}

Describe this moment.`;
}

async function generate({ system, prompt, maxTokens = 200, fallback }) {
  if (!window.MATCHVISION_USE_LLM) return fallback();
  try {
    const response = await fetch('/api/describe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system, prompt, maxTokens })
    });
    if (!response.ok) throw new Error(`describe API ${response.status}`);
    const data = await response.json();
    if (!data.description) return fallback();
    return data.description;
  } catch (error) {
    console.warn('LLM adapter failed, using local fallback', error);
    return fallback();
  }
}

export async function generateAdc({ memoryEntries, mode, fallback }) {
  return generate({ system: IMPROVED_SYSTEM, prompt: buildAdcPrompt(memoryEntries, mode), fallback });
}

export async function generateQnaAnswer({ question, memoryEntries, mode, fallback }) {
  return generate({ system: IMPROVED_SYSTEM, prompt: buildQnaPrompt(question, memoryEntries, mode), fallback });
}

// Generate a single variant ("base" or "improved") for the Terac comparison.
export async function generateComparison({ moment, variant, fallback }) {
  const system = variant === 'base' ? BASE_SYSTEM : IMPROVED_SYSTEM;
  return generate({ system, prompt: buildComparisonPrompt(moment), maxTokens: 200, fallback });
}
