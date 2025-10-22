# Plan: KTX2 Texture Arrays with Layer Cycling (WebGL-first)

This plan introduces KTX2 texture arrays to replace per-segment JPG textures and adds time-based cycling across array layers with two modes: "waves" (loop) and "planes" (ping-pong). Cycling runs continuously without playback controls. We keep the current Ribbon UX, rendering in Three.js with WebGL2. Optional future: WebGPU path.

## Context (current code)
- `TileManager` loads 32 JPGs with `THREE.TextureLoader()` from `./tiles-numbered/${index}.jpg`.
- `Ribbon` builds many segment meshes; each segment uses `MeshBasicMaterial({ map: tileTexture })` where `tileTexture = tileManager.getTile(segmentIndex)`.
- `main.js` initializes `TileManager`, then `Ribbon.setTileManager(tileManager)` and drives a render loop.

## Goals
- Load per-tile KTX2 files where each file is a texture array (depth = number of frames/layers).
- Render with a shader that samples a 2D array texture and flips V in shader.
- Cycle visible layer continuously over time across all segments with two modes:
  - waves: 0 → (L-1) → 0 → ... (loop)
  - planes: 0 → (L-1) → 0 with ping-pong direction
- No external playback controls (start/stop/setLayer). The cycling speed is fixed in code.
- Keep API stable for `Ribbon` (minimal changes): instead of requesting textures, request materials or let TileManager supply the correct material per segment.
- Fallback to JPGs when WebGL2 or KTX2 is unavailable.

## Asset layout and assumptions
- New sources:
  - `public/tiles-ktx2-planes/{0..32}.ktx2`
  - `public/tiles-ktx2-waves/{0..32}.ktx2`
- Each KTX2 file encodes a texture array; all files share the same `depth` (layerCount). We take the depth from the first successfully loaded KTX2 and validate others match.
- BasisU transcoder WASM is already available at `public/wasm/`.

## High-level design
- Add a KTX2-backed path to `TileManager`:
  - Constructor options: `{ source: 'jpg' | 'ktx2-planes' | 'ktx2-waves', fps = 30, mode = 'waves' }`.
  - On `loadAllTiles()`:
    - If `.source === 'jpg'`: use current JPG loader (unchanged).
    - Else: use `KTX2Loader` to load each `./tiles-ktx2-<variant>/${index}.ktx2` into `sampler2DArray` textures.
      - Configure: `flipY=false`, no mip generation (unless provided), `LinearFilter`, `ClampToEdgeWrapping`.
      - Detect layerCount once from the first load (`texture.image.depth`).
  - Create a WebGL2 `ShaderMaterial` per tile: `uniforms = { uTexArray: { value: arrayTexture }, uLayer: sharedUniformRef, uLayerCount }`.
    - Share a single `uLayer` object across all materials so updating one `value` updates all.
  - Expose:
    - `getMaterial(index)`: returns the material for that tile/segment.
    - `getLayerCount()`: returns detected depth (optional, for debug).
    - Internal cycling: a lightweight `tick(nowMs)` advances a shared `uLayer` on a continuous loop; call from the existing render loop. No user-facing playback controls.

