import './style.css'
import { initThree } from './modules/threeSetup.js';
import { chooseRenderer } from './utils/renderer-utils.js';
import {
  importSvgBtn,
  drawToggleBtn,
  viewToggleBtn,
  truncateToggleBtn,
  startAppBtn,
  restartLoopBtn,
  backendToggleBtn,
  materialModeToggleBtn,
  replayDrawingBtn,
  replayPrevBtn,
  replayNextBtn,
  clearDrawingsBtn,
  fileInput,
  checkerboardDiv,
  welcomeScreen,
  drawCanvas,
  rendererIndicator
} from './modules/domElements.js';
import { loadSvgPath, parseSvgContent, normalizePoints } from './modules/svgPathToPoints.js';
import { Ribbon } from './modules/ribbon.js';
import { DrawingManager } from './modules/drawing.js';
import { TileManager } from './modules/tileManager.js';
import * as THREE from 'three';

let scene, camera, renderer, controls, resetCamera, rendererType;

let tileManager;
let isDrawingMode = false;
let ribbon = null;
let drawingManager;
let testCube = null;
// Determine backend preference from URL (?backend=webgl|auto)
const urlParams = new URL(window.location.href).searchParams;
const backendParam = urlParams.get('backend');
const materialParam = urlParams.get('material'); // 'node' | 'basic'
let useWebGLOnly = backendParam === 'webgl'; // quick backend toggle flag
let currentRenderLoop = null; // for restartable WebGL loop

// --- Point Capture/Replay for Debugging (Experiment 1) ---
let capturedDrawings = []; // Array of {id, timestamp, points, rendererType, success}
let drawingCounter = 0;
let historyIndex = -1; // Current position in history (-1 means no selection, will show latest on first replay)
const CAPTURED_DRAWINGS_KEY = 'dotdotdot_capturedDrawings';

// Load any previously captured drawings from localStorage
try {
  const stored = localStorage.getItem(CAPTURED_DRAWINGS_KEY);
  if (stored) {
    capturedDrawings = JSON.parse(stored);
    console.log(`[PointCapture] Loaded ${capturedDrawings.length} drawings from localStorage`);
  }
} catch (e) {
  console.warn('[PointCapture] Failed to load from localStorage:', e);
}

// Initialize app after user clicks start button
startAppBtn.addEventListener('click', async () => {
  startAppBtn.textContent = 'Initializing...';
  startAppBtn.disabled = true;

  try {
    // Choose renderer type (WebGPU preferred, WebGL fallback),
    // unless forced to WebGL-only via toggle flag.
    rendererType = useWebGLOnly ? 'webgl' : await chooseRenderer();
    console.log(`[App] Using renderer: ${rendererType}`);

    // Initialize Three.js with chosen renderer
    const threeContext = await initThree(rendererType);
    scene = threeContext.scene;
    camera = threeContext.camera;
    renderer = threeContext.renderer;
    controls = threeContext.controls;
    resetCamera = threeContext.resetCamera;
    rendererType = threeContext.rendererType; // Actual renderer used (may differ if fallback occurred)

    // Set initial state to view mode
    setDrawingMode(false);

    console.log(`[App] Three.js initialized with ${rendererType}`);

    startAppBtn.textContent = 'Loading textures...';

    // Update renderer indicator
    rendererIndicator.textContent = rendererType.toUpperCase();
    rendererIndicator.className = `renderer-indicator ${rendererType}`;

    // Initialize tile manager 
    //(use KTX2 arrays by default; 
    // choose waves for loop or planes for ping-pong)
    // source: 'ktx2-waves' or 'ktx2-planes' or 'jpg'
    tileManager = new TileManager({
      source: 'ktx2-planes',
      renderer,
      rendererType,
      rotate90: true,
      webgpuMaterialMode: materialParam === 'basic' ? 'basic' : 'node'
    });
    await tileManager.loadAllTiles();

    // Hide welcome screen
    welcomeScreen.style.display = 'none';
    // Show app buttons by adding a class to body
    document.body.classList.add('app-active');
    // Initialize ribbon
    await initializeRibbon();
    // Add persistent reference cube
    addPersistentTestCube();
    // Initialize drawing manager
    drawingManager = new DrawingManager(drawCanvas, handleDrawingComplete);

    // Start render loop
    startRenderLoop();
  } catch (error) {
    console.error('Error starting application:', error);
    startAppBtn.textContent = 'Failed to load. Try again?';
    startAppBtn.disabled = false;
  }
});

