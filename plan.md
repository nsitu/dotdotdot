# Feature Plan: Multi-Path Ribbon Series

## Overview

Currently, the application assumes a single path when creating a ribbon:
- **SVG context**: Only the first `<path>` element is extracted (`querySelector("path")`)
- **Drawing context**: Only a single stroke is captured per drawing session

This plan outlines support for **multiple paths** that result in a **series of ribbons** rendered together, with continuous texture tiling across all ribbons.

---

## Phase 1: SVG Multi-Path Support (Initial Focus)

### Test Assets
- `public/R-2.svg` - Contains **2 paths**
- `public/R-3.svg` - Contains **3 paths**

### 1.1 Modify `svgPathToPoints.js`

#### New Function: `parseSvgContentMultiPath()`

Create a new function that returns an **array of point arrays** (one per path):

```javascript
/**
 * Parses SVG content and extracts points from ALL paths
 * @param {string} svgContent - SVG content as string
 * @param {number} numPoints - Number of points to sample per path
 * @param {number} scale - Scale factor for the points
 * @param {number} z - Z position for all points
 * @returns {Array<Array<THREE.Vector3>>} Array of point arrays (one per path)
 */
export function parseSvgContentMultiPath(svgContent, numPoints = 100, scale = 1, z = 0) {
    // Use querySelectorAll("path") instead of querySelector("path")
    // Return array of arrays: [[path1Points], [path2Points], ...]
}
```

**Key changes:**
- Use `svgDoc.querySelectorAll("path")` to get all path elements
- Iterate over each path, calling `svgPathToPoints()` for each
- Return `Array<Array<THREE.Vector3>>` instead of `Array<THREE.Vector3>`
- Handle edge case: empty paths or paths with no `d` attribute

#### New Function: `normalizePointsMultiPath()`

Normalize multiple path arrays together so they share a common coordinate space:

```javascript
/**
 * Normalizes multiple point arrays to fit within a target size together
 * @param {Array<Array<THREE.Vector3>>} pathsPoints - Array of point arrays
 * @param {number} targetSize - The desired maximum dimension size
 * @returns {Array<Array<THREE.Vector3>>} Normalized paths
 */
export function normalizePointsMultiPath(pathsPoints, targetSize = 8) {
    // Calculate combined bounding box across ALL paths
    // Apply same scale/center transform to ALL paths
}
```

### 1.2 Create `RibbonSeries` Class

New file: `src/modules/ribbonSeries.js`

```javascript
export class RibbonSeries {
    constructor(scene) {
        this.scene = scene;
        this.ribbons = [];           // Array of Ribbon instances
        this.tileManager = null;
        this.totalSegmentCount = 0;  // For continuous texture indexing
    }

    setTileManager(tileManager) { ... }

    /**
     * Build ribbons from multiple path point arrays
     * @param {Array<Array<THREE.Vector3>>} pathsPoints - Array of point arrays
     * @param {number} width - Ribbon width
     * @param {number} time - Animation time
     */
    buildFromMultiplePaths(pathsPoints, width = 1, time = 0) {
        this.cleanup();
        
        let segmentOffset = 0;  // Track cumulative segment count
        
        for (const points of pathsPoints) {
            const ribbon = new Ribbon(this.scene);
            ribbon.setTileManager(this.tileManager);
            ribbon.setSegmentOffset(segmentOffset);  // NEW: offset for texture continuity
            
            ribbon.buildFromPoints(points, width, time);
            
            segmentOffset += ribbon.meshSegments.length;
            this.ribbons.push(ribbon);
        }
        
        this.totalSegmentCount = segmentOffset;
    }

    update(time) {
        this.ribbons.forEach(ribbon => ribbon.update(time));
    }

    cleanup() {
        this.ribbons.forEach(ribbon => ribbon.dispose());
        this.ribbons = [];
        this.totalSegmentCount = 0;
    }

    dispose() {
        this.cleanup();
    }
}
```

### 1.3 Modify `Ribbon` Class

Add support for a **segment offset** to enable continuous texture indexing:

