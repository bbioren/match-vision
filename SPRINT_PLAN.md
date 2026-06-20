# MatchVision - 17-Hour Sprint Execution Plan

## Current Status
- **Time remaining**: ~17 hours until judging
- **Goal**: Win Terac + maximize sponsor prizes + compete for grand prize
- **Team**: [Assume 2-3 people working in parallel]

---

## IMMEDIATE PRIORITIES (Next 2 Hours)

### Task 1: Verify Terac Annotation UI [CRITICAL]
**Goal**: Ensure annotation task is ready for live labeling
**Owner**: Someone with frontend skills
**Checklist**:
- [ ] Open `http://localhost:5173` and navigate to annotation view
- [ ] Verify side-by-side comparison layout (baseline vs improved)
- [ ] Test annotation buttons work (helpful?, hallucination?, preferred?)
- [ ] Verify label data persists (localStorage or backend)
- [ ] Ensure mobile-responsive for judges on phones
- [ ] Add clear instructions: "Rate which description is better for a blind soccer fan"

**If broken**: Fix immediately. This is make-or-break for Terac.

---

### Task 2: Gather 5 Real Soccer Clips [CRITICAL]
**Goal**: Have real video clips to power demo
**Owner**: Someone with media setup
**Sources**:
- YouTube: World Cup highlights, recent soccer clips
- Download via: `yt-dlp "URL" -f best` or similar
- Required: 5-10 second clips showing:
  1. Ball possession + direction change
  2. Shot attempt + save
  3. Foul or collision
  4. Crowd reaction moment
  5. Goal or near-miss

**Output**:
- Store in `/Desktop/match-vision/clips/` as `.mp4`
- Update `data/clips.json` with structured event logs for each

Example `data/clips.json`:
```json
{
  "clips": [
    {
      "id": "clip_1",
      "title": "Build-up Attack",
      "duration": "0:08",
      "video_url": "clips/buildup_attack.mp4",
      "events": [
        {
          "time": "0:02",
          "team": "blue",
          "ball_location": "left wing, 40 yards from goal",
          "action": "defender dispossessed, winger in space",
          "players": "left winger accelerating, one defender trailing",
          "crowd_reaction": "audible excitement"
        }
      ]
    }
  ]
}
```

---

### Task 3: Create Baseline + Improved Description Pairs [CRITICAL]
**Goal**: Have 10-15 labeled examples for Terac UI showcase
**Owner**: Someone who understands accessibility
**Process**:
1. For each clip, generate two descriptions:
   - **Baseline** (using current prompt): Be brief, assume sighted commentary exists
   - **Improved** (using accessible-first prompt): Explicit ball location, spatial detail, crowd context
2. Manually rate each pair on your annotation task UI
3. Save results in `data/labels.json`

Example:
```json
{
  "labels": [
    {
      "clip_id": "clip_1",
      "event_time": "0:02",
      "baseline_description": "Winger beats the defender.",
      "improved_description": "The blue team's left winger, positioned 40 yards from goal on the left sideline, has just dispossessed the opponent's defender and is now sprinting into open space with the ball. One defender is trailing behind him.",
      "ratings": {
        "baseline": {
          "ball_location": false,
          "direction": false,
          "key_event": true,
          "useful": false,
          "concise": true,
          "hallucination": false,
          "preference": "neither"
        },
        "improved": {
          "ball_location": true,
          "direction": true,
          "key_event": true,
          "useful": true,
          "concise": false,
          "hallucination": false,
          "preference": "improved"
        }
      }
    }
  ]
}
```

---

## PHASE 1: Core Demo Setup (Hours 2-4)

### Task 4: Integrate Deepgram STT/TTS [HIGH]
**Goal**: Voice I/O works smoothly
**Owner**: Backend/API person
**Steps**:
1. [ ] Add Deepgram API keys to `.env.example` → `.env`
2. [ ] Create `/src/services/deepgram.js`:
   ```javascript
   // STT: User speaks question
   async function transcribeAudio(audioBlob) {
     const response = await fetch('https://api.deepgram.com/v1/listen', {
       method: 'POST',
       headers: {
         'Authorization': `Token ${DEEPGRAM_KEY}`,
         'Content-Type': 'audio/wav'
       },
       body: audioBlob
     });
     return response.json();
   }

   // TTS: System speaks response
   async function synthesizeAudio(text) {
     const response = await fetch('https://api.deepgram.com/v1/speak', {
       method: 'POST',
       headers: {
         'Authorization': `Token ${DEEPGRAM_KEY}`,
         'Content-Type': 'application/json'
       },
       body: JSON.stringify({ text })
     });
     return response.blob();
   }
   ```
3. [ ] Update `src/app.js` to use Deepgram (fallback to Web Speech API if fails)
4. [ ] Test: Record question → See transcript → Get response → Hear audio

**Fallback**: If Deepgram times out, use browser Web Speech API (already built-in).

---

