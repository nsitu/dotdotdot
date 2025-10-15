import * as THREE from 'three';
import { CatmullRomCurve3 } from 'three';

export class Ribbon {
    constructor(scene) {
        this.scene = scene;
        this.meshSegments = [];
        this.tileManager = null;
        this.lastPoints = [];
        this.lastWidth = 1;
        this.truncateSegments = true; // Toggle for segment gaps

        // Animation parameters
        this.waveAmplitude = 0.2;
        this.waveFrequency = 2;
        this.waveSpeed = 2;
    }

    setTileManager(tileManager) {
        this.tileManager = tileManager;
        return this;
    }

    buildFromPoints(points, width = 1, time = 0) {
        if (points.length < 2) return;

        // Store for animation updates
        this.lastPoints = points.map(p => p.clone());
        this.lastWidth = width;

        return this.buildSegmentedRibbon(points, width, time);
    }

    buildSegmentedRibbon(points, width, time) {
        // Calculate total path length to determine segment count
        const totalLength = this.calculatePathLength(points);
        const segmentLength = width; // Each segment roughly square (width ≈ height)
        const segmentCount = Math.max(1, Math.ceil(totalLength / segmentLength));

        // Clean up old segments
        this.cleanupOldMesh();

        // Create curve for the path
        const curve = this.createCurveFromPoints(points);

        // Calculate initial reference normal for consistency
        const initialTangent = curve.getTangent(0).normalize();
        const up = new THREE.Vector3(0, 1, 0);
        let referenceNormal = up.cross(initialTangent).normalize();

        // If tangent is parallel to up vector, use a different reference
        if (referenceNormal.length() < 0.1) {
            const right = new THREE.Vector3(1, 0, 0);
            referenceNormal = right.cross(initialTangent).normalize();
        }

        // Pre-calculate all normals for the entire path to ensure consistency
        const pointsPerSegment = 50;
        const totalPoints = segmentCount * pointsPerSegment + 1;
        const normalCache = [];
        let prevNormal = referenceNormal.clone();

        for (let i = 0; i < totalPoints; i++) {
            const t = i / (totalPoints - 1);
            const tangent = curve.getTangent(t).normalize();

            let normal;
            if (i === 0) {
                normal = prevNormal.clone();
            } else {
                // Use Frenet frame approach
                const binormal = tangent.clone().cross(prevNormal).normalize();
                normal = binormal.cross(tangent).normalize();

                // Ensure normal doesn't flip
                if (normal.dot(prevNormal) < 0) {
                    normal.negate();
                }

                // Smooth the transition
                normal = prevNormal.clone().lerp(normal, 0.1).normalize();
            }

            normalCache.push(normal.clone());
            prevNormal = normal;
        }

        // Build each segment using the pre-calculated normals
        for (let segIdx = 0; segIdx < segmentCount; segIdx++) {
            const startT = segIdx / segmentCount;
            const endT = (segIdx + 1) / segmentCount;
            const startPointIdx = segIdx * pointsPerSegment;

            const segmentMesh = this.createRibbonSegmentWithCache(
                curve,
                startT,
                endT,
                width,
                time,
                segIdx,
                normalCache,
                startPointIdx,
                pointsPerSegment
            );

            if (segmentMesh) {
                this.meshSegments.push(segmentMesh);
                this.scene.add(segmentMesh);
            }
        }

        return this.meshSegments;
    }

    calculatePathLength(points) {
        let length = 0;
        for (let i = 1; i < points.length; i++) {
            length += points[i].distanceTo(points[i - 1]);
        }
        return length;
    }

    createCurveFromPoints(points) {
        const curve = new THREE.Curve();
        curve.getPoint = t => {
            const i = t * (points.length - 1);
            const a = Math.floor(i);
            const b = Math.min(Math.ceil(i), points.length - 1);
            const p1 = points[a];
            const p2 = points[b];
            return new THREE.Vector3().lerpVectors(p1, p2, i - a);
        };
        curve.getTangent = t => {
            const delta = 0.001;
            const p1 = curve.getPoint(Math.max(t - delta, 0));
            const p2 = curve.getPoint(Math.min(t + delta, 1));
            return p2.clone().sub(p1).normalize();
        };
        return curve;
    }

