# MatchVision Hackathon Strategy - Document Index

## 📚 Complete Strategy Package for Berkeley AI Hackathon 2026

All documents are in `/Desktop/match-vision/` directory.

---

## 📖 READ IN THIS ORDER

### 1. **QUICK_START.md** (5 min)
**Purpose**: Get oriented immediately  
**Contains**:
- 30-second plan overview
- Immediate 60-minute checklist
- Sponsor win paths ranked
- Success metrics (must/should/nice-to-have)
- Quick risks & mitigations
- Timeline at a glance

**When**: Read THIS FIRST, right now

---

### 2. **STRATEGY_SUMMARY.md** (10 min)
**Purpose**: Executive overview of your entire winning strategy  
**Contains**:
- Your competitive advantages
- Three-document summary
- Terac win path (your lock-in)
- Secondary sponsor targets
- Grand prize positioning
- 17-hour timeline overview
- Key success factors

**When**: Read after QUICK_START

---

### 3. **HACKATHON_STRATEGY.md** (20 min)
**Purpose**: Deep competitive analysis  
**Contains**:
- Prize pool breakdown ($25,800+)
- All sponsor tracks ranked by win probability:
  - **Terac** (PRIMARY - your best path)
  - **Deepgram** (SECONDARY - creative voice)
  - **Anthropic** (SECONDARY - Claude usage)
  - **Redis** (SECONDARY - match memory)
  - **Arize** (SECONDARY - eval improvement)
  - Others (lower priority)
