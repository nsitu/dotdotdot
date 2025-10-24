import { initThreeWebGL } from './threeSetup-webgl.js';
import { initThreeWebGPU } from './threeSetup-webgpu.js';

/**
 * Factory function to initialize Three.js with appropriate renderer
 * @param {string} rendererType - 'webgl' or 'webgpu'
 * @returns {Promise<Object>} { scene, camera, renderer, controls, resetCamera, rendererType }
 */
export async function initThree(rendererType = 'webgl') {
    console.log(`[ThreeSetup] Initializing ${rendererType.toUpperCase()} renderer`);

    try {
        if (rendererType === 'webgpu') {
            return await initThreeWebGPU();
        } else {
            // WebGL is synchronous but we return it wrapped for consistent API
            return initThreeWebGL();
        }
    } catch (error) {
        console.error(`[ThreeSetup] Failed to initialize ${rendererType}:`, error);

        // If WebGPU fails, fallback to WebGL
        if (rendererType === 'webgpu') {
            console.warn('[ThreeSetup] Falling back to WebGL');
            return initThreeWebGL();
        }

        throw error;
    }
}