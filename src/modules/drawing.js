/**
 * Drawing module for handling user sketch input
 * Supports multi-stroke drawing sessions
 */



export class DrawingManager {
    /**
     * Create a new drawing manager
     * @param {HTMLCanvasElement} canvas - The canvas element to draw on
     * @param {Function} onDrawingComplete - Callback when drawing is finalized
     * @param {Function} onStrokeCountChange - Callback when stroke count changes
     */
    constructor(canvas, onDrawingComplete, onStrokeCountChange = null) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.onDrawingComplete = onDrawingComplete;
        this.onStrokeCountChange = onStrokeCountChange;

        // Multi-stroke support
        this.strokes = [];        // Array of completed stroke point arrays
        this.currentStroke = [];  // Points for stroke currently being drawn
        this.isDrawingStroke = false;

        // Auto-finalize timeout
        this.autoFinalizeTimeout = null;
        this.autoFinalizeDelay = 3000; // 3 seconds of inactivity
        this.autoFinalizeEnabled = true;
        this.autoFinalizeCountdown = null;
        this.onAutoFinalizeCountdown = null; // Callback for countdown UI

        this.isActive = false;
        this.minPointDistance = 2; // Minimum pixels between points to avoid duplicates
        this.resize(window.innerWidth, window.innerHeight);

