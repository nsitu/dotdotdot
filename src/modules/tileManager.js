import * as THREE from 'three';
import * as THREE_WEBGPU from 'three/webgpu';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

// TSL imports for WebGPU materials
import { texture, uniform, uv, float, vec2 } from 'three/tsl';

export class TileManager {
    constructor(options = {}) {
        const {
            source = 'jpg',
            renderer = null,
            rendererType = 'webgl',
            tileCount = 32,
            rotate90 = false
        } = options;

        // General
        this.tileCount = tileCount;
        this.tileSize = 512;
        this.loadedCount = 0;
        this.renderer = renderer;
        this.rendererType = rendererType; // Store renderer type for material creation

        // JPG path
        this.tiles = [];

        // KTX2 path
        this.materials = [];
        this.isKTX2 = typeof source === 'string' && source.startsWith('ktx2');
        this.variant = this.isKTX2 ? (source.endsWith('planes') ? 'planes' : 'waves') : null;
        this.folder = this.isKTX2
            ? (this.variant === 'planes' ? './tiles-ktx2-planes' : './tiles-ktx2-waves')
            : './tiles-numbered';

        // Cycling state (KTX2 only)
        this.sharedLayerUniform = { value: 0 };
        this.sharedRotateUniform = { value: rotate90 ? 1 : 0 };
        this.currentLayer = 0;
        this.layerCount = 0;
        this.direction = 1; // for ping-pong in planes mode
        this.fps = 30; // fixed cadence
        this.lastFrameTime = 0;
        this.rotate90 = !!rotate90;

        // WebGPU material mode: 'node' (NodeMaterial) or 'basic' (MeshBasicMaterial)
        // Can be set externally (e.g., via URL param) before loading tiles.
        this.webgpuMaterialMode = options.webgpuMaterialMode || 'node';

        this._ktx2Loader = null;
    }

    async loadAllTiles() {
        if (this.isKTX2) {
            const ok = await this.#initKTX2();
            if (!ok) {
                console.warn('[TileManager] Falling back to JPG textures');
                this.isKTX2 = false;
            }
        }

        const promises = [];
        for (let i = 0; i < this.tileCount; i++) {
            promises.push(this.isKTX2 ? this.#loadKTX2Tile(i) : this.#loadJPGTile(i));
        }

        const results = await Promise.all(promises);

        if (this.isKTX2) {
            this.materials = results;
            console.log(`[TileManager] Loaded ${this.materials.length} KTX2 materials, layerCount=${this.layerCount}`);
            return this.materials;
        } else {
            this.tiles = results;
            console.log(`[TileManager] Loaded ${this.tiles.length} JPG textures`);
            return this.tiles;
        }
    }

    async #initKTX2() {
        // For WebGL: Require WebGL2 for sampler2DArray
        if (this.rendererType === 'webgl') {
            const gl2 = document.createElement('canvas').getContext('webgl2');
            if (!gl2) {
                console.warn('[TileManager] WebGL2 not available; cannot use KTX2 array textures');
                return false;
            }
        }

        try {
            // Use the same KTX2Loader for both renderer types
            this._ktx2Loader = new KTX2Loader();
            this._ktx2Loader.setTranscoderPath('./wasm/');

            if (this.renderer) {
                // Use async detection for WebGPU, sync for WebGL
                if (this.rendererType === 'webgpu') {
                    // CRITICAL: For WebGPU, we must ensure the backend is ready
                    // The renderer should already be initialized via renderer.init()
                    console.log('[TileManager] Detecting WebGPU support for KTX2...');
                    await this._ktx2Loader.detectSupportAsync(this.renderer);
                    console.log('[TileManager] WebGPU KTX2 support detected');
                } else {
                    this._ktx2Loader.detectSupport(this.renderer);
                }
            } else {
                // Best-effort: create a temporary renderer to detect support
                const tempRenderer = new THREE.WebGLRenderer({ antialias: false });
                this._ktx2Loader.detectSupport(tempRenderer);
                tempRenderer.dispose();
            }
            return true;
        } catch (err) {
            console.error('[TileManager] Failed to initialize KTX2Loader:', err);
            return false;
        }
    }

