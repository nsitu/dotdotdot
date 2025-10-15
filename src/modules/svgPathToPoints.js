import * as THREE from 'three';

/**
 * Converts SVG path data to an array of THREE.Vector3 points
 * @param {string} pathData - The SVG path data string
 * @param {number} numPoints - Number of points to sample along the path
 * @param {number} scale - Scale factor for the resulting points
 * @param {number} z - Z position for all points
 * @returns {Array<THREE.Vector3>} Array of 3D points
 */
export function svgPathToPoints(pathData, numPoints = 100, scale = 1, z = 0) {
    // Create an SVG path element to use the browser's path API
    const svgNS = "http://www.w3.org/2000/svg";
    const path = document.createElementNS(svgNS, "path");
    path.setAttribute("d", pathData);

    // Get total path length to sample points evenly
    const pathLength = path.getTotalLength();
    const points = [];

    // Sample points evenly along path
    for (let i = 0; i < numPoints; i++) {
        const distance = (i / (numPoints - 1)) * pathLength;
        const point = path.getPointAtLength(distance);
        points.push(new THREE.Vector3(point.x * scale, -point.y * scale, z)); // Flip Y because SVG Y is down
    }

    return points;
}

/**
 * Parses SVG content and extracts points from the first path
 * @param {string} svgContent - SVG content as string
 * @param {number} numPoints - Number of points to sample
 * @param {number} scale - Scale factor for the points
 * @param {number} z - Z position for all points
 * @returns {Array<THREE.Vector3>} Array of points or null if parsing fails
 */
export function parseSvgContent(svgContent, numPoints = 100, scale = 1, z = 0) {
    try {
        // Parse SVG content
        const parser = new DOMParser();
        const svgDoc = parser.parseFromString(svgContent, "image/svg+xml");

        // Check for parsing errors
        const parserError = svgDoc.querySelector("parsererror");
        if (parserError) {
            console.error("SVG parsing error:", parserError);
            return null;
        }

        // Get the first path element
        const path = svgDoc.querySelector("path");
        if (!path) {
            console.error("No path found in SVG");
            return null;
        }

        // Get path data
        const pathData = path.getAttribute("d");
        if (!pathData) {
            console.error("Path has no data attribute");
            return null;
        }

        // Calculate appropriate scale based on viewBox if present
        let adjustedScale = scale;
        const svgElement = svgDoc.querySelector("svg");
        const viewBox = svgElement?.getAttribute("viewBox");

        if (viewBox) {
            const [, , width, height] = viewBox.split(" ").map(Number);
            // Use the largest dimension to normalize
            const maxDimension = Math.max(width, height);
            if (maxDimension > 0) {
                adjustedScale = scale / maxDimension;
            }
        }

        // Convert path data to points
        return svgPathToPoints(pathData, numPoints, adjustedScale, z);
    } catch (error) {
        console.error("Error parsing SVG content:", error);
        return null;
    }
}

/**
 * Loads an SVG file and returns points from the first path
 * @param {string} url - URL to SVG file
 * @param {number} numPoints - Number of points to sample
 * @param {number} scale - Scale factor for the points
 * @param {number} z - Z position for all points
 * @returns {Promise<Array<THREE.Vector3>>} Promise resolving to array of points
 */
export async function loadSvgPath(url, numPoints = 100, scale = 1, z = 0) {
    try {
        const response = await fetch(url);
        const svgText = await response.text();
        return parseSvgContent(svgText, numPoints, scale, z);
    } catch (error) {
        console.error("Error loading SVG from URL:", error);
        return null;
    }
}

/**
 * Normalizes a set of points to fit within a target size
 * @param {Array<THREE.Vector3>} points - Array of points to normalize
 * @param {number} targetSize - The desired maximum dimension size
 * @returns {Array<THREE.Vector3>} Scaled and centered points
 */
export function normalizePoints(points, targetSize = 8) {
    if (!points || points.length < 2) return points;

    // Calculate bounding box
    const box = new THREE.Box3().setFromPoints(points);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    // Calculate scale factor to fit within target size
    const maxDimension = Math.max(size.x, size.y);
    const scaleFactor = maxDimension > 0 ? targetSize / maxDimension : 1;

    // Scale and center points
    return points.map(p => new THREE.Vector3(
        (p.x - center.x) * scaleFactor,
        (p.y - center.y) * scaleFactor,
        p.z
    ));
}