// ============================================
// InkEngine — Pressure-sensitive canvas annotation
// ============================================

class InkEngine {
    constructor(canvas, opts = {}) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.onChange = opts.onChange || null;

        // State
        this.tool = 'pen';       // pen | highlighter | eraser
        this.color = '#000000';
        this.penSize = 2.5;
        this.highlighterSize = 18;
        this.eraserRadius = 18;

        this.strokes = [];       // committed strokes
        this.activePoints = [];  // points for the in-progress stroke
        this.eraserPath = [];    // points for eraser visual trail
        this.isDrawing = false;

        this.undoStack = [];
        this.redoStack = [];

        // Committed strokes cache (ImageData snapshot to avoid full redraw)
        this._committedCache = null;

        // Smoothing — higher = more smoothing
        this._streamline = 0.35;
        this._prevSmooth = null;

        // Bind events
        this._onPointerDown = this._onPointerDown.bind(this);
        this._onPointerMove = this._onPointerMove.bind(this);
        this._onPointerUp = this._onPointerUp.bind(this);

        canvas.addEventListener('pointerdown', this._onPointerDown);
        canvas.addEventListener('pointermove', this._onPointerMove);
        canvas.addEventListener('pointerup', this._onPointerUp);
        canvas.addEventListener('pointerleave', this._onPointerUp);
        canvas.style.touchAction = 'none'; // prevent scroll while drawing
    }

    // ---- Pixel ratio helper ----
    // Converts CSS client coords to canvas internal coords correctly
    _getPixelRatio() {
        const rect = this.canvas.getBoundingClientRect();
        return {
            rx: this.canvas.width / rect.width,
            ry: this.canvas.height / rect.height,
        };
    }

    // ---- Tool setters ----

    setTool(tool) { this.tool = tool; }
    setColor(color) { this.color = color; }
    setPenSize(size) { this.penSize = size; }

    // ---- Pointer events ----

    _toCanvasCoords(e) {
        const rect = this.canvas.getBoundingClientRect();
        const rx = this.canvas.width / rect.width;
        const ry = this.canvas.height / rect.height;
        return {
            x: (e.clientX - rect.left) * rx,
            y: (e.clientY - rect.top) * ry,
            pressure: e.pressure || 0.5,
        };
    }

    _onPointerDown(e) {
        this.isDrawing = true;
        this.canvas.setPointerCapture(e.pointerId);

        const pt = this._toCanvasCoords(e);
        this._prevSmooth = { x: pt.x, y: pt.y };

        if (this.tool === 'eraser') {
            this.eraserPath = [pt];
            this._eraseAt(pt.x, pt.y);
        } else {
            this.activePoints = [pt];
        }
    }

    _onPointerMove(e) {
        if (!this.isDrawing) return;

        // Use coalesced events for smoother input
        const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];

        for (const ce of events) {
            const raw = this._toCanvasCoords(ce);

            // Streamline (exponential smoothing)
            const s = this._streamline;
            const sx = this._prevSmooth.x * s + raw.x * (1 - s);
            const sy = this._prevSmooth.y * s + raw.y * (1 - s);
            this._prevSmooth = { x: sx, y: sy };

            const smoothPt = { x: sx, y: sy, pressure: raw.pressure };

            if (this.tool === 'eraser') {
                this.eraserPath.push(smoothPt);
                this._eraseAt(sx, sy);
                this._renderEraserTrail();
            } else {
                // Only add point if it moved enough (min distance filter)
                const last = this.activePoints[this.activePoints.length - 1];
                const dx = sx - last.x;
                const dy = sy - last.y;
                if (dx * dx + dy * dy > 4) { // ~2px threshold in canvas space
                    this.activePoints.push(smoothPt);
                }
            }
        }

        if (this.tool !== 'eraser') {
            this._renderActive();
        }
    }

    _onPointerUp(e) {
        if (!this.isDrawing) return;
        this.isDrawing = false;

        if (this.tool !== 'eraser' && this.activePoints.length > 1) {
            const { rx } = this._getPixelRatio();
            const stroke = {
                id: Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                tool: this.tool,
                color: this.tool === 'highlighter' ? this.color : this.color,
                size: (this.tool === 'highlighter' ? this.highlighterSize : this.penSize) * rx,
                opacity: this.tool === 'highlighter' ? 0.3 : 1,
                points: this.activePoints.slice(),
            };
            this.strokes.push(stroke);
            this.undoStack.push({ type: 'add', stroke });
            this.redoStack = [];
            if (this.onChange) this.onChange();
        }

        this.activePoints = [];
        this.eraserPath = [];
        this._renderAll();
    }

    // ---- Eraser ----

    _eraseAt(x, y) {
        const { rx } = this._getPixelRatio();
        const r = this.eraserRadius * rx;
        const r2 = r * r;

        const toRemove = [];
        for (const stroke of this.strokes) {
            for (const pt of stroke.points) {
                const dx = pt.x - x;
                const dy = pt.y - y;
                if (dx * dx + dy * dy < r2) {
                    toRemove.push(stroke);
                    break;
                }
            }
        }

        if (toRemove.length > 0) {
            for (const stroke of toRemove) {
                const idx = this.strokes.indexOf(stroke);
                if (idx !== -1) this.strokes.splice(idx, 1);
                this.undoStack.push({ type: 'remove', stroke });
            }
            this.redoStack = [];
            this._renderAll();
            if (this.onChange) this.onChange();
        }
    }

    _renderEraserTrail() {
        if (this.eraserPath.length < 2) return;
        // Restore committed cache first
        const c = this.canvas;
        if (this._committedCache) {
            this.ctx.putImageData(this._committedCache, 0, 0);
        } else {
            this.ctx.clearRect(0, 0, c.width, c.height);
        }
        // Draw eraser scribble trail
        const ctx = this.ctx;
        const { rx } = this._getPixelRatio();
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 120, 50, 0.5)';
        ctx.lineWidth = 2 * rx;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.setLineDash([6 * rx, 4 * rx]);
        ctx.beginPath();
        ctx.moveTo(this.eraserPath[0].x, this.eraserPath[0].y);
        for (let i = 1; i < this.eraserPath.length; i++) {
            ctx.lineTo(this.eraserPath[i].x, this.eraserPath[i].y);
        }
        ctx.stroke();
        ctx.restore();
    }

    // ---- Undo / Redo ----

    undo() {
        const action = this.undoStack.pop();
        if (!action) return;

        if (action.type === 'add') {
            const idx = this.strokes.indexOf(action.stroke);
            if (idx !== -1) this.strokes.splice(idx, 1);
        } else if (action.type === 'remove') {
            this.strokes.push(action.stroke);
        }

        this.redoStack.push(action);
        this._renderAll();
        if (this.onChange) this.onChange();
    }

    redo() {
        const action = this.redoStack.pop();
        if (!action) return;

        if (action.type === 'add') {
            this.strokes.push(action.stroke);
        } else if (action.type === 'remove') {
            const idx = this.strokes.indexOf(action.stroke);
            if (idx !== -1) this.strokes.splice(idx, 1);
        }

        this.undoStack.push(action);
        this._renderAll();
        if (this.onChange) this.onChange();
    }

    // ---- Rendering ----

    _renderActive() {
        const c = this.canvas;
        // Restore cached committed strokes (fast blit, no re-rendering)
        if (this._committedCache) {
            this.ctx.putImageData(this._committedCache, 0, 0);
        } else {
            this.ctx.clearRect(0, 0, c.width, c.height);
        }
        if (this.activePoints.length < 2) return;
        const { rx } = this._getPixelRatio();
        this._drawStroke(this.ctx, {
            tool: this.tool,
            color: this.color,
            size: (this.tool === 'highlighter' ? this.highlighterSize : this.penSize) * rx,
            opacity: this.tool === 'highlighter' ? 0.3 : 1,
            points: this.activePoints,
        });
    }

    _renderAll() {
        const c = this.canvas;
        this.ctx.clearRect(0, 0, c.width, c.height);
        for (const stroke of this.strokes) {
            this._drawStroke(this.ctx, stroke);
        }
        // Cache the committed state as ImageData for fast active-stroke compositing
        this._committedCache = this.ctx.getImageData(0, 0, c.width, c.height);
    }

    _drawStroke(ctx, stroke) {
        const pts = stroke.points;
        if (pts.length < 2) return;

        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.globalAlpha = stroke.opacity;

        if (stroke.tool === 'highlighter') {
            // Highlighter: constant width, smooth bezier path
            ctx.globalCompositeOperation = 'multiply';
            ctx.strokeStyle = stroke.color;
            ctx.lineWidth = stroke.size;
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length - 1; i++) {
                const mx = (pts[i].x + pts[i + 1].x) / 2;
                const my = (pts[i].y + pts[i + 1].y) / 2;
                ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
            }
            ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
            ctx.stroke();
        } else {
            // Pen: variable-width pressure-sensitive strokes
            // Use quadratic bezier curves through midpoints for smoothness
            ctx.fillStyle = stroke.color;

            for (let i = 1; i < pts.length; i++) {
                const p0 = pts[i - 1];
                const p1 = pts[i];

                // Interpolated pressure for smooth width transition
                const pressure = (p0.pressure + p1.pressure) / 2;
                const width = Math.max(0.8, stroke.size * (0.2 + pressure * 0.8));

                // Draw thick line segment using a filled quad for smooth edges
                const dx = p1.x - p0.x;
                const dy = p1.y - p0.y;
                const len = Math.sqrt(dx * dx + dy * dy) || 1;
                const nx = (-dy / len) * width / 2;
                const ny = (dx / len) * width / 2;

                ctx.beginPath();
                ctx.moveTo(p0.x + nx, p0.y + ny);
                ctx.lineTo(p1.x + nx, p1.y + ny);
                ctx.lineTo(p1.x - nx, p1.y - ny);
                ctx.lineTo(p0.x - nx, p0.y - ny);
                ctx.closePath();
                ctx.fill();

                // Round joints — circle at each point
                ctx.beginPath();
                ctx.arc(p1.x, p1.y, width / 2, 0, Math.PI * 2);
                ctx.fill();
            }

            // Cap at start
            const startW = Math.max(0.8, stroke.size * (0.2 + pts[0].pressure * 0.8));
            ctx.beginPath();
            ctx.arc(pts[0].x, pts[0].y, startW / 2, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();
    }

    // ---- Serialization ----

    exportStrokes() {
        return this.strokes.map(s => ({
            id: s.id,
            tool: s.tool,
            color: s.color,
            size: s.size,
            opacity: s.opacity,
            points: s.points.map(p => ({
                x: +p.x.toFixed(1),
                y: +p.y.toFixed(1),
                pressure: +p.pressure.toFixed(2),
            })),
        }));
    }

    importStrokes(data) {
        this.strokes = (data || []).map(s => ({ ...s }));
        this.undoStack = [];
        this.redoStack = [];
        this._renderAll();
    }

    clear() {
        this.strokes = [];
        this.undoStack = [];
        this.redoStack = [];
        this._renderAll();
        if (this.onChange) this.onChange();
    }

    destroy() {
        this.canvas.removeEventListener('pointerdown', this._onPointerDown);
        this.canvas.removeEventListener('pointermove', this._onPointerMove);
        this.canvas.removeEventListener('pointerup', this._onPointerUp);
        this.canvas.removeEventListener('pointerleave', this._onPointerUp);
    }
}