- Ribbon integration:
  - Replace `tileManager.getTile(segmentIndex)` with `tileManager.getMaterial(segmentIndex)` when in KTX2 mode. In JPG mode, provide a compatibility material factory or keep current branch.
  - Share materials per segment (each material points to that segment's own array texture; all share the same `uLayer` uniform reference).

- Render loop integration (main.js):
  - Call `tileManager.tick(performance.now())` once per frame when in KTX2 mode.
  - No UI toggles are required; cycling is continuous with a fixed speed.

## WebGL shader (GLSL3)
Use WebGL2 `sampler2DArray` (requires WebGL2). Flip V in shader.

Vertex:
- Pass UV through.

Fragment:
- `precision highp sampler2DArray;`
- `outColor = texture(uTexArray, vec3(vec2(vUv.x, 1.0 - vUv.y), float(uLayer)));`

Uniforms:
- `uTexArray: sampler2DArray`
- `uLayer: int`
- `uLayerCount: int` (optional for bounds checking, debug).

Material flags:
- `glslVersion: THREE.GLSL3`
- `transparent: false`, `depthWrite: true`, `side: DoubleSide`.

## Feature detection and fallbacks
- WebGL2 check: `renderer.capabilities.isWebGL2` or create a test GL context.
  - If false: fall back to JPG path.
- KTX2 support:
  - Ensure `KTX2Loader` detects support and transcoder is available.
  - If detection fails: fall back to JPG path.

## Setup: KTX2 transcoder assets
- BasisU transcoder WASM is already present in `public/wasm/`.
- In `TileManager` KTX2 path: `ktx2Loader.setTranscoderPath('./wasm/');`
- Use `ktx2Loader.detectSupport(renderer);` (WebGL) or `detectSupportAsync(renderer)` (WebGPU, later).

## API changes and contracts
- TileManager additions:
  - Inputs:
    - `source`: 'jpg' | 'ktx2-planes' | 'ktx2-waves'
    - `tileCount`: default 32
  - Outputs/Methods:
    - `loadAllTiles(): Promise<void>`
    - `getMaterial(index): THREE.Material` (KTX2) | `getTile(index): THREE.Texture` (JPG)
    - `getLayerCount(): number`
    - `tick(nowMs)`: advance the cycling layer continuously; intended to be called from the app's render loop (no start/stop controls).
  - Error modes:
    - Missing WASM/transcoder → log and fallback to JPG
    - Mismatched layerCounts across KTX2 files → clamp to min depth, log warning
    - Corrupt tile file → per-tile fallback material (solid color) to keep app running

- Ribbon expectations:
  - If `tileManager.getMaterial` exists (KTX2 mode), use it to create segment meshes.
  - Else fallback to existing texture path.

## Implementation steps (by file)
1. `src/modules/tileManager.js`
   - Refactor to support both data sources. Suggested structure:
     - Keep existing JPG loader as-is for fallback/compat.
     - Add `this.isKTX2 = source.startsWith('ktx2'); this.folder = source === 'ktx2-planes' ? './tiles-ktx2-planes' : './tiles-ktx2-waves'`.
     - On KTX2 path, instantiate and configure `KTX2Loader` once.
     - Load each tile into an array texture and create a `ShaderMaterial` with shared `uLayer` uniform.
     - Store results in `this.materials[index]` (KTX2) and `this.textures[index]` (JPG).
     - Add playback fields: `currentLayer`, `direction`, `fps`, `lastFrameTime`, `layerCount`, `cyclingMode`.
     - Methods: `setLayer`, `startPlayback`, `stopPlayback`, `updateCycling` (logic mirrors the excerpts).

2. `src/modules/ribbon.js`
   - Update material creation:
     - If `tileManager.getMaterial` exists and returns a material → use it directly per segment.
     - Else use current `MeshBasicMaterial({ map: tileTexture })` path for JPG.
   - Keep geometry/UVs unchanged.

3. `src/main.js`
   - Construct `TileManager` with desired source (temporary hardcoded, later promote to UI):
     - Example: `new TileManager({ source: 'ktx2-planes', fps: 30, mode: 'waves' })`.
  - After `loadAllTiles()`, no playback call is needed.
  - In render loop: `tileManager.tick(performance.now())`.
  - No UI buttons are required for cycling.

4. Public assets
   - Ensure `public/wasm/` contains the required transcoder files.
   - No package changes required beyond current `three` dependency.

## Cycling details
- State per TileManager (shared across all materials):
  - `currentLayer = 0`, `layerCount` set from first KTX2 texture.
  - `direction = 1` for ping-pong when source is `ktx2-planes`.
  - Fixed internal cadence (e.g., 30 fps) used to advance frames; no external controls.
- tick(nowMs):
  - If `layerCount <= 1` → return.
  - On frame interval pass, update `currentLayer`:
    - waves (source = `ktx2-waves`): `(currentLayer + 1) % layerCount`
    - planes (source = `ktx2-planes`): ping-pong with `direction` switching at endpoints
  - Update the shared `uLayer` uniform used by all materials.

## Performance considerations
- Share `uLayer` uniform object across all materials to minimize per-frame updates.
- Avoid mipmap generation unless KTX2 provides mip levels.
- Use `LinearFilter` for `minFilter` and `magFilter` initially.
- Keep `DoubleSide` due to ribbon visibility; can revisit if backface culling is acceptable.
- Reuse materials; dispose correctly when clearing/rebuilding ribbons.

## Edge cases and fallbacks
- WebGL2 absent (sampler2DArray requires WebGL2): auto fallback to JPG; notify in console.
- KTX2 transcoder missing: auto fallback.
- Mixed depth across files: clamp to min common `layerCount` and warn.
- Very large arrays or high fps: allow user to lower fps; ensure frame interval logic is time-based, not frame-based.

## Testing and acceptance criteria
- When KTX2 mode is enabled and WebGL2 is available:
  - The app loads without errors, logs detected `layerCount`.
  - Ribbon renders with materials sampling `sampler2DArray`.
  - `ktx2-waves` source loops layers; `ktx2-planes` source ping-pongs.
  - Cycling runs continuously without user controls.
- When KTX2 not available:
  - App gracefully falls back to JPGs and renders as today.

## Future: WebGPU parity (optional)
- Add a `TileManagerWebGPU` or feature flag to use Three.js NodeMaterial + WebGPU renderer, mirroring the provided WebGPU excerpt. Reuse the same playback API and shared `layerUniform`.

## Work breakdown (milestones)
1. KTX2 loader wiring + transcoder assets in `public/wasm/`.
2. TileManager refactor to dual-source (JPG/KTX2) with playback API.
3. Ribbon material selection (KTX2 vs JPG) and disposal hygiene.
4. Render loop integration for cycling.
5. Fallbacks and logging; smoke test on browsers.
6. Optional UI toggles for mode/fps.

## Notes
- Three.js version should support `KTX2Loader` and sampler2DArray in WebGL2; keep Three up to date.
- Vite serves `public/` statics at site root, so `./wasm/` is a good relative path at runtime.
