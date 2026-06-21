# MatchVision: Structured Match Memory, ADC Model, Q&A, and Terac Fine-Tuning Plan

## Overview

MatchVision is a voice-first accessibility companion for blind and low-vision soccer fans. The core product goal is to provide the visual context that normal commentary often leaves out:

- where the ball is
- which team is attacking
- which direction the team is attacking
- where attackers and defenders are positioned
- why a moment is dangerous or important
- what happened recently if the user missed something

A key design decision is to **separate visual understanding from audio-descriptive commentary generation**.

The system should not try to fine-tune one model that directly takes raw video and produces commentary. That is too broad for a hackathon and makes it hard to prove what improved.

Instead, use this split:

```text
Video / frames / scripted live events
        ↓
Qwen-VL or another vision model extracts structured match state JSON
        ↓
Rolling structured match memory stores recent events
        ↓
Base or fine-tuned ADC model generates accessible commentary from JSON
        ↓
Deepgram / browser speech tools handle voice input and spoken output
```

The important comparison for the Terac track is:

```text
Base commentary model + same structured JSON
        vs
Fine-tuned commentary model + same structured JSON
```

This isolates model improvement to the **audio-descriptive commentary generation model**, not the visual extraction model.

---

## Key Principle

### Qwen can generate the structured JSON

It is fine for Qwen-VL or another vision-language model to handle visual extraction:

```text
video/frame → structured match state JSON
```

Example:

```json
{
  "timestamp": "54:22",
  "possessingTeam": "Seattle",
  "attackingDirection": "left-to-right",
  "ballLocation": "right wing near the box",
  "eventType": "cross_attempt",
  "attackersInBox": 2,
  "defendersBetweenBallAndGoal": 4,
  "dangerLevel": "medium"
}
```

This extraction step is **not** the part being fine-tuned for the hackathon.

### Your model generates the ADC

Your fine-tuned ADC model takes the structured JSON and produces accessible commentary:

```text
structured match state JSON → audio-descriptive commentary
```

Example output:

```text
Seattle is attacking left to right. The ball is on the right wing near the box, with two attackers waiting centrally and four defenders between them and goal. This could become dangerous if the cross beats the first defender.
```

This is the part that Terac human feedback should improve.

---

## Why Not Just Ask Qwen to Generate ADC Directly?

A generic Qwen model can likely produce a decent audio description. However, a general-purpose model is not specifically optimized for blind and low-vision soccer fans.

A direct Qwen output may be:

```text
Seattle crosses the ball into the box.
```

This is accurate, but it misses important accessibility information:

- direction of attack
- exact ball location
- player positioning
- defensive shape
- why the play matters

The fine-tuned ADC model is meant to learn a consistent accessibility style:

- always mention direction of attack when known
- always mention ball location
- include player positioning when relevant
- explain danger or importance in one sentence
- avoid unsupported visual claims
- say "unknown" if information is not in the structured memory
- keep responses short enough for live audio

The goal is not to build a better vision model than Qwen. The goal is to build a **human-feedback-trained accessibility layer** on top of generic video understanding.

---

## Clean Baseline Comparison

For the Terac judging criteria, the cleanest comparison is:

```text
Base Qwen text model
        vs
Fine-tuned Qwen text model
```

Both models receive the exact same structured match state JSON.

### Baseline Input

```json
{
  "timestamp": "54:22",
  "score": "1-1",
  "possessingTeam": "Seattle",
  "attackingDirection": "left-to-right",
  "ballLocation": {
    "zone": "right wing",
    "third": "attacking third",
    "near": "edge of penalty box"
  },
  "eventType": "cross_attempt",
  "players": {
    "attackersInBox": 2,
    "defendersBetweenBallAndGoal": 4
  },
  "dangerLevel": "medium"
}
```

### Base Model Output

```text
Seattle crosses the ball into the box.
```

### Fine-Tuned Model Output

