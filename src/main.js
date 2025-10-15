import './style.css'
import { initThree } from './modules/threeSetup.js';
import {
  importSvgBtn, drawToggleBtn, viewToggleBtn, truncateToggleBtn, startAppBtn,
  fileInput,
  checkerboardDiv,
  welcomeScreen, drawCanvas
} from './modules/domElements.js';
import { loadSvgPath, parseSvgContent, normalizePoints } from './modules/svgPathToPoints.js';
import { Ribbon } from './modules/ribbon.js';
import { DrawingManager } from './modules/drawing.js';
import { TileManager } from './modules/tileManager.js';

const { scene, camera, renderer, controls, resetCamera } = initThree();

let tileManager;
let isDrawingMode = false;
let ribbon = null;
let drawingManager;

// Initialize app after user clicks start button
startAppBtn.addEventListener('click', async () => {
  startAppBtn.textContent = 'Loading textures...';
  startAppBtn.disabled = true;

  try {
    // Initialize tile manager
    tileManager = new TileManager();
    await tileManager.loadAllTiles();

    // Hide welcome screen
    welcomeScreen.style.display = 'none';
    // Show app buttons by adding a class to body
    document.body.classList.add('app-active');
    // Initialize ribbon
    await initializeRibbon();
    // Initialize drawing manager
    drawingManager = new DrawingManager(drawCanvas, handleDrawingComplete);
  } catch (error) {
    console.error('Error starting application:', error);
    startAppBtn.textContent = 'Failed to load textures. Try again?';
    startAppBtn.disabled = false;
  }
});

// --- UI toggle for drawing mode ---
function setDrawingMode(enableDrawing) {
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
}

drawToggleBtn.addEventListener('click', () => setDrawingMode(true));
viewToggleBtn.addEventListener('click', () => setDrawingMode(false));

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

// Set initial state to view mode
setDrawingMode(false);

// --- Ribbon builder with animated undulation ---
function updateAnimatedRibbon(time) {
  if (ribbon) {
    ribbon.update(time);
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
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
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
  if (points.length >= 2) {
    // Reset camera before building the new ribbon
    resetCamera();

    // Use the ribbon module to create from drawing points
    ribbon.createRibbonFromDrawing(points);
  }

  // Automatically exit drawing mode
  if (isDrawingMode) {
    setDrawingMode(false);
  }
}

// --- Render Loop with animated ribbon ---
function renderLoop() {
  requestAnimationFrame(renderLoop);
  const time = performance.now() / 1000;
  updateAnimatedRibbon(time);
  controls.update();
  renderer.render(scene, camera);
}
renderLoop();

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