```javascript
// In Ribbon constructor
this.segmentOffset = 0;

// New method
setSegmentOffset(offset) {
    this.segmentOffset = offset;
    return this;
}

// In createRibbonSegmentWithCache, modify material lookup:
// OLD: this.tileManager.getMaterial(segmentIndex)
// NEW: this.tileManager.getMaterial(segmentIndex + this.segmentOffset)
```

### 1.4 Update `main.js` SVG Import

Modify the SVG file handler to use the new multi-path functions:

```javascript
// fileInput change handler
const pathsPoints = parseSvgContentMultiPath(svgText, 80, 5, 0);

if (pathsPoints && pathsPoints.length > 0) {
    const normalizedPaths = normalizePointsMultiPath(pathsPoints);
    resetCamera();
    
    // Use RibbonSeries instead of single Ribbon
    ribbonSeries.buildFromMultiplePaths(normalizedPaths, 1.2);
}
```

---

## Phase 2: Drawing Multi-Stroke Support

### Overview

Enable users to draw multiple strokes in a single drawing session, which will be converted into a `RibbonSeries` with continuous texture tiling.

### 2.1 Modify `DrawingManager`

Track multiple strokes per drawing session:

```javascript
// In DrawingManager constructor - add new properties
this.strokes = [];        // Array of completed stroke point arrays
this.currentStroke = [];  // Points for stroke currently being drawn
this.isDrawingStroke = false;  // Whether user is currently drawing a stroke

// Modify handlePointerDown:
// - Start a new stroke (currentStroke = [])
// - Set isDrawingStroke = true

// Modify handlePointerUp:
// - If currentStroke has >= 2 points, push to strokes array
// - Clear currentStroke
// - Set isDrawingStroke = false
// - Do NOT call onDrawingComplete here (wait for finalize)

// New method: finalizeDrawing()
finalizeDrawing() {
    if (this.strokes.length === 0) return null;
    const result = [...this.strokes];
    this.strokes = [];
    this.clearCanvas();
    return result;  // Returns Array<Array<{x,y}>>
}

// New method: getStrokeCount()
getStrokeCount() {
    return this.strokes.length;
}

// New method: clearStrokes()
clearStrokes() {
    this.strokes = [];
    this.currentStroke = [];
    this.clearCanvas();
}
```

**Key behavior changes:**
- `pointerup` no longer triggers immediate callback
- Strokes accumulate until explicitly finalized
- Canvas shows all strokes (not just current one)
- Each stroke drawn in a slightly different shade for visual distinction

### 2.2 Finalization Options

#### Option A: "Finish Drawing" Button (Recommended)

Add a button that appears when in drawing mode:

```javascript
// In domElements.js
export const finishDrawingBtn = document.getElementById('finishDrawingBtn');

// In index.html
<button id="finishDrawingBtn" class="hidden">Finish (0 strokes)</button>
```

**Button behavior:**
- Hidden by default, shown when `setDrawingMode(true)`
- Updates label to show stroke count: "Finish (3 strokes)"
- On click: calls `drawingManager.finalizeDrawing()` and processes result
- Disabled when stroke count is 0

**Pros:**
- Explicit user control
- Clear affordance for "I'm done"
- Works consistently on all devices

**Cons:**
- Extra UI element
- Requires intentional action

#### Option B: Double-Tap to Finalize

Detect double-tap on canvas (not during stroke):

```javascript
// In DrawingManager
this.lastTapTime = 0;
this.doubleTapThreshold = 300; // ms

handlePointerDown(e) {
    const now = Date.now();
    const timeSinceLastTap = now - this.lastTapTime;
    
    if (timeSinceLastTap < this.doubleTapThreshold && this.strokes.length > 0) {
        // Double-tap detected - finalize
        this.onDrawingComplete(this.finalizeDrawing());
        return;
    }
    
    this.lastTapTime = now;
    // ... normal stroke start logic
}
```

**Pros:**
- No additional UI
- Natural gesture on touch devices

**Cons:**
- Less discoverable
- Can accidentally trigger
- Conflict with starting a new stroke quickly