    #createArrayMaterial(arrayTexture) {
        if (this.rendererType === 'webgpu') {
            return this.#createArrayMaterialWebGPU(arrayTexture);
        } else {
            return this.#createArrayMaterialWebGL(arrayTexture);
        }
    }

    #createArrayMaterialWebGL(arrayTexture) {
        const layerCount = arrayTexture.image?.depth || 1;

        const material = new THREE.ShaderMaterial({
            glslVersion: THREE.GLSL3,
            uniforms: {
                uTexArray: { value: arrayTexture },
                uLayer: this.sharedLayerUniform,
                uLayerCount: { value: layerCount },
                uRotate90: this.sharedRotateUniform
            },
            vertexShader: /* glsl */`
                out vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: /* glsl */`
                precision highp float;
                precision highp sampler2DArray;
                in vec2 vUv;
                uniform sampler2DArray uTexArray;
                uniform int uLayer;
                uniform int uRotate90;
                out vec4 outColor;
                void main() {
                    // Optionally rotate by 90 degrees (clockwise), then flip V
                    vec2 uv0 = vUv;
                    vec2 uvR = (uRotate90 == 1) ? vec2(uv0.y, 1.0 - uv0.x) : uv0;
                    vec2 flippedUv = vec2(uvR.x, 1.0 - uvR.y);
                    outColor = texture(uTexArray, vec3(flippedUv, float(uLayer)));
                }
            `,
            transparent: false,
            depthWrite: true,
            side: THREE.DoubleSide
        });

        return material;
    }

    #createArrayMaterialWebGPU(arrayTexture) {
        const layerCount = arrayTexture.image?.depth || 1;

        // Simple fallback path: use a non-array texture in a MeshBasicMaterial
        // for debugging, instead of the KTX2 array texture.
        if (this.webgpuMaterialMode === 'basic') {
            const debugTex = new THREE.CanvasTexture(Object.assign(
                document.createElement('canvas'),
                {
                    width: 2,
                    height: 2
                }
            ));
            const ctx = debugTex.image.getContext('2d');
            ctx.fillStyle = '#ff00ff';
            ctx.fillRect(0, 0, 2, 2);
            debugTex.needsUpdate = true;

            const basicMat = new THREE.MeshBasicMaterial({
                map: debugTex,
                side: THREE.DoubleSide
            });

            console.log('[TileManager] WebGPU BASIC debug material created (non-array texture)', {
                layerCount,
                textureDepth: arrayTexture.image?.depth,
                textureFormat: arrayTexture.format
            });

            return basicMat;
        }

        // Create uniforms for layer and rotation
        const layerUniform = uniform(this.sharedLayerUniform.value);
        const rotateUniform = uniform(this.sharedRotateUniform.value);

        // Get base UV coordinates
        const baseUV = uv();

        // Step 1: Optionally rotate by 90 degrees clockwise
        // Rotation: (x, y) → (y, 1 - x)
        // Using TSL's select() for conditional: condition.select(valueIfTrue, valueIfFalse)
        const rotatedUV = rotateUniform.equal(1).select(
            // If rotate is enabled: create vec2(y, 1-x)
            vec2(baseUV.y, float(1).sub(baseUV.x)),
            // If rotate is disabled: keep original UV
            baseUV
        );

        // Step 2: Flip V coordinate to match texture orientation
        // Flip: (x, y) → (x, 1 - y)
        const flippedUV = rotatedUV.toVar().setY(float(1).sub(rotatedUV.y));

        // Create NodeMaterial with texture array sampling using .depth()
        const material = new THREE_WEBGPU.NodeMaterial();
        material.colorNode = texture(arrayTexture, flippedUV).depth(layerUniform);
        material.transparent = false;
        material.depthWrite = true;
        material.side = THREE.DoubleSide;

        // Store references to uniforms for updates
        material._layerUniform = layerUniform;
        material._rotateUniform = rotateUniform;

        console.log('[TileManager] WebGPU material created:', {
            layerCount,
            textureDepth: arrayTexture.image?.depth,
            textureFormat: arrayTexture.format,
            rotate90: this.rotate90
        });

        return material;
    }

    /**
     * Toggle WebGPU material mode between 'node' (NodeMaterial) and 'basic' (MeshBasicMaterial).
     * This only affects newly created materials; existing meshes keep their current material.
     */
    setWebGPUMaterialMode(mode) {
        if (mode !== 'node' && mode !== 'basic') return;
        if (this.rendererType !== 'webgpu') return;

        if (this.webgpuMaterialMode !== mode) {
            console.log('[TileManager] Switching WebGPU material mode to', mode);
        }
        this.webgpuMaterialMode = mode;
    }

    async #loadKTX2Tile(index) {
        return new Promise((resolve, reject) => {
            if (!this._ktx2Loader) {
                reject(new Error('KTX2Loader not initialized'));
                return;
            }

            const url = `${this.folder}/${index}.ktx2`;
            this._ktx2Loader.load(
                url,
                (arrayTexture) => {
                    // Configure array texture
                    arrayTexture.flipY = false; // shader flips V
                    arrayTexture.generateMipmaps = false;
                    const hasMips = Array.isArray(arrayTexture.mipmaps) && arrayTexture.mipmaps.length > 1;
                    arrayTexture.minFilter = hasMips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
                    arrayTexture.magFilter = THREE.LinearFilter;
                    arrayTexture.wrapS = THREE.ClampToEdgeWrapping;
                    arrayTexture.wrapT = THREE.ClampToEdgeWrapping;

                    // Set color space for WebGL to match WebGPU brightness
                    if (this.rendererType === 'webgl') {
                        arrayTexture.colorSpace = THREE.LinearSRGBColorSpace;
                    }

                    if (this.layerCount === 0) {
                        this.layerCount = arrayTexture.image?.depth || 1;
                        // Reset cycling state
                        this.currentLayer = 0;
                        this.direction = 1;
                        this.sharedLayerUniform.value = 0;
                    } else {
                        const depth = arrayTexture.image?.depth || 1;
                        if (depth !== this.layerCount) {
                            console.warn(`[TileManager] Tile ${index} depth (${depth}) != layerCount (${this.layerCount}); will clamp when cycling`);
                        }
                    }

                    const material = this.#createArrayMaterial(arrayTexture);
                    resolve(material);
                },
                undefined,
                (error) => {
                    console.error(`[TileManager] Failed to load KTX2 tile ${index}:`, error);
                    console.error(`[TileManager] Error details:`, {
                        message: error?.message,
                        stack: error?.stack,
                        name: error?.name,
                        errorString: String(error)
                    });
                    // Create a fallback solid-color material to keep app running
                    const fallback = new THREE.MeshBasicMaterial({ color: new THREE.Color(`hsl(${index * 11}, 70%, 50%)`) });
                    resolve(fallback);
                }
            );
        });
    }

    async #loadJPGTile(index) {
        return new Promise((resolve, reject) => {
            const loader = new THREE.TextureLoader();
            loader.load(
                `./tiles-numbered/${index}.jpg`,
                (texture) => {
                    texture.wrapS = THREE.RepeatWrapping;
                    texture.wrapT = THREE.RepeatWrapping;
                    texture.minFilter = THREE.LinearFilter;
                    texture.magFilter = THREE.LinearFilter;

                    // Set color space for WebGL to match WebGPU brightness
                    if (this.rendererType === 'webgl') {
                        texture.colorSpace = THREE.LinearSRGBColorSpace;
                    }

                    resolve(texture);
                },
                undefined,
                (error) => {
                    console.error(`Failed to load tile ${index}:`, error);
                    // Create a fallback colored texture
                    const canvas = document.createElement('canvas');
                    canvas.width = canvas.height = this.tileSize;
                    const ctx = canvas.getContext('2d');
                    ctx.fillStyle = `hsl(${index * 11}, 70%, 50%)`;
                    ctx.fillRect(0, 0, this.tileSize, this.tileSize);
                    const fallbackTexture = new THREE.CanvasTexture(canvas);
                    resolve(fallbackTexture);
                }
            );
        });
    }

    getTile(index) {
        const tile = this.tiles[index % this.tileCount];
        // console.log('[TileManager] getTile', index, {
        //     tileExists: !!tile,
        //     totalTiles: this.tiles.length
        // });
        return tile;
    }

    getMaterial(index) {
        if (!this.isKTX2) return undefined;
        const material = this.materials[index % this.tileCount];
        // console.log('[TileManager] getMaterial', index, {
        //     isKTX2: this.isKTX2,
        //     materialExists: !!material,
        //     materialType: material?.constructor?.name || 'undefined'
        // });
        return material;
    }

    getTileSequence(startIndex, count) {
        const sequence = [];
        for (let i = 0; i < count; i++) {
            sequence.push(this.getTile(startIndex + i));
        }
        return sequence;
    }

    getLayerCount() {
        return this.layerCount || 0;
    }

    tick(nowMs) {
        if (!this.isKTX2 || this.layerCount <= 1) return;

        if (this.lastFrameTime === 0) this.lastFrameTime = nowMs;
        const elapsed = nowMs - this.lastFrameTime;
        const frameInterval = 1000 / this.fps;

        if (elapsed >= frameInterval) {
            this.lastFrameTime = nowMs;

            if (this.variant === 'waves') {
                this.currentLayer = (this.currentLayer + 1) % this.layerCount;
            } else {
                // planes: ping-pong
                this.currentLayer += this.direction;
                if (this.currentLayer >= this.layerCount - 1) {
                    this.currentLayer = this.layerCount - 1;
                    this.direction = -1;
                } else if (this.currentLayer <= 0) {
                    this.currentLayer = 0;
                    this.direction = 1;
                }
            }

            // Update shared uniform (clamped)
            const clamped = Math.max(0, Math.min(this.currentLayer, Math.max(0, this.layerCount - 1)));
            this.sharedLayerUniform.value = clamped | 0; // ensure int

            // For WebGPU, also update TSL uniform nodes
            if (this.rendererType === 'webgpu') {
                this.materials.forEach(material => {
                    if (material._layerUniform) {
                        material._layerUniform.value = clamped;
                    }
                });
            }
        }
    }

    /**
     * Enable or disable a 90-degree UV rotation for KTX2 materials to adjust tile alignment.
     * @param {boolean} flag
     */
    setRotate90(flag) {
        this.rotate90 = !!flag;
        this.sharedRotateUniform.value = this.rotate90 ? 1 : 0;

        // For WebGPU, also update TSL uniform nodes
        if (this.rendererType === 'webgpu') {
            this.materials.forEach(material => {
                if (material._rotateUniform) {
                    material._rotateUniform.value = this.rotate90 ? 1 : 0;
                }
            });
        }
    }
}