// Add a persistent cube at the origin so we can tell if
// the 3D scene is being rendered, independent of the ribbon.
function addPersistentTestCube() {
  if (!scene) return;
  if (testCube) {
    scene.remove(testCube);
    testCube.geometry?.dispose?.();
    testCube.material?.dispose?.();
    testCube = null;
  }

  const geometry = new THREE.BoxGeometry(0.5, 0.5, 0.5);
  const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
  testCube = new THREE.Mesh(geometry, material);
  testCube.position.set(0, 0, 0);
  scene.add(testCube);

  console.log('[Main] Persistent test cube added');
}

// --- UI toggle for drawing mode ---
function setDrawingMode(enableDrawing) {
  // console.log('[Main] setDrawingMode', {
  //   enableDrawing,
  //   drawingManagerActive: !!drawingManager,
  //   controlsEnabled: controls?.enabled
  // });

  // Update the mode state
  isDrawingMode = enableDrawing;
  // Enable/disable orbit controls
  controls.enabled = !enableDrawing;
  // Configure drawing canvas interaction
  drawingManager?.setActive(enableDrawing);
  // Show/hide UI elements
  checkerboardDiv.style.display = enableDrawing ? 'block' : 'none';
  renderer.domElement.style.opacity = enableDrawing ? '0' : '1';
  // Update button styles
  drawToggleBtn.classList.toggle('active-mode', enableDrawing);
  viewToggleBtn.classList.toggle('active-mode', !enableDrawing);

  // console.log('[Main] Drawing mode updated', {
  //   isDrawingMode,
  //   canvasPointerEvents: drawCanvas.style.pointerEvents,
  //   rendererOpacity: renderer.domElement.style.opacity
  // });
}

drawToggleBtn.addEventListener('click', () => setDrawingMode(true));
viewToggleBtn.addEventListener('click', () => setDrawingMode(false));

// Debug / test controls
if (restartLoopBtn) {
  restartLoopBtn.addEventListener('click', () => {
    console.log('[UI] Restart Loop button clicked');
    restartRenderLoop();
  });
}

if (backendToggleBtn) {
  backendToggleBtn.addEventListener('click', () => {
    // Toggle desired backend flag
    useWebGLOnly = !useWebGLOnly;
    const mode = useWebGLOnly ? 'webgl' : 'auto';
    backendToggleBtn.textContent = useWebGLOnly ? 'Backend: WebGL-only' : 'Backend: Auto/WebGPU';
    console.log('[UI] Backend toggle changed', { useWebGLOnly, mode });

    // Update URL with backend query param and reload via location
    const url = new URL(window.location.href);
    url.searchParams.set('backend', mode);
    window.location.href = url.toString();
  });

  // Initialize button label based on current URL setting
  backendToggleBtn.textContent = useWebGLOnly
    ? 'Backend: WebGL-only'
    : 'Backend: Auto/WebGPU';
}

if (materialModeToggleBtn) {
  materialModeToggleBtn.addEventListener('click', () => {
    if (rendererType !== 'webgpu') return;

    const current = materialParam === 'basic' ? 'basic' : 'node';
    const newMode = current === 'node' ? 'basic' : 'node';
    console.log('[UI] Material mode toggle requested', { newMode });

    // Update URL with material query param and reload via location
    const url = new URL(window.location.href);
    url.searchParams.set('material', newMode);
    window.location.href = url.toString();
  });

  // Initialize label
  const initialMode = materialParam === 'basic' ? 'basic' : 'node';
  materialModeToggleBtn.textContent = initialMode === 'node' ? 'Material: Node' : 'Material: Basic';
}

// --- Replay Drawing Button (Experiment 1) ---
// Helper to update button labels with current position
function updateHistoryUI() {
  if (replayDrawingBtn) {
    if (capturedDrawings.length === 0) {
      replayDrawingBtn.textContent = 'History (0)';
    } else if (historyIndex < 0) {
      replayDrawingBtn.textContent = `History (${capturedDrawings.length})`;
    } else {
      replayDrawingBtn.textContent = `${historyIndex + 1}/${capturedDrawings.length}`;
    }
  }
}

