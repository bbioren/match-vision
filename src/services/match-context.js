// Structured match context: deterministic team identity, half-aware direction, and
// interpretation of VLM visual cues into soccer-aware match state.

const KIT_COLOR_WORDS = [
  'blue', 'white', 'red', 'green', 'yellow', 'black', 'orange', 'pink', 'purple', 'grey', 'gray', 'gold', 'navy'
];

function normalizeKitColor(value) {
  return String(value || '').toLowerCase().trim();
}

function teamKitMeta(meta) {
  const outfield = normalizeKitColor(meta.outfield_kit || meta.kit_color);
  const goalkeeper = normalizeKitColor(meta.goalkeeper_kit);
  return {
    outfield_kit: outfield || 'unknown',
    goalkeeper_kit: goalkeeper || 'unknown',
    short_name: meta.short_name || meta.name || 'unknown'
  };
}

export function resolveContextAt(matchContext, atSecond = 0) {
  if (!matchContext?.teams || !matchContext?.halves?.length) return null;

  const second = Number(atSecond) || 0;
  const halfConfig = matchContext.halves.find((h) => {
    const from = h.from_second ?? 0;
    const until = h.until_second ?? Infinity;
    return second >= from && second <= until;
  }) || matchContext.halves[0];

  const teams = {};
  const teamByKit = {};
  const kitByTeam = {};
  const goalkeeperKits = {};
  const validOutfieldKits = [];

  for (const [name, rawMeta] of Object.entries(matchContext.teams)) {
    const meta = teamKitMeta(rawMeta);
    const halfTeam = halfConfig[name] || {};
    teams[name] = {
      outfield_kit: meta.outfield_kit,
      goalkeeper_kit: meta.goalkeeper_kit,
      kit_color: meta.outfield_kit,
      short_name: meta.short_name || name,
      attacking_direction: halfTeam.attacking_direction || 'unknown',
      defending_goal: halfTeam.defending_goal || 'unknown'
    };
    if (meta.outfield_kit && meta.outfield_kit !== 'unknown') {
      teamByKit[meta.outfield_kit] = name;
      kitByTeam[name] = meta.outfield_kit;
      if (!validOutfieldKits.includes(meta.outfield_kit)) validOutfieldKits.push(meta.outfield_kit);
    }
    if (meta.goalkeeper_kit && meta.goalkeeper_kit !== 'unknown') {
      goalkeeperKits[name] = meta.goalkeeper_kit;
    }
  }

  const leftDefender = findTeamByGoal(teams, 'left');
  const rightDefender = findTeamByGoal(teams, 'right');
  const leftAttacker = findTeamByAttackDirection(teams, 'left');
  const rightAttacker = findTeamByAttackDirection(teams, 'right');

  return {
    match_half: halfConfig.half ?? 1,
    period: halfConfig.half ?? 1,
    at_second: second,
    camera_view: matchContext.camera_view || 'broadcast',
    teams,
    team_by_kit: teamByKit,
    kit_by_team: kitByTeam,
    valid_outfield_kits: validOutfieldKits,
    goalkeeper_kits: goalkeeperKits,
    kit_reference: buildKitReference(teams, goalkeeperKits),
    field_reference: {
      left_goal: leftDefender ? `${leftDefender} defending goal` : 'left goal',
      right_goal: rightDefender ? `${rightDefender} defending goal` : 'right goal',
      left_third: leftDefender
        ? `${leftDefender} defensive third${leftAttacker ? ` (${leftAttacker} attacking)` : ''}`
        : 'left third',
      middle_third: 'middle third',
      right_third: rightDefender
        ? `${rightDefender} defensive third${rightAttacker ? ` (${rightAttacker} attacking)` : ''}`
        : 'right third'
    }
  };
}

function buildKitReference(teams, goalkeeperKits) {
  return Object.fromEntries(
    Object.entries(teams).map(([name, team]) => [
      name,
      {
        outfield_kit: team.outfield_kit,
        goalkeeper_kit: goalkeeperKits[name] || 'unknown',
        possession_identified_by: `${team.outfield_kit} outfield kit only`
      }
    ])
  );
}

function findTeamByGoal(teams, goal) {
  return Object.entries(teams).find(([, t]) => t.defending_goal === goal)?.[0] || null;
}

function findTeamByAttackDirection(teams, direction) {
  return Object.entries(teams).find(([, t]) => t.attacking_direction === direction)?.[0] || null;
}

