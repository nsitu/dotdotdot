# Plan: Diagnosing Intermittent Ribbon Rendering on Android/WebGPU

## Problem Summary
Procedurally generated "ribbons" (meshes built from user-drawn paths) sometimes do not render on Android when using Three.js with the WebGPU backend, while:
- Initial SVG-based ribbon renders correctly
- Persistent red test cube renders correctly
- Scene is active and geometry counts/bounds appear normal

---

## Key Finding from Experiment 1

**Observation:** When a drawing fails to render, replaying the same points consistently fails. When a drawing succeeds, replaying consistently succeeds. This strongly suggests the issue is **deterministic based on the point data itself**, not a timing/context issue.

**Implication:** There is something about certain point patterns or resulting geometry that causes WebGPU to fail silently.

---

## Experiment 1: Capture Drawn Points for Replay ✅ IMPLEMENTED

**Goal:** Isolate whether the issue is in the drawing input or the rendering context by enabling exact replay of failed drawings.

**Implementation:**
1. ✅ Add a `capturedDrawings` array to store raw point data from each drawing session
2. ✅ Log points to console as JSON on each `handleDrawingComplete`
3. ✅ Add history navigation with ◀ Prev / Current / Next ▶ buttons
4. ✅ Persist to `localStorage` for cross-session replay (keeps last 20 drawings)
5. ✅ Add "Clear Drawings" button to reset captured data
6. ✅ Display current position (e.g., "3/10 ✓" or "3/10 ✗") when navigating history
7. ✅ Add "✓ OK" / "✗ Fail" buttons for user to manually log render success/failure
8. ✅ Add "Export" button to dump all drawings with analysis to console
9. ✅ Store `userFeedback` ('success' | 'fail') per drawing in localStorage

**Captured Data per Drawing:**
- `id`: Sequential drawing number
- `timestamp`: ISO timestamp
- `points`: Array of {x, y} raw screen coordinates
- `rendererType`: 'webgl' or 'webgpu'
- `viewport`: {width, height} at time of drawing
- `success`: Boolean indicating if segments were created (programmatic)
- `segmentCount`: Number of ribbon segments created
- `userFeedback`: 'success' | 'fail' (user-logged visual confirmation)
- `feedbackTimestamp`: When user logged the feedback

**Console Output:**
- `[PointCapture] Drawing #N captured` - Summary when drawing starts
- `[PointCapture] Drawing #N JSON:` - Copyable JSON for manual replay
- `[PointCapture] Drawing #N saved` - Confirmation of localStorage save
- `[PointCapture] Drawing #N logged as SUCCESS/FAIL` - User feedback logged
- `[PointCapture] DRAWINGS EXPORT FOR ANALYSIS` - Full analysis dump with:
  - Summary statistics (success/fail/unlabeled counts)
  - Per-drawing metrics (bounds, size, aspect ratio)
  - Success vs Fail comparison (avg points, avg dimensions)
  - Raw JSON for external analysis

**Next Steps:**
- Collect multiple success and fail samples on Android/WebGPU
- Use Export to analyze patterns in point bounds, aspect ratios, point counts
- Look for thresholds or edge cases that trigger failure

---

## Experiment 2: Analyze Segment Summaries for Failed vs Successful Cases

**Goal:** Identify subtle differences between working and broken ribbon builds.

**Metrics to Compare:**
- `segmentCount` - total segments created
- `material.type` - NodeMaterial vs MeshBasicMaterial vs ShaderMaterial
- `mesh.visible` - should always be `true`
- `geometry.drawRange` - `{start, count}` should match index count
- `geometry.attributes.position.count` - vertex count per segment
- `geometry.index.count` - index count per segment
- `mesh.frustumCulled` - if `true`, could be culled incorrectly
- `material.depthTest` / `material.depthWrite` - depth buffer issues
- `material.side` - should be `THREE.DoubleSide` for visibility from all angles
- `mesh.renderOrder` - could affect draw order

**Implementation:**
1. Extend `handleDrawingComplete` diagnostics to capture all above fields
2. Create a structured log format for easy diff comparison
3. Add a global counter to tag each drawing attempt for correlation

---

## Experiment 3: WebGPU-Specific Hypotheses

**Potential Causes:**

### 3a. Pipeline State / Material Compilation Timing
- WebGPU compiles shader pipelines asynchronously
- If material isn't ready when first rendered, mesh may be skipped
- **Test:** Add `await renderer.compileAsync(scene, camera)` after ribbon creation

### 3b. Frustum Culling with Incorrect Bounds
- Bounding sphere/box may not be computed or may be degenerate
- **Test:** Force `mesh.frustumCulled = false` on all ribbon segments

### 3c. Resource Limits / Buffer Recycling
- WebGPU may have stricter limits on buffer creation/destruction cycles
- Rapid create/dispose cycles (from `cleanupOldMesh`) could cause issues
- **Test:** Delay disposal, or pool geometries instead of disposing

### 3d. Render Order / Depth Fighting
- New ribbons may be rendered behind other geometry or z-fighting
- **Test:** Set explicit `renderOrder` on ribbon meshes, or disable depth test temporarily

### 3e. NodeMaterial vs Basic Material
- NodeMaterial (TSL) may have initialization quirks on Android
- **Test:** Force `webgpuMaterialMode = 'basic'` and compare results

---

## Experiment 4: Targeted Instrumentation & Visual Probes

**Low-Risk Probes:**

### 4a. Visibility Toggle Test
```javascript
// After ribbon creation, toggle visibility off then on
ribbon.meshSegments.forEach(m => m.visible = false);
requestAnimationFrame(() => {
    ribbon.meshSegments.forEach(m => m.visible = true);
});
```
**Purpose:** Force re-evaluation of visibility state

### 4b. Force Simple Material Test
```javascript
// Replace all segment materials with a flat color
const debugMat = new THREE.MeshBasicMaterial({ color: 0x00ff00, side: THREE.DoubleSide });
ribbon.meshSegments.forEach(m => m.material = debugMat);
```
**Purpose:** Isolate material vs geometry issues

### 4c. Bounding Sphere Visualization
```javascript
// Add wireframe spheres at each segment's bounding sphere
ribbon.meshSegments.forEach(m => {
    m.geometry.computeBoundingSphere();
    const sphere = m.geometry.boundingSphere;
    const helper = new THREE.Mesh(
        new THREE.SphereGeometry(sphere.radius, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xffff00, wireframe: true })
    );
    helper.position.copy(sphere.center);
    scene.add(helper);
});
```
**Purpose:** Verify bounding spheres are reasonable and not culled

### 4d. Frame-Delayed Render Force
```javascript
// After ribbon creation, force multiple render passes
for (let i = 0; i < 3; i++) {
    requestAnimationFrame(() => renderer.render(scene, camera));
}
```
**Purpose:** Ensure WebGPU pipeline has time to compile

---

## Implementation Priority

1. **Immediate:** Implement point capture/replay (Experiment 1)
2. **Immediate:** Add `frustumCulled = false` to all ribbon segments (Experiment 3b)
3. **Short-term:** Add `compileAsync` after ribbon creation (Experiment 3a)
4. **Short-term:** Extended segment diagnostics (Experiment 2)
5. **If still failing:** Force basic material test (Experiment 4b)
6. **If still failing:** Test disposal timing (Experiment 3c)

---

## Success Criteria
- Identify a reproducible pattern that correlates with rendering failures
- Implement a fix that ensures drawn ribbons render consistently on Android/WebGPU
- Document root cause for future reference