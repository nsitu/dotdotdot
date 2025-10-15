/**
 * Drawing module for handling user sketch input
 */



export class DrawingManager {
    /**
     * Create a new drawing manager
     * @param {HTMLCanvasElement} canvas - The canvas element to draw on
     * @param {Function} onDrawingComplete - Callback when drawing is completed
     */
    constructor(canvas, onDrawingComplete) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.onDrawingComplete = onDrawingComplete;
        this.points = [];
        this.isActive = false;
        this.resize(window.innerWidth, window.innerHeight);


        this.initEventListeners();
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
            this.clearCanvas();
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

        this.points = [];
        this.points.push({ x: e.clientX, y: e.clientY });
        this.clearCanvas();
        this.canvas.setPointerCapture(e.pointerId);
    }

    /**
     * Handle pointer move events
     * @param {PointerEvent} e - The pointer event
     */
    handlePointerMove(e) {
        if (!this.isActive || e.buttons !== 1) return;

        this.points.push({ x: e.clientX, y: e.clientY });
        this.drawStroke();
    }

    /**
     * Handle pointer up events
     * @param {PointerEvent} e - The pointer event
     */
    handlePointerUp(e) {
        if (!this.isActive) return;

        if (this.points.length >= 2) {
            this.onDrawingComplete(this.points);
        }
    }

    /**
     * Draw the current stroke on canvas
     */
    drawStroke() {
        if (this.points.length < 2) return;

        this.ctx.lineWidth = 2;
        this.ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        this.ctx.beginPath();

        for (let i = 0; i < this.points.length - 1; i++) {
            const a = this.points[i];
            const b = this.points[i + 1];
            this.ctx.moveTo(a.x, a.y);
            this.ctx.lineTo(b.x, b.y);
        }

        this.ctx.stroke();
    }

    /**
     * Resize the drawing canvas
     * @param {number} width - New canvas width
     * @param {number} height - New canvas height
     */
    resize(width, height) {
        this.canvas.width = width;
        this.canvas.height = height;
    }

    /**
     * Remove all event listeners - call when disposing
     */
    dispose() {
        this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
        this.canvas.removeEventListener('pointermove', this.handlePointerMove);
        this.canvas.removeEventListener('pointerup', this.handlePointerUp);
        this.canvas.removeEventListener('pointercancel', this.handlePointerUp);
    }
}