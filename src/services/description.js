// ADC (audio-descriptive commentary) and Q&A generation.
//
// Pipeline: VLM visual cues + structured match context → interpreted memory → narration.

import { formatMemory } from './match-memory.js';
import { formatContextForPrompt, formatKitRulesForNarration } from './match-context.js';

const IMPROVED_SYSTEM = `You are MatchVision, a voice-first accessibility assistant for blind and low-vision soccer fans.

You receive structured match memory that already combines visual perception with half-aware team context.
Use only the match memory and match context provided. Do not invent players, positions, or events.
Do NOT infer attacking direction from visual descriptions alone — use ball_zone, phase, and possession fields.
Always use labeled team names (Conquerors, State), not kit colors, when speaking to the fan.
Never mention "red kit" or any kit color not listed in the match kit rules.
Goalkeepers wear different colors than outfield players — never assign possession based on a goalkeeper jersey.
If possession is unknown in memory, say so rather than guessing a team or color.
If something is unknown, say what is unknown and give the last known information.
Always include ball zone and which team has possession when known.
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

function contextBlock(matchContext) {
  if (!matchContext) return '';
  return `\nMatch context (ground truth for team direction and field reference):\n${formatContextForPrompt(matchContext)}

Kit rules (authoritative — do not contradict):
${formatKitRulesForNarration(matchContext)}\n`;
}

export function buildAdcPrompt(memoryEntries, mode, matchContext) {
  return `${contextBlock(matchContext)}Current match memory:
${formatMemory(memoryEntries)}

Generate a concise, accessibility-first description of the current moment for someone who cannot see the match.
Use team names and ball zones from memory (e.g. "State have the ball in Conquerors' defensive third").
${modeLine(mode)}`;
}

export function buildQnaPrompt(question, memoryEntries, mode, matchContext) {
  return `${contextBlock(matchContext)}Current match memory:
${formatMemory(memoryEntries)}

User question: ${question}

${modeLine(mode)}`;
}

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

export async function generateAdc({ memoryEntries, mode, matchContext, fallback }) {
  return generate({
    system: IMPROVED_SYSTEM,
    prompt: buildAdcPrompt(memoryEntries, mode, matchContext),
    fallback
  });
}

export async function generateQnaAnswer({ question, memoryEntries, mode, matchContext, fallback }) {
  return generate({
    system: IMPROVED_SYSTEM,
    prompt: buildQnaPrompt(question, memoryEntries, mode, matchContext),
    fallback
  });
}

export async function generateComparison({ moment, variant, fallback }) {
  const system = variant === 'base' ? BASE_SYSTEM : IMPROVED_SYSTEM;
  return generate({ system, prompt: buildComparisonPrompt(moment), maxTokens: 200, fallback });
}