// Helper to replay a specific drawing by index
function replayDrawingAtIndex(index) {
  if (capturedDrawings.length === 0) {
    console.warn('[PointCapture] No captured drawings to replay');
    return false;
  }

  // Clamp index to valid range
  index = Math.max(0, Math.min(index, capturedDrawings.length - 1));
  historyIndex = index;

  const drawing = capturedDrawings[index];
  console.log(`[PointCapture] Replaying drawing #${drawing.id} (${index + 1}/${capturedDrawings.length})`, {
    pointCount: drawing.points.length,
    originalRenderer: drawing.rendererType,
    currentRenderer: rendererType,
    originalSuccess: drawing.success,
    timestamp: drawing.timestamp
  });

  // Replay the drawing through the same pipeline
  if (ribbon && drawing.points.length >= 2) {
    resetCamera();
    const result = ribbon.createRibbonFromDrawing(drawing.points);
    const replaySuccess = ribbon.meshSegments?.length > 0;
    console.log(`[PointCapture] Replay result: ${replaySuccess ? 'SUCCESS' : 'FAILED'}`, {
      segmentCount: ribbon.meshSegments?.length || 0,
      originalSuccess: drawing.success
    });

    // Force render
    if (renderer && scene && camera) {
      renderer.render(scene, camera);
    }
  }

  updateHistoryUI();
  return true;
}

if (replayDrawingBtn) {
  replayDrawingBtn.addEventListener('click', () => {
    if (capturedDrawings.length === 0) {
      alert('No captured drawings available. Draw something first!');
      return;
    }

    // If no current selection, start at the most recent
    if (historyIndex < 0) {
      historyIndex = capturedDrawings.length - 1;
    }
    replayDrawingAtIndex(historyIndex);
  });
}

// --- History Navigation Buttons ---
if (replayPrevBtn) {
  replayPrevBtn.addEventListener('click', () => {
    if (capturedDrawings.length === 0) {
      alert('No captured drawings available.');
      return;
    }
    // Move backward in history
    if (historyIndex < 0) {
      historyIndex = capturedDrawings.length - 1; // Start at end if not set
    } else if (historyIndex > 0) {
      historyIndex--;
    } else {
      console.log('[PointCapture] Already at oldest drawing');
      return; // Already at the beginning
    }
    replayDrawingAtIndex(historyIndex);
  });
}

if (replayNextBtn) {
  replayNextBtn.addEventListener('click', () => {
    if (capturedDrawings.length === 0) {
      alert('No captured drawings available.');
      return;
    }
    // Move forward in history
    if (historyIndex < 0) {
      historyIndex = 0; // Start at beginning if not set
    } else if (historyIndex < capturedDrawings.length - 1) {
      historyIndex++;
    } else {
      console.log('[PointCapture] Already at newest drawing');
      return; // Already at the end
    }
    replayDrawingAtIndex(historyIndex);
  });
}

// --- Clear Drawings Button ---
if (clearDrawingsBtn) {
  clearDrawingsBtn.addEventListener('click', () => {
    const count = capturedDrawings.length;
    capturedDrawings = [];
    drawingCounter = 0;
    historyIndex = -1;
    try {
      localStorage.removeItem(CAPTURED_DRAWINGS_KEY);
      console.log(`[PointCapture] Cleared ${count} captured drawings`);
      alert(`Cleared ${count} captured drawings`);
    } catch (e) {
      console.warn('[PointCapture] Failed to clear localStorage:', e);
    }
    updateHistoryUI();
  });
}

// Initialize history UI on page load
updateHistoryUI();

// Truncate toggle button
truncateToggleBtn.addEventListener('click', () => {
  if (ribbon) {
    ribbon.truncateSegments = !ribbon.truncateSegments;
    // Update button appearance
    truncateToggleBtn.classList.toggle('active', ribbon.truncateSegments);
    // Rebuild the ribbon with the new setting
    if (ribbon.lastPoints.length >= 2) {
      ribbon.buildFromPoints(ribbon.lastPoints, ribbon.lastWidth);
    }
  }
});



// --- Ribbon builder with animated undulation ---
function updateAnimatedRibbon(time) {
  if (ribbon) {
    // ribbon.update(time);
  }
}

