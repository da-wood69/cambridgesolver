// ============================================
// SolverMode — Split-pane PDF solver with annotations
// ============================================

const SolverMode = (() => {
    // State
    let isOpen = false;
    let pdfDoc = null;
    let pageEngines = {};  // pageNum -> InkEngine
    let currentFiles = {}; // { qp, ms, in, ... } with relPath
    let qpZoom = 1.0;
    let refZoom = 1.0;
    let currentRefType = null;
    let currentRefDoc = null;
    let paperKey = '';
    let currentSubjectCode = '';
    let currentSessionLabel = '';
    let _saveTimer = null;
    const PDF_SCALE = 1.5; // base render scale (CSS pixels per PDF point)

    // DOM refs (set on first open)
    let panel, toolbar, pagesContainer, refPagesContainer, refTabs;
    let divider, leftPane, rightPane;

    function getDom() {
        panel = document.getElementById('solver-panel');
        pagesContainer = document.getElementById('solver-pages');
        refPagesContainer = document.getElementById('solver-ref-pages');
        refTabs = document.getElementById('solver-ref-tabs');
        divider = document.getElementById('solver-divider');
        leftPane = document.getElementById('solver-left');
        rightPane = document.getElementById('solver-right');
    }

    // ---- Public API ----

    async function open(files, subjectCode, sessionLabel) {
        getDom();
        if (!files.qp) return;

        currentFiles = files;
        paperKey = files.qp.name.replace('.pdf', '');
        currentSubjectCode = subjectCode;
        currentSessionLabel = sessionLabel;
        isOpen = true;

        // Show panel
        panel.classList.remove('hidden');
        document.getElementById('browser-panel').classList.add('hidden');

        // Set active tool
        _setActiveTool('pen');

        // Reset zoom
        qpZoom = 1.0;
        refZoom = 1.0;
        document.getElementById('solver-zoom-level').textContent = '100%';
        document.getElementById('ref-zoom-level').textContent = '100%';

        // Load QP PDF
        const qpUrl = buildDownloadUrl(files.qp.relPath);
        try {
            const result = await window.api.downloadPaper(qpUrl);
            const data = new Uint8Array(result.data);

            // Setup pdf.js
            const pdfjsLib = window['pdfjs-dist/build/pdf'];
            pdfjsLib.GlobalWorkerOptions.workerSrc = '../node_modules/pdfjs-dist/build/pdf.worker.js';

            pdfDoc = await pdfjsLib.getDocument({ data }).promise;
            await _renderPages();
            await _loadAnnotations();
        } catch (err) {
            console.error('Failed to load QP:', err);
            pagesContainer.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-secondary);">Failed to load paper: ${err.message}</div>`;
        }

        // Load reference tabs
        _setupRefTabs();

        // Setup divider drag
        _setupDivider();
    }

    function close() {
        if (!isOpen) return;
        _saveSession();

        // Destroy ink engines
        for (const eng of Object.values(pageEngines)) eng.destroy();
        pageEngines = {};
        pdfDoc = null;
        currentRefDoc = null;
        if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }

        pagesContainer.innerHTML = '';
        refPagesContainer.innerHTML = '';
        panel.classList.add('hidden');
        document.getElementById('browser-panel').classList.remove('hidden');
        isOpen = false;
    }

    // ---- PDF Page Rendering ----

    async function _renderPages() {
        pagesContainer.innerHTML = '';
        pageEngines = {};

        for (let i = 1; i <= pdfDoc.numPages; i++) {
            const page = await pdfDoc.getPage(i);
            const viewport = page.getViewport({ scale: PDF_SCALE * window.devicePixelRatio });
            const cssW = viewport.width / window.devicePixelRatio;
            const cssH = viewport.height / window.devicePixelRatio;

            // Page wrapper
            const wrapper = document.createElement('div');
            wrapper.className = 'solver-page';
            wrapper.style.width = cssW + 'px';
            wrapper.style.height = cssH + 'px';
            wrapper.dataset.page = i;

            // PDF canvas
            const pdfCanvas = document.createElement('canvas');
            pdfCanvas.width = viewport.width;
            pdfCanvas.height = viewport.height;
            pdfCanvas.style.width = cssW + 'px';
            pdfCanvas.style.height = cssH + 'px';
            pdfCanvas.className = 'solver-pdf-canvas';

            // Ink canvas (overlay)
            const inkCanvas = document.createElement('canvas');
            inkCanvas.width = viewport.width;
            inkCanvas.height = viewport.height;
            inkCanvas.style.width = cssW + 'px';
            inkCanvas.style.height = cssH + 'px';
            inkCanvas.className = 'solver-ink-canvas';

            wrapper.appendChild(pdfCanvas);
            wrapper.appendChild(inkCanvas);
            pagesContainer.appendChild(wrapper);

            // Render PDF page
            const ctx = pdfCanvas.getContext('2d');
            await page.render({ canvasContext: ctx, viewport }).promise;

            // Create ink engine for this page — coordinates handled internally
            const engine = new InkEngine(inkCanvas, {
                onChange: notifyStrokeChange
            });
            pageEngines[i] = engine;
        }

        // Update page counter
        _updatePageInfo();
    }

    // ---- Reference Panel ----

    function _setupRefTabs() {
        refTabs.innerHTML = '';
        const tabs = [];

        if (currentFiles.ms) tabs.push({ label: 'Mark Scheme', type: 'ms' });
        if (currentFiles.in) tabs.push({ label: 'Insert', type: 'in' });

        // Check for other useful files (formula booklets etc.)
        for (const [type, file] of Object.entries(currentFiles)) {
            if (['qp', 'ms', 'in'].includes(type)) continue;
            tabs.push({ label: file.label, type });
        }

        if (tabs.length === 0) {
            rightPane.classList.add('hidden');
            divider.classList.add('hidden');
            return;
        }

        rightPane.classList.remove('hidden');
        divider.classList.remove('hidden');

        for (const tab of tabs) {
            const btn = document.createElement('button');
            btn.className = 'solver-tab';
            btn.textContent = tab.label;
            btn.addEventListener('click', () => {
                refTabs.querySelectorAll('.solver-tab').forEach(t => t.classList.remove('active'));
                btn.classList.add('active');
                _loadRef(tab.type);
            });
            refTabs.appendChild(btn);
        }

        // Click first tab
        refTabs.querySelector('.solver-tab').classList.add('active');
        _loadRef(tabs[0].type);
    }

    async function _loadRef(type) {
        const file = currentFiles[type];
        if (!file) return;

        currentRefType = type;
        refPagesContainer.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-secondary);font-size:13px;">Loading...</div>';
        const url = buildDownloadUrl(file.relPath);

        try {
            const result = await window.api.downloadPaper(url);
            const data = new Uint8Array(result.data);

            const pdfjsLib = window['pdfjs-dist/build/pdf'];
            currentRefDoc = await pdfjsLib.getDocument({ data }).promise;

            await _renderRefPages();
        } catch (err) {
            console.error('Failed to load reference:', err);
            refPagesContainer.innerHTML = '<div style="padding:20px;text-align:center;color:var(--danger);font-size:13px;">Failed to load</div>';
        }
    }

    async function _renderRefPages() {
        if (!currentRefDoc) return;
        refPagesContainer.innerHTML = '';

        const renderScale = 1.5 * refZoom;

        for (let i = 1; i <= currentRefDoc.numPages; i++) {
            const page = await currentRefDoc.getPage(i);
            const viewport = page.getViewport({ scale: renderScale * window.devicePixelRatio });
            const cssW = viewport.width / window.devicePixelRatio;
            const cssH = viewport.height / window.devicePixelRatio;

            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            canvas.style.width = cssW + 'px';
            canvas.style.height = cssH + 'px';
            canvas.style.display = 'block';

            refPagesContainer.appendChild(canvas);

            const ctx = canvas.getContext('2d');
            await page.render({ canvasContext: ctx, viewport }).promise;
        }
    }

    // ---- Toolbar Actions ----

    function setTool(tool) {
        _setActiveTool(tool);
        for (const eng of Object.values(pageEngines)) eng.setTool(tool);
    }

    function setColor(color) {
        for (const eng of Object.values(pageEngines)) eng.setColor(color);
        document.querySelectorAll('.solver-color').forEach(c => {
            c.classList.toggle('active', c.dataset.color === color);
        });
    }

    function setPenSize(size) {
        for (const eng of Object.values(pageEngines)) eng.setPenSize(parseFloat(size));
        document.querySelectorAll('.solver-size').forEach(s => {
            s.classList.toggle('active', s.dataset.size === String(size));
        });
    }

    function undo() {
        // Undo on the most recently modified engine  
        // Simple approach: undo on all engines' most recent
        const engines = Object.values(pageEngines);
        // Find which engine has the most recent undo action
        let latest = null;
        let latestTime = 0;
        for (const eng of engines) {
            if (eng.undoStack.length > 0) {
                const action = eng.undoStack[eng.undoStack.length - 1];
                const time = parseInt(action.stroke.id.split('_')[0]) || 0;
                if (time > latestTime) {
                    latestTime = time;
                    latest = eng;
                }
            }
        }
        if (latest) latest.undo();
    }

    function redo() {
        const engines = Object.values(pageEngines);
        let latest = null;
        let latestTime = 0;
        for (const eng of engines) {
            if (eng.redoStack.length > 0) {
                const action = eng.redoStack[eng.redoStack.length - 1];
                const time = parseInt(action.stroke.id.split('_')[0]) || 0;
                if (time > latestTime) {
                    latestTime = time;
                    latest = eng;
                }
            }
        }
        if (latest) latest.redo();
    }

    function clearAll() {
        if (!confirm('Clear all annotations on this paper?')) return;
        for (const eng of Object.values(pageEngines)) eng.clear();
    }

    // ---- Annotations & Session Persistence ----

    function _scheduleSave() {
        if (_saveTimer) clearTimeout(_saveTimer);
        _saveTimer = setTimeout(() => {
            _saveSession();
            _saveTimer = null;
        }, 500);
    }

    async function _saveSession() {
        if (!isOpen || !paperKey) return;

        // Save annotations
        const annotData = {};
        for (const [pageNum, eng] of Object.entries(pageEngines)) {
            const strokes = eng.exportStrokes();
            if (strokes.length > 0) annotData[pageNum] = strokes;
        }
        await window.api.setParsedCache('annot_' + paperKey, annotData);

        // Save session state
        const sessionState = {
            paperKey,
            subjectCode: currentSubjectCode,
            sessionLabel: currentSessionLabel,
            files: {},
            qpZoom,
            refZoom,
            activeRefTab: currentRefType,
            scrollTop: leftPane ? leftPane.scrollTop : 0,
            timestamp: Date.now(),
        };

        // Store file info (relPath and metadata) for each file type
        for (const [type, file] of Object.entries(currentFiles)) {
            sessionState.files[type] = { name: file.name, label: file.label, relPath: file.relPath };
        }

        await window.api.setParsedCache('session_' + paperKey, sessionState);

        // Update recent sessions list
        await _updateRecentSessions(sessionState);
    }

    async function _updateRecentSessions(session) {
        let recent = (await window.api.getParsedCache('recent_sessions')) || [];

        // Remove existing entry for this paper
        recent = recent.filter(s => s.paperKey !== session.paperKey);

        // Add to front
        recent.unshift({
            paperKey: session.paperKey,
            subjectCode: session.subjectCode,
            sessionLabel: session.sessionLabel,
            paperName: session.files.qp ? session.files.qp.name : '',
            timestamp: session.timestamp,
        });

        // Cap at 20
        if (recent.length > 20) recent = recent.slice(0, 20);

        await window.api.setParsedCache('recent_sessions', recent);
    }

    async function _loadAnnotations() {
        const data = await window.api.getParsedCache('annot_' + paperKey);
        if (!data) return;
        for (const [pageNum, strokes] of Object.entries(data)) {
            const eng = pageEngines[pageNum];
            if (eng) eng.importStrokes(strokes);
        }
    }

    async function _loadSessionState() {
        const state = await window.api.getParsedCache('session_' + paperKey);
        if (!state) return;

        // Restore zoom
        if (state.qpZoom) {
            qpZoom = state.qpZoom;
            pagesContainer.style.zoom = qpZoom;
            document.getElementById('solver-zoom-level').textContent = Math.round(qpZoom * 100) + '%';
        }
        if (state.refZoom && state.refZoom !== 1.0) {
            refZoom = state.refZoom;
            document.getElementById('ref-zoom-level').textContent = Math.round(refZoom * 100) + '%';
            _renderRefPages();
        }

        // Restore scroll position
        if (state.scrollTop && leftPane) {
            setTimeout(() => { leftPane.scrollTop = state.scrollTop; }, 100);
        }

        // Restore active ref tab
        if (state.activeRefTab && currentRefType !== state.activeRefTab) {
            const tabs = refTabs.querySelectorAll('.solver-tab');
            for (const tab of tabs) {
                if (tab.textContent.toLowerCase().includes(state.activeRefTab)) {
                    tab.click();
                    break;
                }
            }
        }
    }

    // Resume a session from the homepage
    async function resume(paperKey_) {
        const state = await window.api.getParsedCache('session_' + paperKey_);
        if (!state || !state.files || !state.files.qp) return false;

        // Reconstruct the files object
        await open(state.files, state.subjectCode, state.sessionLabel);
        return true;
    }

    // Auto-save hook — call from ink engine after stroke commit
    function notifyStrokeChange() {
        _scheduleSave();
    }

    // Save on window close
    window.addEventListener('beforeunload', () => {
        if (isOpen) _saveSession();
    });

    // ---- Divider Drag ----

    function _setupDivider() {
        let startX, startRightW, containerW;

        divider.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            startX = e.clientX;
            startRightW = rightPane.getBoundingClientRect().width;
            containerW = document.getElementById('solver-content').getBoundingClientRect().width;
            divider.setPointerCapture(e.pointerId);

            const onMove = (me) => {
                const delta = me.clientX - startX;
                // Dragging right = shrink reference, dragging left = expand reference
                const newRightW = Math.max(200, Math.min(startRightW - delta, containerW * 0.6));
                rightPane.style.width = newRightW + 'px';
            };

            const onUp = () => {
                divider.removeEventListener('pointermove', onMove);
                divider.removeEventListener('pointerup', onUp);
            };

            divider.addEventListener('pointermove', onMove);
            divider.addEventListener('pointerup', onUp);
        });
    }

    // ---- Helpers ----

    function _setActiveTool(tool) {
        document.querySelectorAll('.solver-tool').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tool === tool);
        });
        // Update cursor
        const canvases = document.querySelectorAll('.solver-ink-canvas');
        for (const c of canvases) {
            c.style.cursor = tool === 'eraser' ? 'cell' : 'crosshair';
        }
    }

    function _updatePageInfo() {
        const el = document.getElementById('solver-page-info');
        if (el && pdfDoc) el.textContent = `${pdfDoc.numPages} page${pdfDoc.numPages !== 1 ? 's' : ''}`;
    }

    // ---- Zoom ----

    function _applyQpZoom() {
        // CSS zoom affects layout (so scroll works) and getBoundingClientRect (so ink coords adapt)
        pagesContainer.style.zoom = qpZoom;
        document.getElementById('solver-zoom-level').textContent = Math.round(qpZoom * 100) + '%';
    }

    function zoomQpIn() { qpZoom = Math.min(3, qpZoom + 0.25); _applyQpZoom(); }
    function zoomQpOut() { qpZoom = Math.max(0.5, qpZoom - 0.25); _applyQpZoom(); }

    function zoomRefIn() {
        refZoom = Math.min(3, refZoom + 0.25);
        document.getElementById('ref-zoom-level').textContent = Math.round(refZoom * 100) + '%';
        _renderRefPages();
    }
    function zoomRefOut() {
        refZoom = Math.max(0.5, refZoom - 0.25);
        document.getElementById('ref-zoom-level').textContent = Math.round(refZoom * 100) + '%';
        _renderRefPages();
    }

    // ---- Expose ----
    return { open, close, setTool, setColor, setPenSize, undo, redo, clearAll, zoomQpIn, zoomQpOut, zoomRefIn, zoomRefOut, isOpen: () => isOpen, resume };
})();