function kitEnumForPrompt(resolved) {
  const kits = resolved.valid_outfield_kits.length
    ? resolved.valid_outfield_kits.map((k) => `"${k}"`).join(' | ')
    : '"unknown"';
  return `${kits} | "unknown"`;
}

function goalkeeperRulesForPrompt(resolved) {
  return Object.entries(resolved.kit_reference)
    .map(([name, ref]) => `- ${name}: outfield ${ref.outfield_kit}, goalkeeper ${ref.goalkeeper_kit}`)
    .join('\n');
}

export function sanitizeVlmOutput(vlm, resolved) {
  if (!resolved) return vlm;

  const allowedOutfield = new Set(resolved.valid_outfield_kits);
  const goalkeeperColors = new Set(
    Object.values(resolved.goalkeeper_kits || {}).map(normalizeKitColor).filter(Boolean)
  );
  let possessionKit = normalizeKitColor(vlm.possession_kit || vlm.possession);

  if (goalkeeperColors.has(possessionKit) || !allowedOutfield.has(possessionKit)) {
    possessionKit = 'unknown';
  }

  const sanitized = {
    ...vlm,
    possession_kit: possessionKit,
    visual_event: sanitizeKitText(vlm.visual_event || vlm.event || '', resolved),
    visual_summary: sanitizeKitText(vlm.visual_summary || vlm.summary || '', resolved)
  };

  if (vlm.possession_kit && vlm.possession_kit !== possessionKit) {
    sanitized.possession_kit_rejected = vlm.possession_kit;
  }

  return sanitized;
}

function sanitizeKitText(text, resolved) {
  if (!text) return text;
  let out = String(text);
  const allowedOutfield = new Set(resolved.valid_outfield_kits);
  const teamByKit = resolved.team_by_kit;

  for (const color of KIT_COLOR_WORDS) {
    const re = new RegExp(`\\b${color}\\b`, 'gi');
    if (!re.test(out)) continue;

    if (allowedOutfield.has(color)) {
      const team = teamByKit[color];
      out = out.replace(new RegExp(`\\b${color}\\b kits?`, 'gi'), team || `${color} kit`);
      continue;
    }

    // Disallowed outfield color (e.g. hallucinated red) → drop or neutralize.
    out = out
      .replace(new RegExp(`\\b${color}\\b kits?`, 'gi'), 'outfield players')
      .replace(new RegExp(`\\b${color}\\b`, 'gi'), '');
  }

  return out.replace(/\s{2,}/g, ' ').replace(/\s+([,.])/g, '$1').trim();
}

export function formatContextForPrompt(resolved) {
  if (!resolved) return '(no match context)';
  return JSON.stringify({
    match_half: resolved.match_half,
    camera_view: resolved.camera_view,
    teams: resolved.teams,
    kit_reference: resolved.kit_reference,
    valid_outfield_kits: resolved.valid_outfield_kits,
    goalkeeper_kits: resolved.goalkeeper_kits,
    field_reference: resolved.field_reference,
    team_by_kit: resolved.team_by_kit,
    instructions: [
      'Do NOT infer attacking direction from the image alone.',
      'Use this context as ground truth for team names, defending goals, and attacking direction.',
      'For possession_kit, ONLY use valid_outfield_kits listed above.',
      'Goalkeepers wear different colors — NEVER assign possession_kit from a goalkeeper jersey.',
      'If only a goalkeeper is near the ball, or kit color is unclear, use possession_kit "unknown".',
      'Do NOT use red or any color not listed in valid_outfield_kits.',
      'In visual_summary, prefer team names over kit colors when describing possession.'
    ]
  }, null, 2);
}

export function formatPriorMomentsForVision(priorMoments) {
  if (!priorMoments?.length) return '(none — first extraction at this point in the clip)';
  return priorMoments
    .map((m) => {
      const ts = m.timestamp || `${m.atSecond}s`;
      const parts = [m.summary || m.event || 'play continues'];
      if (m.team_in_possession && m.team_in_possession !== 'unknown') {
        parts.push(`possession: ${m.team_in_possession}`);
      }
      if (m.ball_zone && m.ball_zone !== 'unknown') parts.push(`zone: ${m.ball_zone}`);
      if (m.play_moving && m.play_moving !== 'unknown') parts.push(`moving: ${m.play_moving}`);
      return `- [${ts}] ${parts.join('; ')}`;
    })
    .join('\n');
}

