import './style.css'
import { initThree } from './modules/threeSetup.js';
import { chooseRenderer } from './utils/renderer-utils.js';
import {
  importSvgBtn,
  drawToggleBtn,
  viewToggleBtn,
  truncateToggleBtn,
  startAppBtn,
  backendToggleBtn,
  materialModeToggleBtn,
  replayDrawingBtn,
  replayPrevBtn,
  replayNextBtn,
  clearDrawingsBtn,
  finishDrawingBtn,
  fullscreenBtn,
  countdownSecondsSpan,
  fileInput,
  checkerboardDiv,
  welcomeScreen,
  drawCanvas,
  rendererIndicator
} from './modules/domElements.js';
import { loadSvgPath, parseSvgContent, normalizePoints, parseSvgContentMultiPath, normalizePointsMultiPath } from './modules/svgPathToPoints.js';
import { Ribbon } from './modules/ribbon.js';
import { RibbonSeries } from './modules/ribbonSeries.js';
import { DrawingManager } from './modules/drawing.js';
import { TileManager } from './modules/tileManager.js';
import * as THREE from 'three';

// Configuration
const RIBBON_RESOLUTION = 500; // Number of points per path - higher = smoother ribbon

let scene, camera, renderer, controls, resetCamera, rendererType;

let tileManager;
let isDrawingMode = false;
let ribbon = null;
let ribbonSeries = null; // For multi-path SVG support
let drawingManager;
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
    // Choose renderer type (WebGPU preferred, WebGL fallback)
    rendererType = await chooseRenderer();
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
    // Default: load from zip file (skating-512.zip)
    // Other options: 'ktx2-planes', 'ktx2-waves', 'jpg', or any zip filename
    tileManager = new TileManager({
      // source: 'skating-512.zip', // This is now the default
      renderer,
      rendererType,
      rotate90: true,
      webgpuMaterialMode: 'node',
      onProgress: (stage, current, total) => {
        if (stage === 'downloading') {
          startAppBtn.textContent = 'Downloading textures...';
        } else if (stage === 'extracting') {
          const percentage = Math.round((current / total) * 100);
          startAppBtn.textContent = `Extracting textures: ${percentage}%`;
        } else if (stage === 'building') {
          const percentage = Math.round((current / total) * 100);
          startAppBtn.textContent = `Building materials: ${percentage}%`;
        }
      }
    });
    await tileManager.loadAllTiles();

    // Create sky sphere for ambient gradient background
    if (threeContext.createSkySphere) {
      try {
        const firstMaterial = tileManager.isKTX2 ? tileManager.getMaterial(0) : null;
        await threeContext.createSkySphere(firstMaterial);
        console.log('[App] Sky sphere created successfully');
      } catch (err) {
        console.error('[App] Failed to create sky sphere:', err);
      }
    }

    // Hide welcome screen
    welcomeScreen.style.display = 'none';
    // Show app buttons by adding a class to body
    document.body.classList.add('app-active');
    // Initialize ribbon
    await initializeRibbon();
    // Initialize drawing manager with multi-stroke callbacks
    drawingManager = new DrawingManager(
      drawCanvas,
      handleDrawingComplete,
      handleStrokeCountChange
    );
    // Set up auto-finalize countdown callback
    drawingManager.onAutoFinalizeCountdown = handleAutoFinalizeCountdown;

    // Start render loop
    startRenderLoop();
  } catch (error) {
    console.error('Error starting application:', error);
    startAppBtn.textContent = 'Failed to load. Try again?';
    startAppBtn.disabled = false;
  }
});

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

  // Show/hide finish drawing button
  if (finishDrawingBtn) {
    finishDrawingBtn.classList.toggle('visible', enableDrawing);
    finishDrawingBtn.disabled = enableDrawing ? (drawingManager?.getStrokeCount() === 0) : true;
    // Clear countdown when exiting drawing mode
    if (!enableDrawing) {
      finishDrawingBtn.classList.remove('counting');
      if (countdownSecondsSpan) countdownSecondsSpan.textContent = '';
    }
  }

  // console.log('[Main] Drawing mode updated', {
  //   isDrawingMode,
  //   canvasPointerEvents: drawCanvas.style.pointerEvents,
  //   rendererOpacity: renderer.domElement.style.opacity
  // });
}

drawToggleBtn.addEventListener('click', () => setDrawingMode(true));
viewToggleBtn.addEventListener('click', () => setDrawingMode(false));

// --- Multi-stroke drawing UI ---
// Handle stroke count changes from DrawingManager
function handleStrokeCountChange(count) {
  console.log('[Main] Stroke count changed:', count);
  if (finishDrawingBtn) {
    finishDrawingBtn.disabled = count === 0;
  }
}

