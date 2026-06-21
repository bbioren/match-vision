# MatchVision Hackathon-Winning Pitch

## One-line pitch

**MatchVision is the missing visual layer for blind and low-vision soccer fans: a voice-first AI companion that explains where the ball is, what just happened, who has space, and why the moment matters.**

## The winning frame

Do **not** pitch this as “AI sports commentary.” That sounds like a toy and invites comparison to ESPN commentators.

Pitch it as:

> **Accessibility infrastructure for live sports.**

Normal commentary assumes the viewer can already see. MatchVision serves the fan who cannot. It turns video and match context into short, spoken, accessibility-grade answers.

## 30-second opener

> Soccer is called the world’s game, but the broadcast is still built for people who can see. A commentator might yell, “What a chance,” while a blind fan is left missing the actual visual story: where the ball was, which direction the attack moved, who was open, and why the crowd reacted.
>
> **MatchVision adds that missing visual layer.** It is a voice-first companion for blind and low-vision soccer fans. Ask “what just happened,” “where is the ball,” or “who has space,” and MatchVision gives a concise spoken answer grounded in the current match moment.
>
> The key is that we are not just generating descriptions. We built a human-in-the-loop accessibility improvement loop: people rank which descriptions are most useful, and those labels tune the selector toward spatial clarity, key-event coverage, concision, and low hallucination.

## 90-second version

> Commentary exists, but it is not accessibility. It is optimized for sighted fans who can already see the field. Blind and low-vision fans often hear emotion without spatial context.
>
> MatchVision solves that with a voice-first experience. During a match, a fan can ask natural questions like “where is the ball,” “why did the crowd react,” “who has space,” or “give me tactical detail.” MatchVision responds in spoken language with the visual information a sighted fan would get from the screen: ball zone, possession, direction of attack, pressure, open space, and the key event.
>
> Technically, the system combines match memory, structured context, vision or event signals, LLM-generated descriptions, and a ranking layer tuned by human accessibility labels. We built an annotation workflow where labelers compare baseline commentary against accessibility-first candidates and judge them on ball location, direction, key-event coverage, hallucination risk, concision, and helpfulness.
>
> On our sample labels, the accessibility selector beats baseline 100% of the time, with 100% ball-location, direction, and key-event coverage, 0% hallucination, and 4.6 out of 5 average helpfulness.
>
> The bigger vision is accessibility infrastructure for every visual live event, starting with the world’s most watched sport.

## Demo script that should win judging

### 0:00-0:20 Hook

Say:

> I want you to listen to this like you cannot see the screen. Normal commentary tells you the emotion. MatchVision tells you the missing visual information.

### 0:20-1:15 Core demo

Show a soccer clip or moment.

Ask:

1. **What just happened?**
2. **Where is the ball?**
3. **Why did the crowd react?**

Say:

> Notice the difference: it does not say generic commentary like “great chance.” It gives the spatial facts: ball location, direction of attack, pressure, and why the moment mattered.

### 1:15-1:50 Personalization

Switch mode or ask:

- **Give me tactical detail.**
- **Explain it for a beginner.**
- **Keep it brief.**

Say:

> Accessibility is personal. Some fans want tactical detail. Some want a short live description. Some want beginner language. MatchVision lets the fan ask for the visual layer they need.

### 1:50-2:30 Human feedback loop

Open the annotation/ranking flow.

Say:

> The hard part is not generating more words. The hard part is knowing which words are actually useful to blind and low-vision fans. So we built a labeling loop where humans rank descriptions by accessibility quality. Those labels tune the selector toward spatial clarity, key-event coverage, concision, and lower hallucination.

Use current metrics:

> In our sample evaluation, the selected accessibility description beat baseline 100% of the time, with 100% ball-location, direction, and key-event coverage, 0% hallucination, and 4.6 out of 5 helpfulness.

### 2:30-3:00 Close

Say:

> MatchVision is not replacing commentators. It is adding an accessibility layer that should have existed already. We started with soccer because it is the world’s game, but the same infrastructure can make basketball, Formula 1, concerts, and live video accessible to anyone who cannot rely on the screen.

## Why this wins

### 1. Emotional clarity

The problem is instantly understandable: millions can hear the game but cannot access the visual field.

### 2. Not a toy

Many hackathon projects generate summaries. MatchVision has a real user, real constraints, and a quality loop.

### 3. Strong technical story

- Voice-first interaction
- Match memory
- Structured context grounding
- LLM/VLM descriptions
- Candidate ranking
- Human preference labels
- Evaluation metrics

### 4. Judge-friendly metrics

Use these current numbers:

- **100%** selected-description win rate vs baseline on sample labels
- **100%** ball-location coverage
- **100%** direction coverage
- **100%** key-event coverage
- **0%** hallucination rate
- **4.6 / 5** average helpfulness

Phrase carefully:

> “On our initial labeled sample...”

Do not imply production-scale clinical validation.

## Tagline options

Best:

> **The missing visual layer for live sports.**

Alternatives:

- **Making the world’s game accessible by voice.**
- **For fans who hear the roar but miss the play.**
- **Audio description, reimagined for live sports.**
- **Not commentary. Visual access.**

## Devpost elevator pitch

MatchVision is a voice-first accessibility companion for blind and low-vision soccer fans. Sports commentary assumes viewers can see the field, so it often skips the visual details that matter most: where the ball is, who is open, which direction the attack is moving, and why the crowd reacted. MatchVision adds that missing visual layer with concise spoken answers grounded in match context and recent memory.

Fans can ask natural questions like “what just happened?”, “where is the ball?”, “who has space?”, or “give me tactical detail.” Behind the scenes, MatchVision generates accessibility-first descriptions, ranks them using features like ball location, direction, key-event coverage, concision, and hallucination risk, and improves the selector through human preference labels.

On our initial labeled sample, the accessibility selector beat baseline commentary 100% of the time, with 100% ball-location, direction, and key-event coverage, 0% hallucination, and 4.6/5 average helpfulness.

We are not replacing commentators. We are building the missing accessibility layer for live sports.

## Sponsor / technology mapping

Use only the sponsors actually relevant to the hackathon, but frame them like this:

- **Deepgram:** voice-first input/output so blind and low-vision users do not need a visual UI.
- **LLM/VLM provider:** converts match state and visual cues into concise accessible language.
- **Redis / Upstash:** real-time match memory, recent moments, user preferences, and follow-up context.
- **Terac:** human preference labels that train/tune the accessibility description selector.
- **Arize/evals:** quality tracking for helpfulness, spatial coverage, key-event coverage, and hallucination.

## Judge Q&A answers

### Is this just commentary?

No. Commentary is written for sighted viewers and often skips what is visible on screen. MatchVision is an accessibility layer focused on explicit spatial context: ball location, possession, direction, pressure, open space, and why the moment matters.

### Why would someone use this if audio commentary already exists?

Because commentary often says “great chance” without explaining the visual sequence. A blind fan needs the field state, not just the emotion. MatchVision is queryable, personalized, and designed for spoken accessibility.

### What is technically hard?

The hard part is generating short, grounded descriptions that are useful during live play without hallucinating. We solve that with structured match memory, grounded context, candidate ranking, and human preference labels.

### What makes this more than a demo?

The feedback loop. We built an annotation workflow and metrics so the system can improve toward accessibility quality instead of just producing plausible text.

### Why soccer?

Soccer is global, visually complex, and culturally timely. But the infrastructure generalizes to any visual live event: basketball, racing, concerts, news, or streaming video.

## Final closing line

> Everyone deserves to share the moment when the stadium erupts. MatchVision makes sure blind and low-vision fans know not just that something happened, but what happened, where, and why it mattered.