#### Option C: Timeout Auto-Finalize

Auto-finalize after period of inactivity:

```javascript
// In DrawingManager
this.autoFinalizeTimeout = null;
this.autoFinalizeDelay = 2000; // 2 seconds of inactivity

handlePointerUp(e) {
    // ... existing stroke completion logic
    
    // Reset/start auto-finalize timer
    if (this.autoFinalizeTimeout) {
        clearTimeout(this.autoFinalizeTimeout);
    }
    
    if (this.strokes.length > 0) {
        this.autoFinalizeTimeout = setTimeout(() => {
            this.onDrawingComplete(this.finalizeDrawing());
        }, this.autoFinalizeDelay);
    }
}

handlePointerDown(e) {
    // Cancel auto-finalize if user starts new stroke
    if (this.autoFinalizeTimeout) {
        clearTimeout(this.autoFinalizeTimeout);
        this.autoFinalizeTimeout = null;
    }
    // ... normal stroke start logic
}
```

**Pros:**
- Automatic, no extra action needed
- Works when user naturally pauses

**Cons:**
- User might not be "done" when timeout fires
- Delay feels slow if user is done
- Needs visual feedback (countdown indicator?)

#### Recommended Approach: Button + Optional Timeout

Combine Option A and C:
- Primary: "Finish Drawing" button for explicit control
- Secondary: Auto-finalize after 3 seconds of inactivity (can be disabled in settings)
- Visual indicator showing countdown when auto-finalize is pending

### 2.3 UI Updates

#### New DOM Elements

```html
<!-- In index.html, add inside the button container -->
<button id="finishDrawingBtn" class="mode-btn hidden">
    Finish Drawing
    <span id="strokeCount">(0)</span>
</button>
```

#### CSS Additions

```css
#finishDrawingBtn {
    background: #4CAF50;
    display: none;
}

#finishDrawingBtn.visible {
    display: inline-flex;
}

#finishDrawingBtn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

#strokeCount {
    margin-left: 4px;
    opacity: 0.8;
}

/* Auto-finalize countdown indicator */
.auto-finalize-indicator {
    position: fixed;
    bottom: 100px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0,0,0,0.7);
    color: white;
    padding: 8px 16px;
    border-radius: 20px;
    font-size: 14px;
    display: none;
}

.auto-finalize-indicator.active {
    display: block;
}
```

### 2.4 Integration with main.js

```javascript
// Update handleDrawingComplete to accept multi-stroke data
function handleDrawingComplete(strokesData) {
    // strokesData is now Array<Array<{x,y}>> for multi-stroke
    // or Array<{x,y}> for single-stroke (backward compat)
    
    const isMultiStroke = Array.isArray(strokesData[0]?.x === undefined ? strokesData[0] : null);
    
    if (isMultiStroke) {
        // Multi-stroke: use RibbonSeries
        const pathsPoints = strokesData.map(stroke => 
            ribbon.normalizeDrawingPoints(stroke).map(p => 
                new THREE.Vector3(p.x, p.y, 0)
            )
        );
        
        // Normalize all paths together
        const normalizedPaths = normalizePointsMultiPath(pathsPoints);
        
        resetCamera();
        ribbonSeries.buildFromMultiplePaths(normalizedPaths, 1.2);
    } else {
        // Single stroke: use existing Ribbon logic
        ribbon.createRibbonFromDrawing(strokesData);
    }
}

// Show/hide finish button based on drawing mode
function setDrawingMode(enableDrawing) {
    // ... existing code ...
    
    if (finishDrawingBtn) {
        finishDrawingBtn.classList.toggle('visible', enableDrawing);
        updateStrokeCountUI();
    }
    
    if (!enableDrawing) {
        drawingManager?.clearStrokes();
    }
}

// Update stroke count UI
function updateStrokeCountUI() {
    if (strokeCountSpan && drawingManager) {
        const count = drawingManager.getStrokeCount();
        strokeCountSpan.textContent = `(${count})`;
        finishDrawingBtn.disabled = count === 0;
    }
}
```

### 2.5 Visual Feedback

