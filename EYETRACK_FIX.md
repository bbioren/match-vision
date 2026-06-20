# Eye-Tracking Fix - Test Guide

## What I Fixed

**Problem**: Pan wasn't working when you looked around

**Root causes**:
1. Pan calculation was too complex and had wrong formulas
2. Gaze data wasn't being smoothed properly
3. No throttling (updates were too frequent, causing jitter)
4. Missing debug logging to see what was happening

**Solution**:
1. Simplified pan calculation (now uses correct math)
2. Faster gaze averaging (5 samples instead of 10)
3. Throttled to 20fps (50ms between updates)
4. Added console logging for debugging
5. Added debug UI showing tracking status

---

## How to Test

### Step 1: Run the dev server
```bash
cd /Desktop/match-vision
npm run dev
```

### Step 2: Navigate to eye-tracking demo
Open: `http://localhost:5173/eyetrack.html`

### Step 3: Enable eye tracking
1. Click "👁️ Enable Eye Tracking"
2. Allow camera permission (browser will prompt)
3. Wait ~3-5 seconds for calibration

### Step 4: Look around and watch video pan
1. Look to the **LEFT** of the screen → video pans LEFT
2. Look to the **CENTER** → video stays centered
3. Look to the **RIGHT** → video pans RIGHT
4. Same for UP/DOWN

### Step 5: Check the console
Open DevTools (`F12` or `Cmd+Option+I`):
- Go to **Console** tab
- You'll see gaze position logs like:
  ```
  Gaze: (25%, 50%) Pan: (-75px, 0px)
  Gaze: (75%, 50%) Pan: (75px, 0px)
  ```

### Step 6: Verify it works
- ✅ Video zooms in 1.5x
- ✅ Video pans to where you look
- ✅ Console shows gaze data
- ✅ Status updates say "Eye tracking active"

---

## If It Still Doesn't Pan

**Check these in order**:

1. **Camera Permission?**
   - Browser should ask for camera permission
   - Make sure you clicked "Allow"
   - Check browser privacy settings

2. **Console Errors?**
   - Open DevTools → Console
   - Look for red errors
   - Most common: "WebGazer failed to initialize"
   - This means WebGazer CDN couldn't load (network issue)

3. **Calibration?**
   - You should see: "No gaze data yet - calibrating..."
   - Look at different parts of video for 5-10 seconds
   - Console should start printing gaze data

4. **Browser Support?**
   - WebGazer works best on: Chrome, Firefox, Edge
   - Safari has partial support
   - Mobile browsers: limited support

5. **Screen Setup?**
   - Camera should see your face clearly
   - Good lighting helps
   - Position camera at eye level
   - Keep head relatively still

---

## Technical Details

### Pan Calculation (Fixed)
```javascript
// Normalize gaze to 0-1 (0 = left, 0.5 = center, 1 = right)
const gazeX = avgGazeX / window.innerWidth;

// How much can we pan? At 1.5x zoom, max pan is 25% each direction
const maxPan = (zoomLevel - 1) / 2;  // 0.25 for 1.5x zoom

// Pan left if looking left, right if looking right
const panX = (gazeX - 0.5) * maxPan * containerWidth;

// Apply: zoom first, then pan
videoElement.style.transform = `scale(1.5) translate(${panX}px, ${panY}px)`;
```

### Updates per Second
- WebGazer fires gaze data ~30fps
- We throttle to 20fps (50ms between updates)
- This prevents jitter while staying responsive

### Smoothing
- We keep last 5 gaze samples
- Average them for smooth panning
- Older approach (10 samples) was too laggy

---

## For Judges

When demoing:
1. Open eyetrack.html
2. Enable eye tracking
3. **Slowly move your head** left/right, up/down
4. **Watch the video pan** to follow your gaze
5. Say: "This is automatic gaze-based zoom for low-vision users"

---

## Quick Checklist

- [ ] Run `npm run dev`
- [ ] Open eyetrack.html
- [ ] Enable eye tracking
- [ ] Allow camera permission
- [ ] Wait for calibration (~5 sec)
- [ ] Look around - video should pan
- [ ] Check console for gaze logs
- [ ] Take a screenshot for Devpost

---

## Still Issues?

If pan still isn't working after trying above:

1. **Check Network**: WebGazer loads from CDN
   - Make sure internet connection is stable
   - Check browser network tab (DevTools → Network)

2. **Try Manual Zoom**: Click "Zoom In" button
   - If buttons work but eye tracking doesn't, it's a gaze detection issue
   - Try different lighting or camera position

3. **Use Fallback**: If eye tracking fails completely
   - Manual zoom buttons still work (not dependent on gaze)
   - Can still use main MatchVision features
   - Eye tracking is a bonus feature, not required

4. **Reset**: Click "Reset" button to return to 1x zoom
   - Then disable and re-enable eye tracking
   - Sometimes recalibration helps

---

**Note**: Eye tracking works best with:
- Desktop/laptop with built-in or external camera
- Chrome or Firefox browser
- Good lighting (natural or bright artificial light)
- Clear camera view of your face
- Stable internet (for CDN load)

Let me know if it works now!
