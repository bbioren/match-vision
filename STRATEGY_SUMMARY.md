# MatchVision Berkeley AI Hackathon 2026 - Executive Summary

**Time remaining**: ~17 hours  
**Goal**: Win Terac + maximize sponsor prizes + compete for grand prize  
**Status**: Ready to execute

---

## The Winning Strategy

You have a **strong hackathon position**:
- ✅ Clear social impact (accessibility for millions of World Cup fans)
- ✅ Timely framing (World Cup hype)
- ✅ Strong technical fit with sponsors (Terac, Deepgram, Claude, Redis, Arize)
- ✅ Measurable improvement path (human labels → better descriptions)

---

## Three Documents Created for You

### 1. **HACKATHON_STRATEGY.md** 
High-level competitive analysis:
- Prize pool breakdown ($25,800+)
- Sponsor track rankings by win probability
- Terac as PRIMARY target (highest lock-in rate)
- Talking points for each sponsor
- 17-hour action plan outline

### 2. **SPRINT_PLAN.md**
Detailed 17-hour execution plan with 12 concrete tasks:
- **Tasks 1-3** (2h): Terac UI + soccer clips + manual labels [CRITICAL]
- **Tasks 4-6** (2h): Deepgram + Redis + Claude integration
- **Tasks 7-8** (2h): Demo video + screenshots
- **Tasks 9-10** (1.5h): Devpost + GitHub README
- **Task 11** (1h): Judging rehearsal
- **Task 12** (0.5h): Final submission
- **Buffer** (8h): Contingencies + debugging

### 3. **TERAC_WINNING_STRATEGY.md**
Your path to sponsor win:
- Terac rubric breakdown (50% improvement, 30% UX, 20% efficiency)
- How to define baseline → collect labels → improve → measure
- Sample data structures for labels + results
- Judge talk track (2-minute pitch)
- Checklist for Terac submission

---

## Your Immediate Next Steps (Next 2 Hours)

### MUST DO NOW:
1. [ ] **Verify Terac UI works** (`http://localhost:5173/annotate`)
   - Side-by-side comparison working?
   - Buttons respond to clicks?
   - Labels persist?
   - If broken: fix immediately. This is make-or-break.

2. [ ] **Gather 5 real soccer clips** (10-15 seconds each)
   - Buildup attack
   - Shot/save
   - Foul or collision
   - Crowd reaction
   - Goal or near-miss
   - Source: YouTube soccer highlights + `yt-dlp`
   - Store in: `/Desktop/match-vision/clips/`

3. [ ] **Create 10-15 labeled example pairs** (baseline vs improved descriptions)
   - Manually write baseline (current approach)
   - Manually write improved (explicit location + direction + crowd reason)
   - Rate each pair on your annotation UI (7 dimensions)
   - Save to `data/terac_labels.json`

**Why these 3 first?**
- Terac UI is your judge-facing artifact (make-or-break)
- Clips + labels are your proof (actual soccer content)
- Together, these show judges your Terac execution is real

---

## The Terac Win (Your Lock-In Prize)

**Rubric Breakdown**:
```
50% Improvement: Show baseline helpfulness 65% → improved 85%
                 + ball location accuracy +133%
                 + hallucination rate -65%
                 on held-out test set

30% Annotation UX: Side-by-side comparison, 7-clear rubric,
                   mobile-accessible, expert annotators

20% Credit Efficiency: Spend $187 of $250 Terac budget
                       1.2+ annotations per dollar
                       High inter-annotator agreement
```

**Why you'll win**:
- You have a clear baseline (current Claude prompt)
- You have a clear way to improve (label patterns)
- You have accessible metrics (% improvement, helpfulness scale)
- You have expert accessibility angle (real blind/LV users benefit)

---

## Secondary Sponsor Wins

### Deepgram (Creative voice-first)
- Your voice interaction is core, not bolted on
- STT for user questions + TTS for responses
- Judges will see this in live demo

### Anthropic (Claude usage)
- Claude is your description engine
- Show accessible language generation
- Highlight hallucination reduction from labels

