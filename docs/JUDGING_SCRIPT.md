# MatchVision Judging Script

## 30-second opener

Commentary exists, but it assumes you can see. Blind and low-vision soccer fans often hear excitement without the visual context sighted fans take for granted: where the ball is, which direction the attack is moving, who is open, and why the crowd reacted.

**MatchVision adds that missing visual layer through a voice-first accessibility companion.**

## 3-minute demo flow

### 0:00-0:30 Problem

Say:

> This is not an AI commentator. It is an accessibility-grade visual description layer for blind and low-vision soccer fans, inspired by the World Cup moment.

### 0:30-1:15 Core demo

1. Open `index.html`.
2. Select **Right-wing cross and near miss**.
3. Ask: **What just happened?**
4. Press **Speak answer**.
5. Ask: **Why did the crowd react?**

Say:

> Normal commentary might say “what a chance.” MatchVision explains the visual scene: direction of attack, ball location, the low cross, and how close the striker was.

### 1:15-1:55 Personalization / memory

1. Select **Counterattack through midfield**.
2. Ask: **Who has space?**
3. Ask: **Give me tactical detail.**

Say:

> The product is queryable. A blind fan can ask for the exact visual layer they are missing rather than waiting for a commentator to mention it.

### 1:55-2:35 Terac improvement

1. Open `annotate.html`.
2. Show baseline vs candidate-ranked description.
3. Show rubric fields.
4. Mention metrics script.

Say:

> For Terac, we built an accessibility labeling workflow. Human labelers compare baseline commentary to MatchVision descriptions on ball location, direction, key-event coverage, concision, hallucination, and helpfulness. We then compute before/after metrics and use them to improve the description prompt/ranker.

### 2:35-3:00 Sponsor stack close

Say:

> Deepgram powers the voice interface, Claude generates accessible descriptions, Redis is the real-time match memory and preference layer, Terac gives us human accessibility labels that train/tune the description selector, and Arize-style evals prove whether the system actually improves. We are not replacing commentators. We are adding the missing visual layer for fans who have been excluded from the world's most visual sport.

## 5-minute table judging flow

1. Problem and users: 45 sec
2. Live voice demo: 90 sec
3. Annotation Lab and metrics: 60 sec
4. Architecture and sponsors: 60 sec
5. Impact / future: 45 sec
6. Questions: remaining time

## Judge Q&A

### Why not normal commentary?

Normal commentary is optimized for sighted viewers. It often skips spatial details because viewers can see them. MatchVision provides explicit, personalized visual access: ball location, direction of attack, player spacing, crowd reaction reason, and concise spoken context.

### Is this live computer vision?

The MVP uses structured event logs for reliability in a 24-hour hackathon. The architecture supports live video captions, event feeds, or model-generated frame captions. The core contribution is the voice-first accessibility layer and human-labeled improvement loop.

### How did Terac improve the model?

We collect human labels comparing baseline and improved descriptions. Labels identify what makes descriptions useful for blind/low-vision fans. We then tune prompts/ranking rules and evaluate on held-out examples with metrics like preference win rate, key-event coverage, and hallucination rate.

### Why soccer?

The World Cup makes the timing culturally relevant, but the accessibility problem generalizes to any visual sport or live event.
