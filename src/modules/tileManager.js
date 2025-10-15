import * as THREE from 'three';

export class TileManager {
    constructor() {
        this.tiles = [];
        this.tileCount = 32;
        this.tileSize = 512;
        this.loadedCount = 0;
    }

    async loadAllTiles() {
        const promises = [];

        for (let i = 0; i < this.tileCount; i++) {
            promises.push(this.loadTile(i));
        }

        this.tiles = await Promise.all(promises);
        console.log(`Loaded ${this.tiles.length} tiles`);
        return this.tiles;
    }

    async loadTile(index) {
        return new Promise((resolve, reject) => {
            const loader = new THREE.TextureLoader();
            loader.load(
                `/tiles-numbered/${index}.jpg`,
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

    getTileSequence(startIndex, count) {
        const sequence = [];
        for (let i = 0; i < count; i++) {
            sequence.push(this.getTile(startIndex + i));
        }
        return sequence;
    }
}