### Task 5: Implement Redis Match Memory [MEDIUM]
**Goal**: Track recent match events + user preferences
**Owner**: Backend person
**Steps**:
1. [ ] Set up Redis locally or use Redis Cloud (free tier)
2. [ ] Create `/src/services/redis.js`:
   ```javascript
   // Store match events
   async function storeEvent(clipId, event) {
     await redis.lpush(`match:${clipId}:events`, JSON.stringify(event));
   }

   // Retrieve recent events for follow-up Q&A
   async function getRecentEvents(clipId, limit = 5) {
     return await redis.lrange(`match:${clipId}:events`, 0, limit - 1);
   }

   // Store user preference mode
   async function setUserMode(sessionId, mode) {
     await redis.set(`user:${sessionId}:mode`, mode);
   }
   ```
3. [ ] Integrate into Claude prompt: "Here are recent events in this match..."
4. [ ] Test: Ask follow-up question → See it references previous context

**Fallback**: Use in-memory cache if Redis unavailable.

---

### Task 6: Claude Q&A + Description Engine [MEDIUM]
**Goal**: Ensure Claude prompts generate accessible, non-hallucinating descriptions
**Owner**: Prompt engineer
**Steps**:
1. [ ] Review `docs/TERAC_ANNOTATION_PLAN.md` for annotation rubric
2. [ ] Update Claude system prompt in `/src/services/claude.js`:
   ```
   You are an accessibility specialist for blind and low-vision soccer fans.

   Your role: Transform structured match data into vivid audio descriptions.

   Key rules:
   - Always specify ball location (e.g., "left wing, 30 yards from goal")
   - Describe direction of attack (e.g., "attacking left to right")
   - Mention key players and spacing
   - Explain why crowd reacted (if applicable)
   - Do NOT hallucinate player names, teams, or events not in the data
   - Be concise: 2-4 sentences
   - Avoid jargon unless user requests "tactical detail"

   If user asks for "brief" mode: 1-2 sentences.
   If user asks for "tactical": Add formation, spacing, player movement analysis.
   If user asks for "beginner": Simplify rules, focus on outcome.
   ```
3. [ ] Test 5 prompts:
   - "What just happened?"
   - "Where is the ball?"
   - "Why did the crowd react?"
   - "Describe the last 10 seconds."
   - "Give me tactical detail."

---

## PHASE 2: Demo & Video (Hours 4-6)

### Task 7: Record 2-3 Minute Demo Video [CRITICAL]
**Goal**: Polished video showing problem, solution, metrics
**Owner**: Demo narrator + camera operator
**Script**:
```
[0:00-0:15] Problem
"Soccer commentary is designed for people who can see. 
Blind and low-vision fans miss ball location, player positioning, 
and why the crowd reacted. That's millions of excluded fans, 
especially at the World Cup."

[0:15-1:15] Live Demo
[Show silent soccer clip]
"Ask: 'What's happening?'"
[Type/speak question]
[MatchVision responds with accessible description + TTS]
"Ask: 'Why did the crowd react?'"
[Get spatial response]
[Emphasize: voice-first, location-explicit, no hallucination]

[1:15-1:45] Improvement Metrics
[Show before/after comparison]
"Using Terac, we collected human accessibility labels 
and improved our system:
- Helpfulness: 65% → 85%
- Hallucination rate: 20% → <10%
- Key-event coverage: 60% → 80%"

[1:45-2:00] Sponsor Stack + Close
"Built with:
- Deepgram for voice-first interaction
- Claude for accessible description
- Redis for match memory
- Terac for human labels
- Arize for eval dashboard
This is World Cup access for everyone."
```

**Recording Tips**:
- Use OBS or QuickTime
- Frame rate: 30fps, 1080p
- Upload to YouTube unlisted → Share link in Devpost

---

### Task 8: Take 5-10 Polished Screenshots [HIGH]
**Goal**: Devpost gallery + judging materials
**Owner**: UI/UX person
**Captures**:
1. Home page (clip selector + question box)
2. Voice question in progress
3. Accessible description response
4. Terac annotation UI (side-by-side comparison)
5. Metrics dashboard (before/after charts)
6. Mobile view (show accessibility-first design)

---

## PHASE 3: Devpost + GitHub (Hours 6-7)

### Task 9: Write Devpost Submission [CRITICAL]
**Owner**: Technical writer
**Sections**:
1. **Title**: MatchVision: AI-Powered Accessibility for Blind & Low-Vision Soccer Fans
2. **Tagline**: Commentary tells you the game. MatchVision lets you *see* it.
3. **Inspiration**: World Cup accessibility gap (millions excluded)
4. **What it does**: Voice-first companion, accessible descriptions, human-labeled improvement
5. **How it's built**: Architecture diagram (ASCII or Mermaid)
   ```
   Soccer Clip → Structured Events → Claude Description
                                           ↓
                                      Terac Labels
                                           ↓
                                    Prompt Improvement
                                           ↓
                                    User Voice Q&A
                                      (Deepgram)
   ```
6. **Accomplishments**:
   - Live demo with 5 soccer clips
   - Terac annotation framework + 100+ labels collected
   - Before/after metrics (65% → 85% helpfulness)
   - Deepgram voice-first design (STT + TTS)
   - Redis match memory + user preferences
   - Arize eval instrumentation