```text
Seattle is attacking left to right. The ball is on the right wing near the edge of the box, with two attackers waiting centrally and four defenders between them and goal. This could become dangerous if the cross beats the first defender.
```

### Terac Evaluation Question

Ask annotators:

```text
Given the match state, which description is more useful for someone who cannot see the match?
```

Then compare how often annotators prefer the fine-tuned model.

Example result:

```text
Fine-tuned model preferred: 73%
Spatial clarity: 2.3 → 4.4
Direction clarity: 1.9 → 4.6
Usefulness: 2.8 → 4.2
Unsupported details: 15% → 6%
```

---

## What Not to Compare as the Main Result

Avoid making this your main comparison:

```text
Raw video → Qwen direct ADC
        vs
Structured JSON → fine-tuned ADC model
```

This mixes two variables:

1. visual understanding
2. commentary generation

If your system wins, judges may ask:

```text
Did the fine-tuning improve the model, or did the structured JSON simply make the task easier?
```

You can still show this as a product demo, but for the Terac model-improvement criterion, use the cleaner comparison:

```text
Base model from same JSON
        vs
Fine-tuned model from same JSON
```

---

## Structured Match Memory

Structured match memory is a rolling timeline of recent match states.

Do not store the entire video inside the Q&A model. Store compact structured events.

### Example Match Memory

```json
[
  {
    "timestamp": "54:02",
    "eventType": "turnover",
    "possessingTeam": "Seattle",
    "attackingDirection": "left-to-right",
    "ballLocation": {
      "zone": "center",
      "third": "middle third"
    },
    "summary": "Seattle wins the ball near midfield."
  },
  {
    "timestamp": "54:12",
    "eventType": "dribble",
    "possessingTeam": "Seattle",
    "attackingDirection": "left-to-right",
    "ballLocation": {
      "zone": "right wing",
      "third": "attacking third"
    },
    "summary": "Seattle carries the ball down the right wing."
  },
  {
    "timestamp": "54:22",
    "eventType": "cross_attempt",
    "possessingTeam": "Seattle",
    "attackingDirection": "left-to-right",
    "ballLocation": {
      "zone": "right wing",
      "third": "attacking third",
      "near": "edge of penalty box"
    },
    "players": {
      "attackersInBox": 2,
      "defendersBetweenBallAndGoal": 4
    },
    "dangerLevel": "medium",
    "summary": "Seattle prepares a cross from the right wing."
  }
]
```

This memory supports questions like:

- Where is the ball?
- Who is attacking?
- Which direction are they attacking?
- Why is this dangerous?
- What did I miss?
- Where are the defenders?
- What happened recently?

---

## Suggested Match Moment Schema

Use a small, consistent schema.

```ts
type MatchMoment = {
  id: string;
  timestamp: string;
  score?: string;

  possessingTeam: string | "unknown";
  attackingDirection: "left-to-right" | "right-to-left" | "unknown";

  ballLocation: {
    zone:
      | "left wing"
      | "right wing"
      | "center"
      | "box"
      | "midfield"
      | "defensive third"
      | "unknown";
    third:
      | "defensive third"
      | "middle third"
      | "attacking third"
      | "unknown";
    near?: string;
  };

  eventType:
    | "pass"
    | "dribble"
    | "shot"
    | "cross_attempt"
    | "turnover"
    | "save"
    | "foul"
    | "corner"
    | "free_kick"
    | "goal"
    | "unknown";

  players?: {
    attackersAhead?: number;
    attackersInBox?: number;
    defendersBetweenBallAndGoal?: number;
    goalkeeperPosition?: string;
  };

  dangerLevel: "low" | "medium" | "high" | "unknown";

  summary: string;
  uncertainty?: string;
};
```

---

## Extracting Structured Match Memory

There are three possible extraction levels.

### Level 1: Manual or Scripted Events

This is the safest hackathon MVP.

Create a timestamped event stream by hand:

