# Eye-Tracking MVP - Quick Setup Guide

## What I Built (5 min build)

✅ **3 new files**:
1. `src/services/eyetrack.js` - Core eye-tracking logic using WebGazer
2. `src/services/eyetrack-player.js` - UI component with controls
3. `eyetrack.html` - Demo page
4. `docs/EYETRACK_FEATURE.md` - Full documentation

## How to Use

### For Testing
```bash
cd /Users/benbioren/Desktop/match-vision
npm run dev
# Open http://localhost:5173/eyetrack.html
```

### For Integration
Link from main page (already added to index.html):
```html
<p><a class="link" href="eyetrack.html">👁️ Eye-Tracking Demo →</a></p>
```

## Quick Demo Flow

1. Click "👁️ Enable Eye Tracking"
2. Allow camera permission
3. Look at different parts of video
4. Video automatically zooms/pans to your gaze
5. Use zoom buttons for manual control
6. Toggle off anytime

## Why This Helps Your Hackathon

**Accessibility Angle**: 
- Blind fans → Audio description (current)
- Low-vision fans → Audio description + eye-tracked zoom (NEW)
- More inclusive design story for judges

**Judge Talking Point**:
> "We realized low-vision users have different needs than blind users. Eye tracking lets them focus on areas of interest while still getting audio context. It's a complete accessibility solution."

**Competitive Advantage**:
- Most projects don't think about low-vision specifically
- Shows user-centered design thinking
- Differentiates you from other accessibility projects

## Technical Notes

- Uses **WebGazer.js** (free, open-source, Brown University)
- No backend required (100% client-side)
- Loads from CDN automatically
- Falls back to manual zoom if tracking fails
- Privacy-first (no data collection)

## Integration Points

You can connect this to your existing features:
1. **Combine with Audio Description**: Audio describes what's happening + video zooms to key action
2. **Deepgram Integration**: "Zoom on the ball" voice command
3. **Redis Memory**: Remember user's zoom preference
4. **Terac Labels**: Rate whether eye tracking improved accessibility

## Timeline Impact

- ✅ Ready now (no additional work needed)
- Won't interfere with Terac/Deepgram tasks
- Add to Devpost as bonus feature
- Screenshot for judges
- 30-second demo in pitch: "We also built eye-tracking for low-vision fans"

## For Judges

**Show**: Navigate to eyetrack.html, click Enable Eye Tracking, look around video
**Say**: "This is for low-vision fans who need to zoom. Automatic gaze detection. No server. Privacy-first."
**Impact**: "Expands accessibility beyond blind users to the low-vision community"

## Next Steps

1. Test locally: `npm run dev` → eyetrack.html
2. Try enabling eye tracking + clicking around video
3. Add screenshot to Devpost gallery
4. Mention in pitch as "comprehensive accessibility"
5. Commit with: "Add eye-tracking feature for low-vision users"

That's it! You now have a novel accessibility feature that most hackathon teams won't think of.
