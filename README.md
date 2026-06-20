# MatchVision

**Commentary tells you the game. MatchVision lets you see it.**

MatchVision is a voice-first accessibility companion that gives blind and low-vision soccer fans the missing visual layer of a match: ball location, player positioning, direction of attack, and why key moments matter.

Built for the World Cup era, it uses:

- **Deepgram** for voice input and spoken audio descriptions
- **Claude / Anthropic** for accessible match descriptions and Q&A
- **Terac** for human accessibility labels and before/after improvement
- **Redis** for match memory and user preference modes
- **Arize** for evaluation traces and quality metrics

## Hackathon goal

Target **Ddoski's World** and sponsor tracks including **Terac**, **Deepgram**, **Anthropic**, **Redis**, and **Arize**.

## Problem

Existing soccer commentary assumes the viewer can already see the field. Blind and low-vision fans often miss spatial context: where the ball is, which team is attacking, why the crowd reacted, who is open, and what changed in the last few seconds.

MatchVision adds the missing accessibility-grade visual description layer.

## MVP

- 3-5 preselected soccer clips
- structured event logs for each clip
- voice question input
- spoken answers
- accessible descriptions generated from match state
- Terac labeling flow comparing baseline vs improved descriptions
- before/after quality metrics

## Repository status

This repo was initialized during the UC Berkeley AI Hackathon sprint. See [`SCOPE.md`](./SCOPE.md) for the full project plan and sponsor strategy.