export function buildVisionPrompt(resolved, options = {}) {
  const { priorMoments = [], frames = [] } = options;
  const kitEnum = kitEnumForPrompt(resolved);
  const oldestAgo = frames.length > 1 ? frames.length - 1 : 0;

  const temporalBlock = `
TEMPORAL CONTEXT:
${frames.length > 1
    ? `You receive ${frames.length} frames in chronological order, OLDEST FIRST, sampled ~1 second apart (every 30 frames at 30fps). They span the lead-up to now: the FIRST image is ~${oldestAgo}s in the PAST and each later image is ~1s more recent. The LAST image is the CURRENT moment and is the ONLY frame you describe in your output. The earlier (past) frames exist ONLY so you can judge how the play has moved across time (set play_moving and continuity) — do NOT describe them directly.`
    : ''}
${priorMoments.length ? `Recent interpreted memory from before these frames (continuity hint only — the CURRENT image overrides if they conflict):
${formatPriorMomentsForVision(priorMoments)}` : ''}`;

  return `You extract VISUAL soccer cues for a blind/low-vision accessibility assistant.
${temporalBlock}

MATCH CONTEXT (ground truth — do NOT infer attacking direction from the image):
${formatContextForPrompt(resolved)}

AUTHORIZED OUTFIELD KIT COLORS (possession_kit must be one of these or "unknown"):
${resolved.valid_outfield_kits.map((k) => `- "${k}" → ${resolved.team_by_kit[k]}`).join('\n')}

GOALKEEPER KITS (never use for possession_kit — goalies wear different colors):
${goalkeeperRulesForPrompt(resolved)}

Your job is PERCEPTION ONLY for the CURRENT (latest) frame. Report what you see using ONLY the authorized outfield kit colors above.
Do NOT assign team names from the image. Do NOT guess attacking direction from player position alone.
Do NOT say "red kit" or any color not listed in valid_outfield_kits — use "unknown" instead.
If the player on the ball appears to be a goalkeeper, possession_kit must be "unknown" unless an outfield player clearly has the ball.
Use earlier frames only to determine play_moving and whether action is building across the sequence.

Use screen-left / screen-right relative to the broadcast frame only.

Output JSON only (no markdown). Fields:
- possession_kit (${kitEnum}) — outfield kit with the ball in the CURRENT frame; NOT goalkeeper jersey color
- ball_screen_x ("left" | "center" | "right" | "unknown") — CURRENT frame
- ball_screen_zone ("near_left_goal" | "middle_third" | "near_right_goal" | "unknown") — CURRENT frame
- play_moving ("left" | "right" | "stationary" | "unknown") — inferred from the frame sequence
- visual_event (string — describe the action in the CURRENT frame; team names or authorized kit colors only)
- danger_level ("low" | "medium" | "high" | "unknown")
- visual_summary (one sentence for the CURRENT frame; team names or authorized kit colors only)

Use "unknown" when unclear. Do not invent player names or kit colors.`;
}

function interpretBallZone(ballScreenZone, resolved) {
  const zone = ballScreenZone || 'unknown';
  if (zone === 'middle_third') {
    return {
      ball_zone: resolved.field_reference.middle_third,
      in_attacking_third: false,
      attacking_team: null,
      defending_team: null
    };
  }
  if (zone === 'near_left_goal') {
    const defender = findTeamByGoal(resolved.teams, 'left');
    const attacker = findTeamByAttackDirection(resolved.teams, 'left');
    return {
      ball_zone: defender ? `${defender} defensive third` : 'near left goal',
      in_attacking_third: Boolean(attacker),
      attacking_team: attacker,
      defending_team: defender
    };
  }
  if (zone === 'near_right_goal') {
    const defender = findTeamByGoal(resolved.teams, 'right');
    const attacker = findTeamByAttackDirection(resolved.teams, 'right');
    return {
      ball_zone: defender ? `${defender} defensive third` : 'near right goal',
      in_attacking_third: Boolean(attacker),
      attacking_team: attacker,
      defending_team: defender
    };
  }
  return {
    ball_zone: 'unknown',
    in_attacking_third: false,
    attacking_team: null,
    defending_team: null
  };
}

function buildPhase(teamInPossession, zone) {
  if (teamInPossession === 'unknown') return 'unknown';
  if (zone.attacking_team && teamInPossession === zone.attacking_team && zone.in_attacking_third) {
    return `${zone.attacking_team} attacking`;
  }
  if (zone.defending_team && teamInPossession === zone.defending_team) {
    return `${zone.defending_team} defending`;
  }
  if (zone.attacking_team && teamInPossession === zone.attacking_team) {
    return `${zone.attacking_team} in possession`;
  }
  return `${teamInPossession} in possession`;
}