    createRibbonSegmentWithCache(curve, startT, endT, width, time, segmentIndex, normalCache, startPointIdx, pointsPerSegment) {
        const geometry = new THREE.BufferGeometry();
        const positions = [];
        const uvs = [];
        const indices = [];

        // Conditionally truncate the last 5% of the segment based on toggle
        const cutoffThreshold = this.truncateSegments ? 0.99 : 1.0;
        const maxPoints = Math.floor(pointsPerSegment * cutoffThreshold);

        for (let i = 0; i <= maxPoints; i++) {
            const localT = i / pointsPerSegment; // Note: still using pointsPerSegment for proper UV mapping
            const globalT = startT + (endT - startT) * localT;
            const point = curve.getPoint(globalT);
            const tangent = curve.getTangent(globalT).normalize();

            // Get the pre-calculated normal from cache
            const cacheIdx = startPointIdx + i;
            const normal = normalCache[cacheIdx].clone();

            // Animate phase
            const phase = Math.sin(
                globalT * Math.PI * 2 * this.waveFrequency + time * this.waveSpeed
            ) * this.waveAmplitude;

            normal.applyAxisAngle(tangent, phase);

            const left = point.clone().addScaledVector(normal, -width / 2);
            const right = point.clone().addScaledVector(normal, width / 2);

            positions.push(left.x, left.y, left.z);
            positions.push(right.x, right.y, right.z);

            // UV mapping rotated 90 degrees for seamless tiling along ribbon direction
            uvs.push(localT, 0);  // left edge
            uvs.push(localT, 1);  // right edge

            if (i < maxPoints) {
                const base = i * 2;
                indices.push(base, base + 1, base + 2);
                indices.push(base + 1, base + 3, base + 2);
            }
        }

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();

        // Get the appropriate tile texture
        const tileTexture = this.tileManager.getTile(segmentIndex);

        const material = new THREE.MeshBasicMaterial({
            map: tileTexture,
            side: THREE.DoubleSide
        });

        return new THREE.Mesh(geometry, material);
    }

    update(time) {
        if (this.lastPoints.length >= 2) {
            this.buildFromPoints(this.lastPoints, this.lastWidth, time);
        }
    }

    cleanupOldMesh() {
        // Clean up segmented meshes
        this.meshSegments.forEach(mesh => {
            if (mesh.geometry) mesh.geometry.dispose();
            if (mesh.material) mesh.material.dispose();
            this.scene.remove(mesh);
        });
        this.meshSegments = [];
    }

    dispose() {
        this.cleanupOldMesh();
        this.lastPoints = [];
    }

    // Utility methods for drawing-to-ribbon conversion
    normalizeDrawingPoints(points) {
        if (points.length < 2) return points;

        // Find bounds of the drawing
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        points.forEach(p => {
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
        });

        const width = maxX - minX;
        const height = maxY - minY;
        const centerX = minX + width / 2;
        const centerY = minY + height / 2;

        // Scale factor to normalize to [-4, 4] range
        const maxDimension = Math.max(width, height);
        const scale = maxDimension > 0 ? 8 / maxDimension : 1;

        // Normalize points to center and scale
        return points.map(p => ({
            x: (p.x - centerX) * scale,
            y: (p.y - centerY) * scale * -1 // Flip Y axis to match THREE.js coordinates
        }));
    }

    smoothPoints(points, numSamples = 100) {
        if (points.length < 2) return points;

        const curve = new CatmullRomCurve3(points, false, 'centripetal');
        const smoothed = [];

        for (let i = 0; i < numSamples; i++) {
            smoothed.push(curve.getPoint(i / (numSamples - 1)));
        }

        return smoothed;
    }

    createRibbonFromDrawing(drawPoints) {
        if (drawPoints.length < 2) return;

        // Convert 2D screen points to normalized coordinates
        const normalizedPoints = this.normalizeDrawingPoints(drawPoints);

        // Create 3D points from normalized 2D points (all with same Z value)
        const points3D = normalizedPoints.map(p => new THREE.Vector3(p.x, p.y, 0));

        // Apply smoothing
        const smoothedPoints = this.smoothPoints(points3D, 150);

        // Build ribbon
        const result = this.buildFromPoints(smoothedPoints, 1.2);

        return result;
    }
}