- Grand prize (Ddoski's World) positioning
- Winning playbook (4-phase approach)
- Devpost pitch template
- Sponsor talking points for judging
- Risk mitigation matrix

**When**: Read for competitive context before starting tasks

---

### 4. **SPRINT_PLAN.md** (Read as you execute)
**Purpose**: Detailed 17-hour execution plan with 12 concrete tasks  
**Contains**:
- Phase 1: Core Demo Setup (Hours 2-4)
  - Task 4: Deepgram STT/TTS integration
  - Task 5: Redis match memory
  - Task 6: Claude Q&A engine
- Phase 2: Demo & Video (Hours 4-6)
  - Task 7: Record 2-3 minute demo video
  - Task 8: Take polished screenshots
- Phase 3: Devpost & GitHub (Hours 6-7)
  - Task 9: Write Devpost submission
  - Task 10: Update GitHub README
- Phase 4: Final Rehearsal (Hours 7-8)
  - Task 11: Judging dry-run
  - Task 12: Final submission

**Also includes**:
- Risk mitigation checklist
- Success metrics (by judging time)
- Contingency plans
- Time allocation summary

**When**: Follow this task-by-task as your execution guide

---

### 5. **TERAC_WINNING_STRATEGY.md** (30 min)
**Purpose**: Your path to sponsor win (Terac is your lock-in)  
**Contains**:
- Terac rubric breakdown (50% improvement, 30% UX, 20% efficiency)
- 5-step winning path:
  1. Define baseline model
  2. Create annotation task (7 dimensions)
  3. Collect labels during hackathon ($250 budget)
  4. Use labels to improve ranker
  5. Evaluate improvement on held-out test set
- Sample data structures (JSON)
- Example metrics (baseline vs improved)
- How to present to judges (2-min pitch)
- Checklist for Terac submission
- Why you'll win this track

**When**: Read carefully before starting Terac tasks (Task 1-3)

---

## 🎯 CRITICAL FIRST STEPS (Next 2 Hours)

From **SPRINT_PLAN.md**, complete **Tasks 1-3** immediately:

**Task 1: Verify Terac Annotation UI** [30 min]
- Run: `npm run dev`
- Open: `http://localhost:5173/annotate`
- Test: Side-by-side comparison, buttons, data persistence
- If broken: Fix immediately

**Task 2: Gather 5 Soccer Clips** [30 min]
- Download from YouTube (World Cup highlights)
- Types: buildup attack, shot/save, foul, crowd reaction, goal
- Store in: `/clips/` folder as `.mp4`

**Task 3: Create 10-15 Labeled Pairs** [1 hour]
- Write baseline description (simple)
- Write improved description (spatial detail + direction + crowd reason)
- Rate each pair in annotation UI (7 dimensions)
- Save to: `data/terac_labels.json`

**Why these first?**
- Terac UI is your judge-facing artifact
- Clips + labels are your proof (real soccer content)
- Together show judges your Terac execution is ready

---

## 📊 EXECUTION PHASES

### PHASE 1: Core Demo (Tasks 1-3, Hours 0-2) [CRITICAL]
- Terac UI verification
- Soccer clips gathered
- Manual labels created
- **Output**: Working annotation demo + real clips + labeled examples

### PHASE 2: Integration (Tasks 4-6, Hours 2-4)
- Deepgram STT/TTS
- Redis match memory
- Claude improvements
- **Output**: Voice I/O working, memory functional

### PHASE 3: Media (Tasks 7-8, Hours 4-6)
- Record demo video (2-3 min)
- Take screenshots
- **Output**: Video + gallery ready

### PHASE 4: Submission (Tasks 9-12, Hours 6-8)
- Devpost submission
- GitHub README
- Rehearsal
- Final submit
- **Output**: Submitted to all tracks, ready for judging

---

## 💡 KEY INSIGHTS BY DOCUMENT

| Document | Key Insight |
|----------|-------------|
| QUICK_START | Terac is your lock-in; everything else is upside |
| STRATEGY_SUMMARY | You have strong competitive advantages; focus Terac first |
| HACKATHON_STRATEGY | Sponsor tracks ranked; Terac has highest win probability |
| SPRINT_PLAN | 12 tasks in 17 hours; do Tasks 1-3 immediately |
| TERAC_WINNING_STRATEGY | Clear path to improve: baseline→labels→prompt→metrics |

---

## 🎤 FOR JUDGING DAY

**Memorize these talking points**:
- Terac: "75 labels showed us ball location is key. Improved: 65%→85% helpful"
- Deepgram: "Voice is core, not bolted on"
- Anthropic: "Claude transforms soccer state into accessible language"
- Grand Prize: "World Cup-scale accessibility for millions of fans"

**Have ready**:
- Live demo (tested 10x minimum)
- Demo video (backup if live fails)
- GitHub repo with updated README
- Devpost submission (all tracks checked)
- 5-10 polished screenshots

---

## ⚠️ CRITICAL SUCCESS FACTORS

1. **Terac is non-negotiable** (Tasks 1-3, do NOW)
2. **Demo must run flawlessly** (test 10x, have video fallback)
3. **Voice must be essential** (not decoration)
4. **Metrics must be visible** (before/after numbers on screen)
5. **GitHub quality matters** (judges check your code)
6. **Devpost clarity wins** (first impression is crucial)

---

## 📋 QUICK REFERENCE CHECKLIST

- [ ] Read QUICK_START (2 min)
- [ ] Read STRATEGY_SUMMARY (8 min)
- [ ] Start SPRINT_PLAN Task 1 (verify Terac UI)
- [ ] Start SPRINT_PLAN Task 2 (gather clips)
- [ ] Start SPRINT_PLAN Task 3 (manual labels)
- [ ] Read TERAC_WINNING_STRATEGY (understand your win path)
- [ ] Complete Tasks 4-6 (integration)
- [ ] Complete Tasks 7-8 (media)
- [ ] Complete Tasks 9-12 (submission + rehearsal)
- [ ] Go win

---

## 🚀 YOU'VE GOT THIS

You have:
- Clear problem (accessibility gap)
- Clear solution (AI descriptions)
- Clear metrics (human labels prove improvement)
- Clear execution plan (12 tasks, 17 hours)
- Clear primary win (Terac)

Execute the plan. Terac is your lock-in. Everything else is upside.

**Start now. Read QUICK_START. Follow SPRINT_PLAN.**

Good luck.

---

## 📞 Questions?

Refer back to:
- **What's the plan?** → QUICK_START
- **Why will we win?** → STRATEGY_SUMMARY
- **How do I beat other competitors?** → HACKATHON_STRATEGY
- **What do I do next?** → SPRINT_PLAN
- **How do I win Terac?** → TERAC_WINNING_STRATEGY

All answers are in these documents.