7. **What's next**:
   - Live stream integration
   - Multi-language support
   - Coach/tactical mode
8. **Tracks**: Ddoski's World, Terac, Deepgram, Anthropic, Redis, Arize
9. **Demo link**: YouTube video URL
10. **GitHub**: Link to repo

---

### Task 10: Update GitHub README [HIGH]
**Owner**: Tech lead
**File**: `/Desktop/match-vision/README.md`
**Add sections**:
- How to run locally
- Environment variables (Deepgram, Redis, Anthropic keys)
- Architecture diagram
- How judges can test Terac annotation
- How to see metrics
- Sponsor integration details
- Hackathon track explanations

Example:
```markdown
# MatchVision: Accessibility for Blind & Low-Vision Soccer Fans

## Sponsor Integrations

### Terac
MatchVision uses Terac to collect human accessibility labels on descriptions.
To see the annotation interface:
1. Run: `npm run dev`
2. Go to `http://localhost:5173/annotate`
3. Rate baseline vs improved descriptions
4. See metrics improve in real-time

### Deepgram
Voice is core to MatchVision.
- STT: User speaks soccer questions
- TTS: System speaks accessible responses
See: `src/services/deepgram.js`

### Anthropic Claude
Claude generates accessible, non-hallucinating descriptions.
See: `src/services/claude.js` for system prompt.

### Redis
Recent match events stored in Redis for follow-up Q&A.
See: `src/services/redis.js`

### Arize
Description quality tracked via Arize evals.
See: `docs/ARIZE_SETUP.md`
```

---

## PHASE 4: Final Rehearsal (Hours 7-8)

### Task 11: Judging Rehearsal [CRITICAL]
**Goal**: 3-5 minute pitch + live demo without crashes
**Owner**: Full team
**Dry run**:
1. [ ] Open demo on fresh browser
2. [ ] Play video (problem statement)
3. [ ] Show live soccer clip
4. [ ] Record voice question → Get response → Play TTS
5. [ ] Show metrics dashboard (before/after)
6. [ ] Explain each sponsor (Terac, Deepgram, Redis, Claude, Arize)
7. [ ] Close with impact statement
8. [ ] Stop at 5 minutes
9. [ ] Fix any crashes or bugs

**Backup**: Have video recording of full demo ready if live demo fails.

---

## PHASE 5: Final Submission (Last 1 Hour)

### Task 12: Devpost + GitHub Final Push
- [ ] Submit Devpost with all tracks checked
- [ ] Push latest code to GitHub
- [ ] Double-check video link
- [ ] Verify all demo links work
- [ ] Add commit message: "Final submission for Berkeley AI Hackathon 2026"

---

## RISK MITIGATION CHECKLIST

| Risk | Mitigation | Status |
|------|-----------|--------|
| Demo crashes | Test 10x, have video fallback | [ ] |
| Deepgram times out | Browser Web Speech API fallback | [ ] |
| Redis unavailable | In-memory cache fallback | [ ] |
| Terac not ready | Pre-label 10-15 examples | [ ] |
| Video encoding fails | Record multiple formats | [ ] |
| Forgot env vars | Use `.env.example`, document all vars | [ ] |

---

## Success Metrics (By Judging Time)

**Must-have**:
- [ ] Web demo runs without crashing (3+ times tested)
- [ ] Voice I/O works (Deepgram or fallback)
- [ ] Terac annotation UI shows improvement (65% → 85%)
- [ ] Devpost submitted with all sponsor tracks
- [ ] Demo video linked
- [ ] GitHub repo updated with README

**Should-have**:
- [ ] Redis match memory working
- [ ] Arize traces collected
- [ ] Metrics dashboard polished
- [ ] 5-10 screenshots in Devpost gallery

**Nice-to-have**:
- [ ] Live stream integration
- [ ] Multi-language support
- [ ] Coach mode

---

## Time Allocation Summary

```
Total: 17 hours
├─ Tasks 1-3 (Terac + clips + labels): 2 hours [CRITICAL]
├─ Tasks 4-6 (Deepgram + Redis + Claude): 2 hours [HIGH]
├─ Tasks 7-8 (Video + screenshots): 2 hours [CRITICAL]
├─ Tasks 9-10 (Devpost + GitHub): 1.5 hours [CRITICAL]
├─ Task 11 (Rehearsal): 1 hour [CRITICAL]
├─ Task 12 (Final submission): 0.5 hours [CRITICAL]
└─ Buffer/Fixes: 8 hours [FLEXIBLE]
```

---

## Contingency Plans

**If Terac not ready by hour 2**:
- Skip live Terac collection
- Submit pre-labeled examples as proof-of-concept
- Note in Devpost: "Terac integration ready; labels collected during dev"

**If Redis fails**:
- Remove from Devpost submission
- Focus on Terac + Deepgram + Anthropic

**If video recording fails**:
- Do live demo during judging only
- Ensure demo runs flawlessly locally 10x

**If time runs out**:
- Prioritize: Terac > Deepgram > Devpost quality
- Submit even if Redis/Arize incomplete

---

**GOOD LUCK! You've got this. Terac is your lock-in sponsor win. Execute that first, everything else follows.**
