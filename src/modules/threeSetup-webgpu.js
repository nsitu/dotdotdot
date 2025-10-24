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

    return {
        scene,
        camera,
        renderer,
        controls,
        resetCamera,
        rendererType: 'webgpu'
    };
}
