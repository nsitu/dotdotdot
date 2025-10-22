import * as THREE from 'three';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

export class TileManager {
    constructor(options = {}) {
        const {
            source = 'jpg',
            renderer = null,
            tileCount = 32,
            rotate90 = false
        } = options;

        // General
        this.tileCount = tileCount;
        this.tileSize = 512;
        this.loadedCount = 0;
        this.renderer = renderer;

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
        // Require WebGL2 for sampler2DArray
        const gl2 = document.createElement('canvas').getContext('webgl2');
        if (!gl2) {
            console.warn('[TileManager] WebGL2 not available; cannot use KTX2 array textures');
            return false;
        }

        try {
            this._ktx2Loader = new KTX2Loader();
            this._ktx2Loader.setTranscoderPath('./wasm/');

            if (this.renderer) {
                this._ktx2Loader.detectSupport(this.renderer);
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
        return this.tiles[index % this.tileCount];
    }

    getMaterial(index) {
        if (!this.isKTX2) return undefined;
        return this.materials[index % this.tileCount];
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
        }
    }

    /**
     * Enable or disable a 90-degree UV rotation for KTX2 materials to adjust tile alignment.
     * @param {boolean} flag
     */
    setRotate90(flag) {
        this.rotate90 = !!flag;
        this.sharedRotateUniform.value = this.rotate90 ? 1 : 0;
    }
}