        this.initEventListeners();
    }

    /**
     * Check if a new point is far enough from the last captured point
     * @param {number} x - New point x coordinate
     * @param {number} y - New point y coordinate
     * @returns {boolean} True if point should be added
     */
    shouldAddPoint(x, y) {
        if (this.currentStroke.length === 0) return true;

        const lastPoint = this.currentStroke[this.currentStroke.length - 1];
        const dx = x - lastPoint.x;
        const dy = y - lastPoint.y;
        const distanceSquared = dx * dx + dy * dy;

        return distanceSquared >= this.minPointDistance * this.minPointDistance;
    }

    /**
     * Initialize drawing event listeners
     */
    initEventListeners() {
        this.canvas.addEventListener('pointerdown', this.handlePointerDown.bind(this));
        this.canvas.addEventListener('pointermove', this.handlePointerMove.bind(this));
        this.canvas.addEventListener('pointerup', this.handlePointerUp.bind(this));
        this.canvas.addEventListener('pointercancel', this.handlePointerUp.bind(this));
    }

    /**
     * Set the drawing mode active or inactive
     * @param {boolean} active - Whether drawing mode should be active
     */
    setActive(active) {
        this.isActive = active;
        this.canvas.style.pointerEvents = active ? 'auto' : 'none';

        if (!active) {
            this.clearStrokes();
            this.cancelAutoFinalize();
        }
    }

    /**
     * Clear the drawing canvas
     */
    clearCanvas() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    /**
     * Handle pointer down events
     * @param {PointerEvent} e - The pointer event
     */
    handlePointerDown(e) {
        if (!this.isActive) return;

        // Cancel any pending auto-finalize when starting new stroke
        this.cancelAutoFinalize();

        console.log('[Drawing] Pointer down - starting new stroke', {
            position: { x: Math.round(e.clientX), y: Math.round(e.clientY) },
            pointerId: e.pointerId,
            existingStrokes: this.strokes.length
        });

        this.currentStroke = [];
        this.currentStroke.push({ x: Math.round(e.clientX), y: Math.round(e.clientY) });
        this.isDrawingStroke = true;
        this.canvas.setPointerCapture(e.pointerId);

        // Redraw to show current stroke
        this.drawAllStrokes();
    }

    /**
     * Handle pointer move events
     * @param {PointerEvent} e - The pointer event
     */
    handlePointerMove(e) {
        if (!this.isActive || !this.isDrawingStroke || e.buttons !== 1) return;

        const x = Math.round(e.clientX);
        const y = Math.round(e.clientY);

        // Only add point if it's far enough from the last one
        if (this.shouldAddPoint(x, y)) {
            this.currentStroke.push({ x, y });
            this.drawAllStrokes();
        }

        // Log periodically (every 10 points) to avoid spam
        if (this.currentStroke.length % 10 === 0) {
            console.log('[Drawing] Collecting points...', {
                strokePoints: this.currentStroke.length,
                lastPoint: { x, y }
            });
        }
    }

    /**
     * Handle pointer up events
     * @param {PointerEvent} e - The pointer event
     */
    handlePointerUp(e) {
        if (!this.isActive || !this.isDrawingStroke) return;

        this.isDrawingStroke = false;

        console.log('[Drawing] Pointer up - stroke complete', {
            strokePoints: this.currentStroke.length,
            pointerId: e.pointerId
        });

        // Add stroke to collection if it has enough points
        if (this.currentStroke.length >= 2) {
            this.strokes.push([...this.currentStroke]);
            console.log('[Drawing] Stroke added to collection', {
                totalStrokes: this.strokes.length
            });

            // Notify stroke count change
            if (this.onStrokeCountChange) {
                this.onStrokeCountChange(this.strokes.length);
            }
        } else {
            console.warn('[Drawing] Stroke too short, discarding');
        }

        this.currentStroke = [];
        this.drawAllStrokes();

        // Start auto-finalize timer if enabled and we have strokes
        if (this.autoFinalizeEnabled && this.strokes.length > 0) {
            this.startAutoFinalize();
        }
    }

    /**
     * Start the auto-finalize countdown
     */
    startAutoFinalize() {
        this.cancelAutoFinalize();

        const startTime = Date.now();
        const endTime = startTime + this.autoFinalizeDelay;

        // Update countdown every 100ms
        this.autoFinalizeCountdown = setInterval(() => {
            const remaining = Math.max(0, endTime - Date.now());
            const seconds = Math.ceil(remaining / 1000);

            if (this.onAutoFinalizeCountdown) {
                this.onAutoFinalizeCountdown(seconds, remaining > 0);
            }
        }, 100);

        // Set the actual finalize timeout
        this.autoFinalizeTimeout = setTimeout(() => {
            console.log('[Drawing] Auto-finalizing after timeout');
            this.cancelAutoFinalize();

            const result = this.finalizeDrawing();
            if (result && this.onDrawingComplete) {
                this.onDrawingComplete(result);
            }
        }, this.autoFinalizeDelay);

        console.log('[Drawing] Auto-finalize timer started', {
            delay: this.autoFinalizeDelay
        });
    }

    /**
     * Cancel the auto-finalize timer
     */
    cancelAutoFinalize() {
        if (this.autoFinalizeTimeout) {
            clearTimeout(this.autoFinalizeTimeout);
            this.autoFinalizeTimeout = null;
        }
        if (this.autoFinalizeCountdown) {
            clearInterval(this.autoFinalizeCountdown);
            this.autoFinalizeCountdown = null;
        }
        if (this.onAutoFinalizeCountdown) {
            this.onAutoFinalizeCountdown(0, false);
        }
    }

    /**
     * Finalize the drawing session and return all strokes
     * @returns {Array<Array<{x,y}>>|null} Array of strokes or null if no strokes
     */
    finalizeDrawing() {
        this.cancelAutoFinalize();

        if (this.strokes.length === 0) {
            console.warn('[Drawing] No strokes to finalize');
            return null;
        }

        const result = [...this.strokes];
        console.log('[Drawing] Finalizing drawing', {
            strokeCount: result.length,
            totalPoints: result.reduce((sum, s) => sum + s.length, 0)
        });

        this.strokes = [];
        this.currentStroke = [];
        this.clearCanvas();

        // Notify stroke count change
        if (this.onStrokeCountChange) {
            this.onStrokeCountChange(0);
        }

        return result;
    }

    /**
     * Get the current stroke count
     * @returns {number} Number of completed strokes
     */
    getStrokeCount() {
        return this.strokes.length;
    }

    /**
     * Clear all strokes without finalizing
     */
    clearStrokes() {
        this.cancelAutoFinalize();
        this.strokes = [];
        this.currentStroke = [];
        this.isDrawingStroke = false;
        this.clearCanvas();

        // Notify stroke count change
        if (this.onStrokeCountChange) {
            this.onStrokeCountChange(0);
        }
    }

    /**
     * Undo the last stroke
     * @returns {boolean} True if a stroke was removed
     */
    undoLastStroke() {
        if (this.strokes.length === 0) return false;

        this.cancelAutoFinalize();
        this.strokes.pop();
        this.drawAllStrokes();

        // Notify stroke count change
        if (this.onStrokeCountChange) {
            this.onStrokeCountChange(this.strokes.length);
        }

        // Restart auto-finalize if we still have strokes
        if (this.autoFinalizeEnabled && this.strokes.length > 0) {
            this.startAutoFinalize();
        }

        return true;
    }

    /**
     * Draw all strokes on canvas with visual distinction
     */
    drawAllStrokes() {
        this.clearCanvas();

        this.ctx.lineWidth = 2;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';

        // Draw completed strokes with color variation
        this.strokes.forEach((stroke, index) => {
            if (stroke.length < 2) return;

            // Vary hue per stroke for visual distinction
            const hue = (index * 45 + 180) % 360;
            this.ctx.strokeStyle = `hsla(${hue}, 70%, 60%, 0.6)`;
            this.drawStrokePoints(stroke);
        });

        // Draw current stroke in white
        if (this.currentStroke.length >= 2) {
            this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
            this.drawStrokePoints(this.currentStroke);
        }
    }

    /**
     * Draw a single stroke's points
     * @param {Array<{x,y}>} points - Points to draw
     */
    drawStrokePoints(points) {
        if (points.length < 2) return;

        this.ctx.beginPath();
        this.ctx.moveTo(points[0].x, points[0].y);

        for (let i = 1; i < points.length; i++) {
            this.ctx.lineTo(points[i].x, points[i].y);
        }

        this.ctx.stroke();
    }

    /**
     * Draw the current stroke on canvas (legacy method for compatibility)
     */
    drawStroke() {
        this.drawAllStrokes();
    }

    /**
     * Resize the drawing canvas
     * @param {number} width - New canvas width
     * @param {number} height - New canvas height
     */
    resize(width, height) {
        this.canvas.width = width;
        this.canvas.height = height;
        // Redraw strokes after resize
        this.drawAllStrokes();
    }

    /**
     * Enable or disable auto-finalize
     * @param {boolean} enabled - Whether auto-finalize should be enabled
     */
    setAutoFinalizeEnabled(enabled) {
        this.autoFinalizeEnabled = enabled;
        if (!enabled) {
            this.cancelAutoFinalize();
        }
    }

    /**
     * Set the auto-finalize delay
     * @param {number} delay - Delay in milliseconds
     */
    setAutoFinalizeDelay(delay) {
        this.autoFinalizeDelay = delay;
    }

    /**
     * Remove all event listeners - call when disposing
     */
    dispose() {
        this.cancelAutoFinalize();
        this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
        this.canvas.removeEventListener('pointermove', this.handlePointerMove);
        this.canvas.removeEventListener('pointerup', this.handlePointerUp);
        this.canvas.removeEventListener('pointercancel', this.handlePointerUp);
    }
}