```json
[
  {
    "atSecond": 0,
    "timestamp": "54:02",
    "summary": "Seattle wins the ball near midfield.",
    "ballLocation": {
      "zone": "center",
      "third": "middle third"
    }
  },
  {
    "atSecond": 6,
    "timestamp": "54:08",
    "summary": "Seattle moves the ball to the right wing.",
    "ballLocation": {
      "zone": "right wing",
      "third": "attacking third"
    }
  },
  {
    "atSecond": 18,
    "timestamp": "54:22",
    "eventType": "cross_attempt",
    "summary": "Seattle attempts a cross.",
    "dangerLevel": "medium"
  }
]
```

As the demo video plays, update the memory according to `atSecond`.

This feels live to the judge while remaining reliable.

### Level 2: Vision-Assisted Extraction

Use Qwen-VL, Gemini, Claude vision, or another VLM:

```text
video clip
  → sample frames every 1–3 seconds
  → send frames to vision model
  → ask for JSON
  → validate output
  → store in rolling memory
```

Prompt:

```text
You are extracting soccer match state for an accessibility assistant.

Given these frames, output JSON only.

Fields:
- possessingTeam, if visible
- attackingDirection, if inferable
- ballLocation.zone
- ballLocation.third
- eventType
- playerPositioning
- dangerLevel
- uncertainty

Do not invent details. Use "unknown" if unclear.
```

Expected output:

```json
{
  "possessingTeam": "unknown",
  "attackingDirection": "left-to-right",
  "ballLocation": {
    "zone": "right wing",
    "third": "attacking third"
  },
  "eventType": "cross_attempt",
  "players": {
    "attackersInBox": 2,
    "defendersBetweenBallAndGoal": 4
  },
  "dangerLevel": "medium",
  "uncertainty": "Team identity is unclear from the frame."
}
```

### Level 3: Production Computer Vision Pipeline

A production version might use:

```text
video frames
  → detect field lines / goals
  → detect players / ball
  → track objects over time
  → infer possession and field zones
  → detect events
  → update match memory
```

This is not realistic to build fully in 24 hours.

---

## Live Demo Strategy

A truly live broadcast-to-memory system is difficult. The recommended hackathon demo is:

```text
pre-recorded soccer clip
        +
timestamped structured event stream
        +
live Q&A and TTS
```

This means the user can ask questions live while the clip is playing, and the app answers based on the current memory state.

### Live Flow

```text
Video plays
    ↓
Memory updates every few seconds
    ↓
User asks a voice question
    ↓
Speech-to-text transcribes question
    ↓
System retrieves latest match memory
    ↓
Fine-tuned ADC/Q&A model answers
    ↓
Text-to-speech speaks answer
```

### Honest Framing

Say:

```text
For the hackathon, we simulate live structured match extraction using a timestamped event stream. The Q&A and commentary generation are live: as the match memory updates, users can ask questions and receive spoken answers. In production, the structured memory would be produced by a video understanding model or tracking pipeline.
```

---

## Q&A System

The Q&A system should not ask the model to watch the whole video. It should ask the model to answer using structured memory.

### Q&A Prompt

```text
You are MatchVision, a voice-first accessibility assistant for blind and low-vision soccer fans.

Use only the match memory below.
Do not invent players, positions, or events.
If the answer is unknown, say what is unknown and give the last known information.
Answer in 1–2 short spoken sentences.
Prioritize spatial clarity.

Current match memory:
{{RECENT_MEMORY}}

User question:
{{QUESTION}}
```

### Example

Memory:

```json
{
  "timestamp": "54:22",
  "possessingTeam": "Seattle",
  "attackingDirection": "left-to-right",
  "ballLocation": {
    "zone": "right wing",
    "third": "attacking third",
    "near": "edge of penalty box"
  },
  "players": {
    "attackersInBox": 2,
    "defendersBetweenBallAndGoal": 4
  },
  "dangerLevel": "medium",
  "eventType": "cross_attempt"
}
```

Question:

```text
Why is this dangerous?
```

Answer:

```text
It is dangerous because Seattle has two attackers in the box, and the cross could reach them if it beats the first defender.
```

