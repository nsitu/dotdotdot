/**
 * RibbonSeries - Manages multiple ribbons rendered together with continuous texturing
 */

import { Ribbon } from './ribbon.js';

export class RibbonSeries {
    /**
     * Create a new ribbon series
     * @param {THREE.Scene} scene - The Three.js scene to add ribbons to
     */
    constructor(scene) {
        this.scene = scene;
        this.ribbons = [];           // Array of Ribbon instances
        this.tileManager = null;
        this.totalSegmentCount = 0;  // For tracking total segments across all ribbons
        this.lastPathsPoints = [];   // Store for animation updates
        this.lastWidth = 1;
    }

    /**
     * Set the tile manager for texturing
     * @param {TileManager} tileManager - The tile manager instance
     * @returns {RibbonSeries} this for chaining
     */
    setTileManager(tileManager) {
        this.tileManager = tileManager;
        return this;
    }

    /**
     * Build ribbons from multiple path point arrays
     * @param {Array<Array<THREE.Vector3>>} pathsPoints - Array of point arrays (one per path)
     * @param {number} width - Ribbon width
     * @param {number} time - Animation time
     * @returns {Array<Ribbon>} The created ribbons
     */
    buildFromMultiplePaths(pathsPoints, width = 1, time = 0) {
        if (!pathsPoints || pathsPoints.length === 0) {
            console.warn('[RibbonSeries] No paths provided');
            return [];
        }

        console.log('[RibbonSeries] Building from', pathsPoints.length, 'paths');

        // Store for animation updates
        this.lastPathsPoints = pathsPoints.map(points =>
            points.map(p => p.clone())
        );
        this.lastWidth = width;

        // Clean up existing ribbons
        this.cleanup();

        let segmentOffset = 0;  // Track cumulative segment count for texture continuity

        for (let i = 0; i < pathsPoints.length; i++) {
            const points = pathsPoints[i];

            if (points.length < 2) {
                console.warn(`[RibbonSeries] Path ${i} has insufficient points, skipping`);
                continue;
            }

            const ribbon = new Ribbon(this.scene);

            if (this.tileManager) {
                ribbon.setTileManager(this.tileManager);
            }

            // Set segment offset for continuous texture indexing
            ribbon.setSegmentOffset(segmentOffset);

            // Build the ribbon
            ribbon.buildFromPoints(points, width, time);

            // Update offset for next ribbon
            segmentOffset += ribbon.meshSegments.length;

            this.ribbons.push(ribbon);

            console.log(`[RibbonSeries] Ribbon ${i}: ${ribbon.meshSegments.length} segments, offset was ${segmentOffset - ribbon.meshSegments.length}`);
        }

        this.totalSegmentCount = segmentOffset;
        console.log(`[RibbonSeries] Total segments across all ribbons: ${this.totalSegmentCount}`);

        return this.ribbons;
    }

    /**
     * Build a single ribbon (for backward compatibility)
     * @param {Array<THREE.Vector3>} points - Array of points for a single path
     * @param {number} width - Ribbon width
     * @param {number} time - Animation time
     * @returns {Array<Ribbon>} The created ribbon (in array for consistency)
     */
    buildFromPoints(points, width = 1, time = 0) {
        return this.buildFromMultiplePaths([points], width, time);
    }

    /**
     * Update all ribbons (for animation)
     * @param {number} time - Animation time
     */
    update(time) {
        if (this.lastPathsPoints.length > 0) {
            this.buildFromMultiplePaths(this.lastPathsPoints, this.lastWidth, time);
        }
    }

    /**
     * Get the total number of segments across all ribbons
     * @returns {number} Total segment count
     */
    getTotalSegmentCount() {
        return this.totalSegmentCount;
    }

    /**
     * Get all ribbon instances
     * @returns {Array<Ribbon>} Array of ribbons
     */
    getRibbons() {
        return this.ribbons;
    }

    /**
     * Get a specific ribbon by index
     * @param {number} index - Ribbon index
     * @returns {Ribbon|null} The ribbon or null if not found
     */
    getRibbon(index) {
        return this.ribbons[index] || null;
    }

    /**
     * Clean up all ribbons
     */
    cleanup() {
        this.ribbons.forEach(ribbon => ribbon.dispose());
        this.ribbons = [];
        this.totalSegmentCount = 0;
    }

    /**
     * Dispose of all resources
     */
    dispose() {
        this.cleanup();
        this.lastPathsPoints = [];
    }
}
