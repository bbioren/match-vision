# Devpost Draft

## Project name

MatchVision

## Elevator pitch

MatchVision is a voice-first accessibility companion that gives blind and low-vision soccer fans the missing visual layer of a match: ball location, player positioning, direction of attack, and why key moments matter. Built for the World Cup era, it uses Deepgram for voice interaction, Claude for accessible descriptions, Redis for match memory, Terac for human accessibility labels, and Arize-style evaluation to prove descriptions improve over a baseline.

## Problem

Soccer commentary assumes viewers can already see the field. Blind and low-vision fans often hear excitement without the spatial context needed to understand the play: where the ball is, who is open, which way the attack is moving, or why the crowd reacted. MatchVision adds that missing accessibility-grade visual layer.

## What it does

Users ask voice questions like:

- Where is the ball?
- What just happened?
- Why did the crowd react?
- Who has space?
- Give me tactical detail.

MatchVision responds with concise spoken descriptions designed for blind and low-vision fans.

## Sponsor usage

- Deepgram: voice-first input/output for accessible interaction.
- Anthropic: accessible match description generation and Q&A.
- Terac: human labels for baseline vs improved accessibility descriptions.
- Redis: real-time match memory and user preference modes.
- Arize: traces/evals for description quality, hallucination rate, and before/after improvement.

## Judging close

We are not replacing commentators. We are adding the missing visual layer, personalized and voice-first, for fans who have been excluded from the world's most visual sport.