// Handle auto-finalize countdown updates
function handleAutoFinalizeCountdown(seconds, active) {
  if (finishDrawingBtn && countdownSecondsSpan) {
    finishDrawingBtn.classList.toggle('counting', active);
    countdownSecondsSpan.textContent = active ? seconds : '';
  }
}

// Finish drawing button handler
if (finishDrawingBtn) {
  finishDrawingBtn.addEventListener('click', () => {
    if (!drawingManager) return;

    const strokes = drawingManager.finalizeDrawing();
    if (strokes && strokes.length > 0) {
      handleDrawingComplete(strokes);
    } else {
      console.warn('[Main] No strokes to finalize');
    }
  });
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
  // Show/hide delete button based on whether a drawing is selected
  if (clearDrawingsBtn) {
    clearDrawingsBtn.style.display = (historyIndex >= 0 && capturedDrawings.length > 0) ? '' : 'none';
  }
}

// Helper to save drawings to localStorage
function saveDrawingsToStorage() {
  try {
    localStorage.setItem(CAPTURED_DRAWINGS_KEY, JSON.stringify(capturedDrawings));
    return true;
  } catch (e) {
    console.warn('[PointCapture] Failed to save to localStorage:', e);
    return false;
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

// --- Clear Current Drawing Button ---
if (clearDrawingsBtn) {
  clearDrawingsBtn.addEventListener('click', () => {
    if (capturedDrawings.length === 0 || historyIndex < 0) {
      alert('No drawing selected to delete.');
      return;
    }

    const deletedDrawing = capturedDrawings[historyIndex];
    capturedDrawings.splice(historyIndex, 1);

    console.log(`[PointCapture] Deleted drawing #${deletedDrawing.id}`);

    // Adjust history index after deletion
    if (capturedDrawings.length === 0) {
      historyIndex = -1;
    } else if (historyIndex >= capturedDrawings.length) {
      historyIndex = capturedDrawings.length - 1;
    }

    // Persist to localStorage
    try {
      if (capturedDrawings.length > 0) {
        localStorage.setItem(CAPTURED_DRAWINGS_KEY, JSON.stringify(capturedDrawings));
      } else {
        localStorage.removeItem(CAPTURED_DRAWINGS_KEY);
      }
    } catch (e) {
      console.warn('[PointCapture] Failed to save to localStorage:', e);
    }

    updateHistoryUI();

    // If there are remaining drawings, show the one at current index
    if (capturedDrawings.length > 0 && historyIndex >= 0) {
      replayDrawingAtIndex(historyIndex);
    }
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
    // Create the ribbon instance (for drawing - single path)
    ribbon = new Ribbon(scene);
    ribbon.setTileManager(tileManager);

    // Create the ribbon series instance (for SVG - multi-path)
    ribbonSeries = new RibbonSeries(scene);
    ribbonSeries.setTileManager(tileManager);

    // Set initial button state
    truncateToggleBtn.classList.toggle('active', ribbon.truncateSegments);

    // Try to load the SVG path (use multi-path for SVG files)
    const response = await fetch('./jj.svg');
    const svgText = await response.text();
    const pathsPoints = parseSvgContentMultiPath(svgText, RIBBON_RESOLUTION, 5, 0);

    if (pathsPoints && pathsPoints.length > 0) {
      // Use multi-path normalization to keep paths in shared coordinate space
      const normalizedPaths = normalizePointsMultiPath(pathsPoints);
      // Reset camera before building the initial ribbon series
      resetCamera();
      ribbonSeries.buildFromMultiplePaths(normalizedPaths, 1.2);
      console.log(`[App] Loaded SVG with ${pathsPoints.length} path(s), ${ribbonSeries.getTotalSegmentCount()} total segments`);
    } else {
      console.error("Could not extract paths from the SVG file.");
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
function handleDrawingComplete(strokesData) {
  // strokesData is now Array<Array<{x,y}>> for multi-stroke
  // Determine if this is multi-stroke data
  const isMultiStroke = Array.isArray(strokesData) && strokesData.length > 0 && Array.isArray(strokesData[0]);

  console.log('[Main] handleDrawingComplete called', {
    isMultiStroke,
    strokeCount: isMultiStroke ? strokesData.length : 1,
    totalPoints: isMultiStroke
      ? strokesData.reduce((sum, s) => sum + s.length, 0)
      : strokesData.length,
    ribbonExists: !!ribbon,
    ribbonSeriesExists: !!ribbonSeries,
    sceneExists: !!scene
  });

  // --- Point Capture (Experiment 1) ---
  const drawingId = ++drawingCounter;
  const capturedEntry = {
    id: drawingId,
    timestamp: new Date().toISOString(),
    strokes: isMultiStroke ? strokesData : [strokesData], // Always store as array of strokes
    rendererType: rendererType,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    success: null // Will be updated after ribbon creation attempt
  };
  console.log(`[PointCapture] Drawing #${drawingId} captured`, {
    strokeCount: capturedEntry.strokes.length,
    totalPoints: capturedEntry.strokes.reduce((sum, s) => sum + s.length, 0)
  });

  // Reset camera before building the new ribbon(s)
  console.log('[Main] Resetting camera before ribbon creation');
  resetCamera();

  let creationSuccess = false;
  let totalSegments = 0;

  if (isMultiStroke && strokesData.length > 1) {
    // Multi-stroke: use RibbonSeries
    console.log('[Main] Creating ribbon series from', strokesData.length, 'strokes');

    // Clean up existing ribbons
    if (ribbon) ribbon.dispose();
    if (ribbonSeries) ribbonSeries.cleanup();

    // Step 1: Convert all strokes to raw 3D points (NO per-stroke normalization)
    // This preserves the relative spatial arrangement between strokes
    const rawPathsPoints = strokesData.map(stroke =>
      stroke.map(p => new THREE.Vector3(
        p.x,
        -p.y,  // Flip Y to match THREE.js coordinates (screen Y is down, 3D Y is up)
        0
      ))
    ).filter(points => points.length >= 2);

    if (rawPathsPoints.length > 0) {
      // Step 2: Normalize all paths TOGETHER using combined bounding box
      // This preserves relative positions between strokes
      const normalizedPaths = normalizePointsMultiPath(rawPathsPoints);

      // Step 3: Sanitize and smooth each normalized path
      const processedPaths = normalizedPaths.map(points => {
        const sanitized = ribbon.sanitizePoints(points);
        return ribbon.smoothPoints(sanitized, 150);
      }).filter(points => points.length >= 2);

      if (processedPaths.length > 0) {
        // Step 4: Build ribbon series
        ribbonSeries.buildFromMultiplePaths(processedPaths, 1.2);
        totalSegments = ribbonSeries.getTotalSegmentCount();
        creationSuccess = totalSegments > 0;

        console.log('[Main] RibbonSeries creation result:', creationSuccess ? 'success' : 'failed', {
          pathCount: processedPaths.length,
          totalSegments
        });
      }
    }
  } else {
    // Single stroke: use existing Ribbon logic
    const singleStroke = isMultiStroke ? strokesData[0] : strokesData;

    console.log('[Main] Creating single ribbon from', singleStroke.length, 'points');

    // Clean up existing ribbon series
    if (ribbonSeries) ribbonSeries.cleanup();

    const result = ribbon.createRibbonFromDrawing(singleStroke);
    totalSegments = ribbon.meshSegments?.length || 0;
    creationSuccess = totalSegments > 0;

    console.log('[Main] Ribbon creation result:', creationSuccess ? 'success' : 'failed', {
      segmentCount: totalSegments
    });
  }

  // --- Update capture entry with success status ---
  capturedEntry.success = creationSuccess;
  capturedEntry.segmentCount = totalSegments;
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

  // Automatically exit drawing mode
  console.log('[Main] Exiting drawing mode');
  setDrawingMode(false);

  // Force immediate render
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

// --- Fullscreen toggle ---
if (fullscreenBtn) {
  fullscreenBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      // Enter fullscreen
      document.documentElement.requestFullscreen().catch(err => {
        console.warn('[App] Could not enter fullscreen:', err);
      });
    } else {
      // Exit fullscreen
      document.exitFullscreen().catch(err => {
        console.warn('[App] Could not exit fullscreen:', err);
      });
    }
  });

  // Update button icon when fullscreen state changes
  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) {
      fullscreenBtn.title = 'Exit fullscreen';
      fullscreenBtn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"></path>
        </svg>
      `;
    } else {
      fullscreenBtn.title = 'Toggle fullscreen';
      fullscreenBtn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>
        </svg>
      `;
    }
  });
}

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

        // Use multi-path parsing to extract all paths
        const pathsPoints = parseSvgContentMultiPath(svgText, RIBBON_RESOLUTION, 5, 0);

        if (pathsPoints && pathsPoints.length > 0) {
          // Use multi-path normalization to keep paths in shared coordinate space
          const normalizedPaths = normalizePointsMultiPath(pathsPoints);
          resetCamera();

          // Clean up single ribbon if it was used
          if (ribbon) {
            ribbon.dispose();
          }

          // Build ribbon series from all paths
          ribbonSeries.buildFromMultiplePaths(normalizedPaths, 1.2);
          console.log(`[App] Imported SVG with ${pathsPoints.length} path(s), ${ribbonSeries.getTotalSegmentCount()} total segments`);
        } else {
          alert('Could not extract paths from the SVG file.');
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
