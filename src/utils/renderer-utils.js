/**
 * Renderer Utilities
 * Functions for selecting and managing WebGL/WebGPU renderers
 */

/**
 * Choose appropriate renderer based on WebGPU availability
 * Prefers WebGPU if available (better format support, especially ASTC arrays on Android)
 * Falls back to WebGL if WebGPU unavailable or initialization fails
 * Returns the renderer type string to be used in the application
 * 
 * @returns {Promise<string>} 'webgpu' or 'webgl'
 */
export async function chooseRenderer() {
    const params = new URLSearchParams(window.location.search);
    const forceRenderer = (params.get('renderer') || '').toLowerCase();

    // Check WebGPU availability
    const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;

    let rendererType = 'webgl'; // default fallback

    if (forceRenderer === 'webgpu') {
        rendererType = 'webgpu';
    } else if (forceRenderer === 'webgl') {
        rendererType = 'webgl';
    } else {
        // Auto-detect: prefer WebGPU if available (fixes ASTC array issues on Android)
        rendererType = hasWebGPU ? 'webgpu' : 'webgl';
    }

    console.log('[Renderer] chosen=', rendererType, '| hasWebGPU=', hasWebGPU, '| force=', forceRenderer || 'auto');

    if (rendererType === 'webgpu') {
        console.log('[Renderer] Using WebGPU - Better support for ASTC textures on Android');
    } else {
        console.log('[Renderer] Using WebGL - Standard fallback renderer');
    }

    return rendererType;
}