---

## Supported Q&A Intents

For the MVP, support a small number of question types.

```text
ball_location
attack_direction
possession
danger_explanation
recent_recap
player_positioning
score_time
unknown
```

Examples:

### Ball Location

Question:

```text
Where is the ball?
```

Answer:

```text
The ball is on Seattle's right wing, near the edge of the penalty box. Seattle is attacking left to right.
```

### Danger Explanation

Question:

```text
Why is this dangerous?
```

Answer:

```text
This is dangerous because two Seattle attackers are waiting centrally, and a cross from the right wing could reach them near goal.
```

### Recent Recap

Question:

```text
What did I miss?
```

Answer:

```text
Seattle won the ball near midfield, moved it down the right wing, and is now preparing a cross near the edge of the box.
```

---

## Terac Annotation Plan

Terac should be used to collect human feedback on commentary quality.

### Annotation Task

Show annotators:

1. the structured match state
2. two or three candidate descriptions
3. a question asking which description is more useful for someone who cannot see the match
4. rubric ratings

### Example Task

```text
Help us choose the better description for someone who cannot see the soccer match.

Match State:
- Seattle attacking left to right
- Ball on right wing, attacking third
- Cross attempt
- 2 attackers in the box
- 4 defenders between ball and goal

Option A:
The player crosses the ball into the box.

Option B:
Seattle is attacking left to right. The ball is on the right wing near the box, with two attackers waiting centrally and four defenders between them and goal.

Which is better?
```

### Rubric

```text
Spatial clarity: 1–5
Direction clarity: 1–5
Conciseness: 1–5
Accuracy: 1–5
Usefulness: 1–5
```

Optional free response:

```text
Why did you choose this answer?
```

---

## Fine-Tuning Data Format

### Supervised Fine-Tuning Format

Use the Terac-preferred answer as the target.

```json
{
  "messages": [
    {
      "role": "system",
      "content": "You generate concise accessibility-first soccer commentary from structured match state."
    },
    {
      "role": "user",
      "content": "Match state: Seattle attacking left-to-right, ball on right wing near the box, cross attempt, two attackers in the box, four defenders between ball and goal."
    },
    {
      "role": "assistant",
      "content": "Seattle is attacking left to right. The ball is on the right wing near the box, with two attackers waiting centrally and four defenders between them and goal. This could become dangerous if the cross beats the first defender."
    }
  ]
}
```

### Preference Format

If doing DPO or a ranker later:

```json
{
  "prompt": "Generate accessible commentary for this match state: Seattle attacking left-to-right, ball on right wing near the box...",
  "chosen": "Seattle is attacking left to right. The ball is on the right wing near the box...",
  "rejected": "The player crosses the ball into the box.",
  "reason": "The chosen answer gives direction, ball location, and player positioning."
}
```

---

## Recommended Model Strategy

### For the Hackathon

Use:

```text
Base model:
Qwen2.5-0.5B-Instruct, Qwen2.5-1.5B-Instruct, TinyLlama, or similar small model

Fine-tuning:
LoRA supervised fine-tuning on Terac-preferred examples

Input:
structured match state JSON

Output:
accessible commentary
```

The goal is to show measurable improvement over the base version of the same model.

### Do Not Claim

Avoid claiming:

```text
We fine-tuned a model to understand soccer video.
```

Instead say:

```text
We fine-tuned a model to convert structured soccer match state into accessibility-first commentary.
```

This is more honest and easier to prove.

---

## Optional: Fine-Tuned Ranker Instead of Generator

If generation fine-tuning is too difficult, train a ranker.

Pipeline:

```text
Qwen generates 2–3 candidate descriptions
        ↓
Fine-tuned ranker predicts which one Terac users would prefer
        ↓
System selects the best candidate
```

This still uses human data and trains a model.

Ranker input:

```json
{
  "match_state": "...",
  "candidate_a": "The player crosses the ball into the box.",
  "candidate_b": "Seattle is attacking left to right..."
}
```