When multiple strokes are being drawn:

1. **Stroke numbering**: Each stroke rendered in slightly different color/opacity
2. **Stroke count badge**: Show "3 strokes" indicator on canvas
3. **Preview on hover**: Hovering "Finish" button could briefly highlight all strokes
4. **Undo last stroke**: Optional button to remove the last stroke before finalizing

```javascript
// In DrawingManager.drawAllStrokes()
drawAllStrokes() {
    this.clearCanvas();
    
    // Draw completed strokes
    this.strokes.forEach((stroke, index) => {
        const hue = (index * 30) % 360;  // Vary color per stroke
        this.ctx.strokeStyle = `hsla(${hue}, 70%, 60%, 0.5)`;
        this.drawStrokePoints(stroke);
    });
    
    // Draw current stroke
    if (this.currentStroke.length > 0) {
        this.ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        this.drawStrokePoints(this.currentStroke);
    }
}
```

---

## File Changes Summary (Phase 2)

| File | Changes |
|------|---------|
| `src/modules/drawing.js` | Add multi-stroke tracking, finalize methods, visual feedback |
| `src/modules/domElements.js` | Add `finishDrawingBtn`, `strokeCountSpan` exports |
| `index.html` | Add finish button HTML |
| `src/style.css` | Add finish button and indicator styles |
| `src/main.js` | Update `handleDrawingComplete`, `setDrawingMode`, add stroke count UI |

---

## Implementation Order (Phase 2) ✅ COMPLETE

1. ✅ Update `DrawingManager` with multi-stroke tracking
2. ✅ Add `finalizeDrawing()`, `getStrokeCount()`, `clearStrokes()` methods
3. ✅ Add finish button to HTML and domElements.js
4. ✅ Add CSS styles for finish button
5. ✅ Update `main.js` integration
6. ✅ Add visual feedback (stroke colors, count indicator)
7. ✅ Add auto-finalize timeout with countdown
8. [ ] (Optional) Add undo last stroke functionality
9. [ ] Test multi-stroke → RibbonSeries flow

---

## Texture Continuity Example

Given:
- Ribbon 1: 17 segments → uses tiles 0-16
- Ribbon 2: 10 segments → uses tiles 17-26
- Ribbon 3: 5 segments → uses tiles 27-31

```
┌─────────────────┐  ┌──────────────┐  ┌────────┐
│   Ribbon 1      │  │   Ribbon 2   │  │Ribbon 3│
│ tiles 0-16      │  │ tiles 17-26  │  │27-31   │
└─────────────────┘  └──────────────┘  └────────┘
```

The `segmentOffset` mechanism ensures seamless texture flow across ribbons.

---

## File Changes Summary

| File | Changes |
|------|---------|
| `src/modules/svgPathToPoints.js` | Add `parseSvgContentMultiPath()`, `normalizePointsMultiPath()` |
| `src/modules/ribbonSeries.js` | **NEW** - `RibbonSeries` class |
| `src/modules/ribbon.js` | Add `segmentOffset` property and `setSegmentOffset()` method |
| `src/main.js` | Update SVG import to use multi-path functions and `RibbonSeries` |

---

## Implementation Order (Phase 1) ✅ COMPLETE

1. ✅ Create this plan
2. ✅ Add `parseSvgContentMultiPath()` to `svgPathToPoints.js`
3. ✅ Add `normalizePointsMultiPath()` to `svgPathToPoints.js`
4. ✅ Create `RibbonSeries` class
5. ✅ Add `segmentOffset` to `Ribbon` class
6. ✅ Update `main.js` SVG import flow
7. ✅ Test with `R-2.svg` and `R-3.svg`

---

## Testing Checklist (Phase 1) ✅ COMPLETE

- [x] Single-path SVG still works (backward compatibility)
- [x] `R-2.svg` renders 2 ribbons with continuous textures
- [x] `R-3.svg` renders 3 ribbons with continuous textures
- [x] Texture wrapping when total segments exceed available tiles
- [x] Animation updates work across all ribbons in series
- [x] Cleanup/dispose properly removes all ribbon meshes