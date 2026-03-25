// ============================================
// PDF Viewer — Using PDF.js built-in viewer via blob URL
// ============================================

let currentBlobUrl = null;

document.addEventListener('DOMContentLoaded', () => {
    if (window.api && window.api.onDownloadProgress) {
        window.api.onDownloadProgress((data) => {
            const progressFill = document.getElementById('progress-fill');
            const progressText = document.getElementById('progress-text');
            
            if (data.totalBytes > 0) {
                const pct = Math.round((data.receivedBytes / data.totalBytes) * 100);
                progressFill.classList.add('determinate');
                progressFill.style.width = pct + '%';
                progressText.textContent = `Downloading... ${pct}%`;
            } else {
                progressFill.classList.remove('determinate');
                const kb = Math.round(data.receivedBytes / 1024);
                progressText.textContent = `Downloading... ${kb}KB`;
            }
        });
    }
});

/**
 * Load and display a PDF from a remote URL.
 * Shows progress bar during download.
 */
async function loadPdf(url, title) {
    const viewerPanel = document.getElementById('viewer-panel');
    const progress = document.getElementById('download-progress');
    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('progress-text');
    const pdfFrame = document.getElementById('pdf-frame');
    const viewerTitle = document.getElementById('viewer-title');

    // Show viewer panel
    viewerPanel.classList.remove('hidden');
    viewerTitle.textContent = title || 'Loading...';

    // Show progress
    progress.classList.remove('hidden');
    pdfFrame.style.display = 'none';
    progressFill.classList.remove('determinate');
    progressFill.style.width = '0%';
    progressText.textContent = 'Downloading...';

    try {
        const result = await window.api.downloadPaper(url);

        if (result.fromCache) {
            progressText.textContent = 'Loading from cache...';
        }

        // Clean up old blob URL
        if (currentBlobUrl) {
            URL.revokeObjectURL(currentBlobUrl);
        }

        // Create blob URL from the ArrayBuffer
        const blob = new Blob([result.data], { type: 'application/pdf' });
        currentBlobUrl = URL.createObjectURL(blob);

        // Hide progress, show PDF
        progress.classList.add('hidden');
        pdfFrame.src = currentBlobUrl;
        pdfFrame.style.display = 'block';
        viewerTitle.textContent = title;

    } catch (err) {
        progressText.textContent = `Error: ${err.message}`;
        progressFill.style.display = 'none';
        console.error('PDF load error:', err);
    }
}

/**
 * Close the PDF viewer.
 */
function closeViewer() {
    const viewerPanel = document.getElementById('viewer-panel');
    const pdfFrame = document.getElementById('pdf-frame');

    viewerPanel.classList.add('hidden');
    pdfFrame.src = '';
    pdfFrame.style.display = 'none';

    if (currentBlobUrl) {
        URL.revokeObjectURL(currentBlobUrl);
        currentBlobUrl = null;
    }
}

// Zoom controls
let currentZoom = 100;

function zoomIn() {
    currentZoom = Math.min(200, currentZoom + 20);
    applyZoom();
}

function zoomOut() {
    currentZoom = Math.max(40, currentZoom - 20);
    applyZoom();
}

function applyZoom() {
    document.getElementById('zoom-level').textContent = currentZoom + '%';
    const frame = document.getElementById('pdf-frame');
    frame.style.transform = `scale(${currentZoom / 100})`;
    frame.style.transformOrigin = 'top left';
    frame.style.width = `${10000 / currentZoom}%`;
    frame.style.height = `${10000 / currentZoom}%`;
}