async function initializeRibbon() {
  try {
    // Create the ribbon instance
    ribbon = new Ribbon(scene);
    // Set the tile manager instead of texture
    ribbon.setTileManager(tileManager);
    // Set initial button state
    truncateToggleBtn.classList.toggle('active', ribbon.truncateSegments);
    // Try to load the SVG path
    const svgPoints = await loadSvgPath('./R.svg', 80, 5, 0);
    if (svgPoints && svgPoints.length >= 2) {
      // Use the normalizePoints function to scale and center
      const normalizedPoints = normalizePoints(svgPoints);
      // Reset camera before building the initial ribbon
      resetCamera();
      ribbon.buildFromPoints(normalizedPoints, 1.2);
    } else {
      console.error("Could not extract points from the SVG file.");
    }
  } catch (error) {
    console.error("Error initializing ribbon from SVG:", error);
  }
}

function resizeCanvas() {

  if (drawingManager) {
    drawingManager.resize(window.innerWidth, window.innerHeight);
  }
  if (renderer && camera) {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }

}

// Handle orientation changes with multiple approaches for better mobile support
function handleOrientationChange() {
  // Debug logging for orientation changes (remove in production if needed)
  console.log('Orientation change detected:', {
    orientation: screen.orientation?.angle || 'unknown',
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    visual: window.visualViewport ? `${window.visualViewport.width}x${window.visualViewport.height}` : 'not supported'
  });

  // Use a timeout to account for mobile browser timing issues
  // Some browsers need time to update window dimensions after orientation change
  setTimeout(() => {
    resizeCanvas();

    // Also update slit scanner canvas if it exists
    if (slitScanner && slitScanner.canvas) {
      // The slit scanner may need to adjust its dimensions
      // based on the new orientation
      const videoAspect = slitScanner.canvas.width / slitScanner.canvas.height;
      // Keep the existing width but ensure proper display
      slitScanner.texture?.needsUpdate && (slitScanner.texture.needsUpdate = true);
    }

    // Force a re-render to ensure proper display
    if (ribbon) {
      ribbon.update(performance.now() / 1000);
    }
    renderer.render(scene, camera);
  }, 100);

  // Additional timeout for stubborn mobile browsers
  setTimeout(() => {
    resizeCanvas();
    renderer.render(scene, camera);
  }, 300);

  // Also do an immediate resize attempt
  resizeCanvas();
}

// Standard resize event
window.addEventListener('resize', resizeCanvas);

// Orientation change events (multiple approaches for better compatibility)
// Legacy orientationchange event (still widely supported)
window.addEventListener('orientationchange', handleOrientationChange);

// Modern screen orientation API (when available)
if (screen.orientation) {
  screen.orientation.addEventListener('change', handleOrientationChange);
}

// Visual viewport API for more accurate mobile handling (when available)
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', resizeCanvas);
}

// Initial canvas setup
resizeCanvas();