function buildSummary({ teamInPossession, zone, phase, visualEvent, resolved }) {
  if (teamInPossession === 'unknown' && zone.ball_zone === 'unknown') {
    return visualEvent || 'Play in progress.';
  }
  const parts = [];
  if (teamInPossession !== 'unknown') {
    parts.push(`${teamInPossession} have the ball`);
  }
  if (zone.ball_zone !== 'unknown') {
    parts.push(`in ${zone.ball_zone}`);
  }
  if (phase !== 'unknown' && !parts.join(' ').includes(phase)) {
    parts.push(`(${phase})`);
  }
  if (visualEvent && visualEvent !== 'unknown') {
    parts.push(`— ${visualEvent}`);
  }
  const teamNames = Object.keys(resolved.teams).join(' vs ');
  return parts.join(' ').trim() || `${teamNames}: ${visualEvent || 'play continues'}`;
}

// Merge VLM visual perception with deterministic match context → soccer-aware state.
export function interpretMoment(vlm, resolved) {
  if (!resolved) {
    return normalizeLegacyMoment(vlm);
  }

  const sanitized = sanitizeVlmOutput(vlm, resolved);
  const kit = sanitized.possession_kit || 'unknown';
  const teamInPossession = resolved.team_by_kit[kit] || 'unknown';
  const zone = interpretBallZone(sanitized.ball_screen_zone, resolved);
  const phase = buildPhase(teamInPossession, zone);
  const visualEvent = sanitized.visual_event || sanitized.event || 'unknown';

  const attackingDirection = teamInPossession !== 'unknown'
    ? resolved.teams[teamInPossession]?.attacking_direction
    : 'unknown';

  return {
    atSecond: vlm.atSecond,
    match_half: resolved.match_half,
    possession_kit: kit,
    team_in_possession: teamInPossession,
    ball_zone: zone.ball_zone,
    ball_location: zone.ball_zone,
    ball_screen_x: sanitized.ball_screen_x || 'unknown',
    ball_screen_zone: sanitized.ball_screen_zone || 'unknown',
    attacking_team: zone.attacking_team,
    defending_team: zone.defending_team,
    direction: teamInPossession !== 'unknown' && attackingDirection !== 'unknown'
      ? `${teamInPossession} attacking ${attackingDirection}`
      : 'unknown',
    phase,
    event: visualEvent,
    play_moving: sanitized.play_moving || 'unknown',
    danger_level: sanitized.danger_level || 'unknown',
    summary: buildSummary({ teamInPossession, zone, phase, visualEvent, resolved }),
    visual_summary: sanitized.visual_summary || '',
    possession_kit_rejected: sanitized.possession_kit_rejected || null,
    source: 'interpreted'
  };
}

function normalizeLegacyMoment(vlm) {
  return {
    atSecond: vlm.atSecond,
    team_in_possession: vlm.team_in_possession || 'unknown',
    direction: vlm.direction || 'unknown',
    ball_location: vlm.ball_location || 'unknown',
    ball_zone: vlm.ball_zone || vlm.ball_location || 'unknown',
    phase: vlm.phase || 'unknown',
    event: vlm.event || vlm.visual_event || 'unknown',
    danger_level: vlm.danger_level || 'unknown',
    summary: vlm.summary || vlm.visual_summary || '',
    source: vlm.source || 'live-vision'
  };
}

export function formatContextSummary(resolved) {
  if (!resolved) return '';
  const teamLines = Object.entries(resolved.kit_reference)
    .map(([name, ref]) => {
      const team = resolved.teams[name];
      return `${name} (outfield ${ref.outfield_kit}, GK ${ref.goalkeeper_kit}): attack ${team.attacking_direction}, defend ${team.defending_goal} goal`;
    })
    .join('; ');
  return `Half ${resolved.match_half} — ${teamLines}`;
}

export function formatKitRulesForNarration(resolved) {
  if (!resolved) return '';
  const lines = Object.entries(resolved.kit_reference)
    .map(([name, ref]) => `${name} wear ${ref.outfield_kit} outfield kits (goalkeeper wears ${ref.goalkeeper_kit})`);
  return `${lines.join('. ')}. Only these outfield kit colors are valid. Never describe a team as wearing red or any color not listed here. Refer to teams by name (Conquerors, State), not goalkeeper jersey color.`;
}
