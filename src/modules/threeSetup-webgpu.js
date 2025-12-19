import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import WebGPU from 'three/addons/capabilities/WebGPU.js';

/**
 * Initialize Three.js with WebGPU renderer
 * @returns {Promise<Object>} { scene, camera, renderer, controls, resetCamera, rendererType }
 */
export async function initThreeWebGPU() {
    // Check WebGPU availability
    if (!WebGPU.isAvailable()) {
        throw new Error('WebGPU not available');
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e); // Dark blue background as fallback

    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 0, 10);

    // Create WebGPU renderer
    const renderer = new THREE.WebGPURenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);

    // CRITICAL: Wait for WebGPU backend to initialize
    await renderer.init();

    document.body.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    // Function to reset camera view to initial position
    function resetCamera() {
        // Reset to initial position and orientation
        camera.position.set(0, 0, 10);
        camera.lookAt(0, 0, 0);
        controls.reset();
        controls.update();
    }

    console.log('[ThreeSetup] WebGPU renderer initialized');

    /**
     * Create an ambient gradient background
     * @param {THREE.Material} material - Material to sample colors from (unused for now)
     */
    async function createSkySphere(material) {
        console.log('[ThreeSetup] Creating gradient background...');

        // Create a canvas gradient for background
        const canvas = document.createElement('canvas');
        canvas.width = 2;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');

        // Create vertical gradient
        const gradient = ctx.createLinearGradient(0, 0, 0, 256);
        gradient.addColorStop(0, '#533483');   // Top - Purple
        gradient.addColorStop(0.4, '#0f3460'); // Upper middle - Blue
        gradient.addColorStop(0.7, '#16213e'); // Lower middle - Darker blue
        gradient.addColorStop(1, '#1a1a2e');   // Bottom - Dark blue

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 2, 256);

        // Create texture and set as scene background
        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        scene.background = texture;

        console.log('[ThreeSetup] Gradient background set');
        return null;
    }

    return {
        scene,
        camera,
        renderer,
        controls,
        resetCamera,
        createSkySphere,
        rendererType: 'webgpu'
    };
}