Ranker output:

```json
{
  "preferred": "candidate_b"
}
```

This is easier than training a generator from scratch and can still show improvement.

---

## Frontend Pages

The demo frontend should have two layers:

1. user-facing MatchVision app
2. Terac/model improvement lab

### Page 1: Live Fan Demo

Show:

- current match time
- score
- current memory state
- play/pause/replay buttons
- voice question button
- text transcript
- quick questions

Example:

```text
MatchVision
Seattle vs Portland — 54:22 — 1–1

Current visual context:
Seattle attacking left to right.
Ball: right wing, attacking third.
Event: cross attempt.
Danger: medium.

[Play current description]
[Ask a question]
[Replay]
[Stop speech]

Quick questions:
[Where is the ball?]
[Why is this dangerous?]
[What did I miss?]
```

### Page 2: Annotation Task

Show the task that Terac annotators complete.

```text
Which description is better for someone who cannot see the match?

Match State:
Seattle attacking left to right.
Ball on right wing near the box.
Two attackers in the box.
Four defenders between ball and goal.

Option A:
Seattle crosses the ball.

Option B:
Seattle is attacking left to right. The ball is on the right wing near the box...

[Choose A]
[Choose B]
```

### Page 3: Before / After Model Comparison

Show:

```text
Base model output
vs
Fine-tuned model output

Terac reviewers preferred fine-tuned output: 73%
```

### Page 4: Metrics Dashboard

Show:

```text
Spatial clarity: 2.3 → 4.4
Direction clarity: 1.9 → 4.6
Usefulness: 2.8 → 4.2
Unsupported details: 15% → 6%
```

---

## Accessibility Requirements for the User-Facing UI

The fan-facing UI should be usable without sight.

Minimum features:

- keyboard shortcuts
- screen-reader labels
- high contrast mode
- large text mode
- replay last answer
- stop speech
- text transcript
- ARIA live region for new commentary
- no tiny unlabeled icon buttons

Suggested keyboard shortcuts:

```text
Space: play / pause commentary
R: replay last answer
A: ask a question
N: next moment
H: help
1: quick mode
2: spatial mode
3: tactical mode
Esc: stop speaking
```

The app should announce controls on load:

```text
MatchVision loaded. Press Space to hear the current match moment. Press A to ask a question. Press R to replay. Press H for help.
```

---

## What To Say in the Pitch

Use this framing:

```text
A general model can generate audio descriptions, but it is not optimized for blind soccer fans. Our baseline is a generic open-source model prompted to describe a match state. We use Terac feedback to fine-tune the model toward accessibility-specific preferences: spatial clarity, direction of attack, conciseness, factual grounding, and usefulness. The result is not a better vision model; it is a better accessibility commentary model.
```

Also say:

```text
For the MVP, Qwen-VL or a timestamped event stream produces structured match memory. Our fine-tuned model turns that memory into accessible commentary and answers user questions. This lets us show a clean before-and-after improvement from Terac human feedback.
```

---

## Final Recommended Architecture

```text
Pre-recorded or live soccer clip
        ↓
Qwen-VL or scripted event stream extracts match state JSON
        ↓
Redis stores rolling structured match memory
        ↓
User asks a question through voice
        ↓
Speech-to-text transcribes question
        ↓
System retrieves latest match memory
        ↓
Fine-tuned ADC/Q&A model answers from JSON
        ↓
Text-to-speech speaks answer
```

For Terac evaluation:

```text
Held-out structured match states
        ↓
Base model generates descriptions
        ↓
Fine-tuned model generates descriptions
        ↓
Terac annotators compare outputs
        ↓
Report win rate and rubric score improvement
```

---

## Final Honest Claim

The strongest honest claim is:

```text
MatchVision does not try to solve all of live soccer video understanding in 24 hours. Instead, it focuses on the accessibility layer: converting structured match state into concise, spatially clear, blind-user-oriented commentary. We use Terac human feedback to make that commentary model measurably better than its base version.
```