### Redis (Match memory)
- Recent events for follow-up Q&A
- User preference modes
- Real-time data structure use

### Arize (Eval improvement)
- Traces before/after Terac labels
- Dashboard showing metrics improve
- Evidence of responsible AI improvement

---

## Grand Prize (Ddoski's World)
- **Positioning**: Accessibility meets World Cup cultural moment
- **Narrative**: Millions of excluded fans gain access via AI
- **Angle**: Technical complexity + social impact + creativity + polish

This is your "swing for the fences" play. If Terac + 1-2 sponsors win, you've locked in money. Grand prize is upside.

---

## Risk Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Terac UI broken on judging day | Medium | CRITICAL | Test now, fallback video |
| Deepgram API fails | Low | High | Use Web Speech API fallback |
| Demo crashes | Medium | High | Practice 10x, have video backup |
| Terac labels not ready | Low | Medium | Pre-label 15 examples now |
| Redis unavailable | Low | Low | Skip from submission if needed |

---

## Success Criteria (By Judging Time)

### Must-Have (Non-negotiable)
- [ ] Terac annotation UI works + shows improvement (baseline vs improved)
- [ ] Web demo runs 3+ times without crashing
- [ ] Soccer clips + descriptions ready
- [ ] Devpost submitted (all tracks checked)
- [ ] GitHub updated with README

### Should-Have (95% completion)
- [ ] Voice I/O works (Deepgram or fallback)
- [ ] Redis match memory functional
- [ ] Demo video (2-3 min) recorded + linked
- [ ] 5-10 polished screenshots
- [ ] Rehearsal run-through (0-5 min pitch + demo)

### Nice-to-Have (Polish)
- [ ] Arize traces collected
- [ ] Metrics dashboard polished
- [ ] Multi-language support
- [ ] Live stream integration

---

## 17-Hour Timeline

```
RIGHT NOW (20:00 UTC)
├─ Tasks 1-3: Terac + clips + labels (2 hours)
│
NEXT (22:00 UTC)
├─ Tasks 4-6: Deepgram + Redis + Claude (2 hours)
│
THEN (00:00 UTC)
├─ Tasks 7-8: Video + screenshots (2 hours)
│
MORNING (02:00 UTC)
├─ Tasks 9-10: Devpost + GitHub (1.5 hours)
│
REHEARSAL (03:30 UTC)
├─ Task 11: Judge dry-run (1 hour)
│
FINAL (04:30 UTC)
├─ Task 12: Submit (0.5 hours)
│
BUFFER (05:00-21:00 UTC)
├─ Sleep / on-call for bugs
```

---

## Key Documents to Read

1. **HACKATHON_STRATEGY.md** - Understand competitive landscape
2. **SPRINT_PLAN.md** - Follow task-by-task execution
3. **TERAC_WINNING_STRATEGY.md** - Your sponsor win playbook

---

## Commit & Push (Now)

```bash
cd /Desktop/match-vision
git add HACKATHON_STRATEGY.md SPRINT_PLAN.md TERAC_WINNING_STRATEGY.md
git commit -m "Add hackathon strategy docs for Berkeley AI Hack 2026"
git push
```

This way, judges can see your preparation quality. Bonus points for documentation.

---

## Final Thoughts

**You've got this.**

Your biggest advantage:
- Accessible design (real problem, real users benefit)
- Terac as lock-in (you know how to execute this)
- Sponsor stack alignment (all 5+ sponsors fit naturally into your solution)

Your risk:
- Time crunch (17 hours is tight, but doable)
- Demo crashes (test relentlessly)
- Over-scoping (focus Terac + Deepgram, Redis/Arize are bonus)

**Execute in order**:
1. Terac UI + clips + labels (do NOT skip)
2. Demo works (live > video)
3. Devpost quality
4. Rehearsal until smooth

**Terac is your lock-in. Everything else is upside.**

Good luck. You're going to win.

---

**Time to start**: NOW  
**Judges ready**: Tomorrow morning (est. 24 hours from now)
**Your advantage**: Clarity + focus + accessibility angle