// --- Drawing callback ---
function handleDrawingComplete(points) {
  console.log('[Main] handleDrawingComplete called', {
    pointCount: points.length,
    ribbonExists: !!ribbon,
    sceneExists: !!scene
  });

  // --- Point Capture (Experiment 1) ---
  const drawingId = ++drawingCounter;
  const capturedEntry = {
    id: drawingId,
    timestamp: new Date().toISOString(),
    points: points.map(p => ({ x: p.x, y: p.y })), // Store raw 2D points
    rendererType: rendererType,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    success: null // Will be updated after ribbon creation attempt
  };
  console.log(`[PointCapture] Drawing #${drawingId} captured`, {
    pointCount: points.length,
    firstPoint: points[0],
    lastPoint: points[points.length - 1]
  });
  // Log as copyable JSON for manual replay
  console.log(`[PointCapture] Drawing #${drawingId} JSON:`, JSON.stringify(capturedEntry.points));

  if (points.length >= 2) {
    console.log('[Main] Resetting camera before ribbon creation');
    // Reset camera before building the new ribbon
    resetCamera();

    console.log('[Main] Creating ribbon from drawing points...');
    // Use the ribbon module to create from drawing points
    const result = ribbon.createRibbonFromDrawing(points);
    console.log('[Main] Ribbon creation result:', result ? 'success' : 'undefined');

    console.log('[Main] Post-create state', {
      meshSegments: ribbon.meshSegments?.length || 0,
      sceneChildren: scene.children?.length || 0,
      cameraPos: camera.position
    });

    // --- Update capture entry with success status ---
    capturedEntry.success = ribbon.meshSegments?.length > 0;
    capturedEntry.segmentCount = ribbon.meshSegments?.length || 0;
    capturedDrawings.push(capturedEntry);
    // Keep only last 20 drawings to avoid localStorage bloat
    if (capturedDrawings.length > 20) {
      capturedDrawings = capturedDrawings.slice(-20);
    }
    // Persist to localStorage
    try {
      localStorage.setItem(CAPTURED_DRAWINGS_KEY, JSON.stringify(capturedDrawings));
      console.log(`[PointCapture] Drawing #${drawingId} saved (success=${capturedEntry.success})`);
    } catch (e) {
      console.warn('[PointCapture] Failed to save to localStorage:', e);
    }
    // Reset history index to point to newest and update UI
    historyIndex = capturedDrawings.length - 1;
    updateHistoryUI();

    const showDiagnostics = true; // Set to true to enable detailed logging
    // Automatic diagnostics: log geometry/material stats for current ribbon segments
    if (showDiagnostics && ribbon && Array.isArray(ribbon.meshSegments)) {
      const segmentSummaries = ribbon.meshSegments.map((mesh, index) => {
        if (!mesh) return { index, missing: true };

        const geom = mesh.geometry;
        const mat = mesh.material;

        let positionCount = 0;
        let indexCount = 0;
        let boundingBox = null;
        let boundingSphere = null;

        if (geom) {
          const posAttr = geom.getAttribute('position');
          positionCount = posAttr ? posAttr.count : 0;
          indexCount = geom.index ? geom.index.count : 0;

          try {
            geom.computeBoundingBox();
            geom.computeBoundingSphere();
            boundingBox = geom.boundingBox;
            boundingSphere = geom.boundingSphere;
          } catch (e) {
            console.warn('[Diagnostics] Error computing bounds for segment', index, e);
          }
        }

        let materialInfo = null;
        if (mat) {
          materialInfo = {
            type: mat.type,
            transparent: !!mat.transparent,
            opacity: mat.opacity,
            depthTest: mat.depthTest,
            depthWrite: mat.depthWrite,
            side: mat.side,
            wireframe: !!mat.wireframe,
            map: mat.map
              ? {
                isTexture: !!mat.map.isTexture,
                isRenderTargetTexture: !!mat.map.isRenderTargetTexture,
                name: mat.map.name || null,
                image: mat.map.image
                  ? {
                    width: mat.map.image.width,
                    height: mat.map.image.height
                  }
                  : null
              }
              : null
          };
        }

        return {
          index,
          positionCount,
          indexCount,
          boundingBox,
          boundingSphere,
          materialInfo
        };
      });

      console.log('[Diagnostics] Ribbon diagnostics after drawing', {
        rendererType,
        segmentCount: ribbon.meshSegments.length,
        segmentSummaries,
        rawSegments: ribbon.meshSegments,
        camera: {
          position: camera ? camera.position.clone() : null,
          rotation: camera ? camera.rotation.clone() : null
        },
        sceneChildren: scene.children ? scene.children.length : 0
      });
    }

    // Canvas / renderer visibility + size diagnostics
    if (renderer && renderer.domElement) {
      let rendererSize;
      try {
        rendererSize = renderer.getSize(new THREE.Vector2());
      } catch (e) {
        rendererSize = { x: renderer.domElement.width, y: renderer.domElement.height };
      }

      const dom = renderer.domElement;
      const domStyle = getComputedStyle(dom);

      console.log('[Main] Canvas visibility check', {
        rendererSize,
        domSize: {
          width: dom.width,
          height: dom.height,
          clientWidth: dom.clientWidth,
          clientHeight: dom.clientHeight
        },
        domStyle: {
          display: domStyle.display,
          opacity: domStyle.opacity,
          visibility: domStyle.visibility,
          position: domStyle.position
        },
        checkerboardDisplay: checkerboardDiv ? getComputedStyle(checkerboardDiv).display : 'n/a',
        viewport: {
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          visualWidth: window.visualViewport ? window.visualViewport.width : null,
          visualHeight: window.visualViewport ? window.visualViewport.height : null
        }
      });
    }
  } else {
    console.warn('[Main] Not enough points for ribbon creation');
  }

  // Automatically exit drawing mode (always attempt after a completed drawing)
  console.log('[Main] Exiting drawing mode (forcing false)');
  setDrawingMode(false);

  // Log post-exit visibility state
  if (renderer && renderer.domElement) {
    const dom = renderer.domElement;
    const domStyle = getComputedStyle(dom);
    console.log('[Main] Post-exit drawing mode state', {
      isDrawingMode,
      domStyle: {
        display: domStyle.display,
        opacity: domStyle.opacity,
        visibility: domStyle.visibility
      },
      checkerboardDisplay: checkerboardDiv
        ? getComputedStyle(checkerboardDiv).display
        : 'n/a'
    });
  }

  if (renderer && scene && camera) {
    try {
      console.log('[Main] Forcing immediate render after drawing complete');
      renderer.render(scene, camera);
    } catch (e) {
      console.error('[Main] Error during forced render:', e);
    }
  }

}

// --- Render Loop with animated ribbon ---
function startRenderLoop() {
  // let frameCount = 0;
  // const logInterval = 300; // Log every 300 frames (about every 5 seconds at 60fps)

  if (rendererType === 'webgpu') {
    // WebGPU uses setAnimationLoop
    const loopFn = () => {
      const time = performance.now() / 1000;
      // Advance KTX2 layer cycling (no-op for JPG mode)
      tileManager?.tick?.(performance.now());
      updateAnimatedRibbon(time);
      controls.update();
      renderer.render(scene, camera);

      // Periodic logging
      // if (frameCount % logInterval === 0) {
      //   console.log('[Render] Scene state', {
      //     children: scene.children.length,
      //     ribbonSegments: ribbon?.meshSegments?.length || 0,
      //     camera: {
      //       position: camera.position,
      //       rotation: camera.rotation
      //     }
      //   });
      // }
      // frameCount++;
    };
    renderer.setAnimationLoop(loopFn);
    currentRenderLoop = loopFn;
    console.log('[App] WebGPU animation loop started');
  } else {
    // WebGL uses requestAnimationFrame
    function renderLoop() {
      requestAnimationFrame(renderLoop);
      const time = performance.now() / 1000;
      // Advance KTX2 layer cycling (no-op for JPG mode)
      tileManager?.tick?.(performance.now());
      updateAnimatedRibbon(time);
      controls.update();
      renderer.render(scene, camera);

      // Periodic logging
      // if (frameCount % logInterval === 0) {
      //   console.log('[Render] Scene state', {
      //     children: scene.children.length,
      //     ribbonSegments: ribbon?.meshSegments?.length || 0,
      //     camera: {
      //       position: camera.position,
      //       rotation: camera.rotation
      //     }
      //   });
      // }
      // frameCount++;
    }
    currentRenderLoop = renderLoop;
    renderLoop();
    console.log('[App] WebGL animation loop started');
  }
}

// Simple test hook to restart the animation loop manually.
function restartRenderLoop() {
  if (!renderer || !scene || !camera) return;

  console.log('[Main] Restarting render loop');

  if (rendererType === 'webgpu') {
    renderer.setAnimationLoop(null);
  }
  // For WebGL, currentRenderLoop will simply be replaced on next startRenderLoop call.

  startRenderLoop();
}

// Resource Cleanup
window.addEventListener('beforeunload', () => {
  if (drawingManager) {
    drawingManager.dispose();
  }
});

if (importSvgBtn && fileInput) {
  // Handle import button click
  importSvgBtn.addEventListener('click', () => {
    fileInput.click();
  });

  // Handle file selection
  fileInput.addEventListener('change', async (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];

      try {
        // Read the SVG file content
        const svgText = await file.text();

        // Use our shared parsing function
        const svgPoints = parseSvgContent(svgText, 80, 5, 0);

        if (svgPoints && svgPoints.length >= 2) {
          const normalizedPoints = normalizePoints(svgPoints);
          resetCamera();
          ribbon.buildFromPoints(normalizedPoints, 1.2);
        } else {
          alert('Could not extract points from the SVG file.');
        }
      } catch (error) {
        console.error('Error processing SVG file:', error);
        alert('Error processing SVG file: ' + error.message);
      }

      // Reset file input so the same file can be selected again if needed
      fileInput.value = '';
    }
  });
}
