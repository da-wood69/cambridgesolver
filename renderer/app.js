// ============================================
// App Controller — Wires sidebar, browser, and viewer
// ============================================

// State
let currentSubject = null;
let navStack = [];
let currentSessionFiles = []; // raw file list for current session
let currentFileGroups = null;

// DOM Elements
const subjectListEl = document.getElementById('subject-list');
const addSubjectBtn = document.getElementById('add-subject-btn');
const breadcrumbEl = document.getElementById('breadcrumb');
const folderListEl = document.getElementById('folder-list');
const indexLoading = document.getElementById('index-loading');
const indexProgressContainer = document.getElementById('index-progress-container');
const indexProgressFill = document.getElementById('index-progress-fill');
const indexProgressText = document.getElementById('index-progress-text');
const indexErrorContainer = document.getElementById('index-error-container');
const indexErrorText = document.getElementById('index-error-text');
const emptyState = document.getElementById('empty-state');
const homeView = document.getElementById('home-view');
const modalOverlay = document.getElementById('modal-overlay');
const modalClose = document.getElementById('modal-close');
const subjectSearch = document.getElementById('subject-search');
const subjectCatalog = document.getElementById('subject-catalog');
const viewerClose = document.getElementById('viewer-close');

// ---- Initialize ----

document.addEventListener('DOMContentLoaded', async () => {
    renderSidebar();
    renderBreadcrumb();
    await showHomeView();

    document.getElementById('nav-home').addEventListener('click', async () => {
        currentSubject = null;
        navStack = [];
        closeViewer();
        renderSidebar();
        renderBreadcrumb();
        await showHomeView();
    });

    addSubjectBtn.addEventListener('click', openModal);
    modalClose.addEventListener('click', closeModal);
    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) closeModal();
    });
    subjectSearch.addEventListener('input', renderCatalog);
    viewerClose.addEventListener('click', closeViewer);

    // Traffic light window controls
    document.getElementById('tl-close').addEventListener('click', () => window.api.windowClose());
    document.getElementById('tl-minimize').addEventListener('click', () => window.api.windowMinimize());
    document.getElementById('tl-maximize').addEventListener('click', () => window.api.windowMaximize());

    // Gray out traffic lights when window loses focus
    const titlebar = document.querySelector('.titlebar');
    window.addEventListener('blur', () => titlebar.classList.add('unfocused'));
    window.addEventListener('focus', () => titlebar.classList.remove('unfocused'));

    if (window.api && window.api.onFetchProgress) {
        window.api.onFetchProgress((data) => {
            if (data.totalBytes > 0) {
                const pct = Math.round((data.receivedBytes / data.totalBytes) * 100);
                indexProgressFill.classList.add('determinate');
                indexProgressFill.style.width = pct + '%';
                indexProgressText.textContent = `Loading papers... ${pct}%`;
            } else {
                indexProgressFill.classList.remove('determinate');
                const kb = Math.round(data.receivedBytes / 1024);
                indexProgressText.textContent = `Loading papers... ${kb}KB`;
            }
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (SolverMode.isOpen()) {
                SolverMode.close();
            } else if (!document.getElementById('viewer-panel').classList.contains('hidden')) {
                closeViewer();
            } else if (!modalOverlay.classList.contains('hidden')) {
                closeModal();
            }
        }
        // Undo/Redo keyboard shortcuts for solver
        if (SolverMode.isOpen() && (e.ctrlKey || e.metaKey)) {
            if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); SolverMode.undo(); }
            if (e.key === 'z' && e.shiftKey) { e.preventDefault(); SolverMode.redo(); }
            if (e.key === 'y') { e.preventDefault(); SolverMode.redo(); }
        }
    });

    // ---- Solver toolbar wiring ----
    document.getElementById('solver-close-btn').addEventListener('click', () => SolverMode.close());
    document.getElementById('solver-undo').addEventListener('click', () => SolverMode.undo());
    document.getElementById('solver-redo').addEventListener('click', () => SolverMode.redo());

    document.querySelectorAll('.solver-tool').forEach(btn => {
        btn.addEventListener('click', () => SolverMode.setTool(btn.dataset.tool));
    });

    document.querySelectorAll('.solver-color').forEach(btn => {
        btn.addEventListener('click', () => SolverMode.setColor(btn.dataset.color));
    });

    document.querySelectorAll('.solver-size').forEach(btn => {
        btn.addEventListener('click', () => SolverMode.setPenSize(btn.dataset.size));
    });

    // Zoom controls
    document.getElementById('solver-zoom-in').addEventListener('click', () => SolverMode.zoomQpIn());
    document.getElementById('solver-zoom-out').addEventListener('click', () => SolverMode.zoomQpOut());
    document.getElementById('ref-zoom-in').addEventListener('click', () => SolverMode.zoomRefIn());
    document.getElementById('ref-zoom-out').addEventListener('click', () => SolverMode.zoomRefOut());
});

// ---- Sidebar ----

function renderSidebar() {
    const subjects = getAddedSubjects();
    subjectListEl.innerHTML = '';

    // Toggle active state for Home button
    const navHomeBtn = document.getElementById('nav-home');
    if (navHomeBtn) {
        if (!currentSubject) navHomeBtn.classList.add('active');
        else navHomeBtn.classList.remove('active');
    }

    if (subjects.length === 0) {
        subjectListEl.innerHTML = '<div style="padding:20px;color:var(--text-secondary);font-size:12px;text-align:center;">No subjects added yet</div>';
        return;
    }

    for (const s of subjects) {
        const el = document.createElement('div');
        el.className = 'subject-item' + (currentSubject?.code === s.code ? ' active' : '');
        el.innerHTML = `
      <span class="subject-name">${s.name}</span>
      <span class="subject-code">${s.code}</span>
      <button class="btn-remove" title="Remove">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    `;

        el.querySelector('.btn-remove').addEventListener('click', (e) => {
            e.stopPropagation();
            removeSubject(s.code);
            if (currentSubject?.code === s.code) {
                currentSubject = null;
                navStack = [];
                showHomeView();
                renderBreadcrumb();
            }
            renderSidebar();
        });

        el.addEventListener('click', () => selectSubject(s));
        subjectListEl.appendChild(el);
    }
}

async function selectSubject(subject) {
    if (currentSubject?.code === subject.code) return;
    currentSubject = subject;
    navStack = [];
    currentFileGroups = null;
    closeViewer();
    renderSidebar();
    await showYearSessions();
}

// ---- Navigation ----

async function showYearSessions() {
    hideEmptyState();
    showLoading();
    folderListEl.innerHTML = '';

    try {
        const folders = await fetchSubjectFolders(currentSubject.slug);

        hideLoading();

        if (folders.length === 0) {
            folderListEl.innerHTML = '<div style="padding:20px;color:var(--text-secondary);font-size:13px;text-align:center;">No papers found for this subject</div>';
            navStack = [{ level: 'subject', label: currentSubject.name }];
            renderBreadcrumb();
            return;
        }

        // Sort folders: newest first
        folders.sort((a, b) => {
            const pa = parseSessionFolder(a.name);
            const pb = parseSessionFolder(b.name);
            if (pa.year !== pb.year) return pb.year.localeCompare(pa.year);
            return a.name.localeCompare(b.name);
        });

        navStack = [{ level: 'subject', label: currentSubject.name }];
        renderBreadcrumb();

        for (const folder of folders) {
            const parsed = parseSessionFolder(folder.name);
            const displayName = parsed.session ? `${parsed.year} — ${parsed.session}` : parsed.year;
            // Folder icon
            const icon = `<svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;
            const el = createFolderItem(icon, displayName, '');
            el.addEventListener('click', () => showPaperVariants(folder));
            folderListEl.appendChild(el);
        }
    } catch (err) {
        showError(err.message);
    }
}

async function showPaperVariants(folder) {
    hideEmptyState();
    showLoading();
    folderListEl.innerHTML = '';

    try {
        const files = await fetchSessionFiles(folder.relPath);

        hideLoading();

        const parsed = parseSessionFolder(folder.name);
        const displayName = parsed.session ? `${parsed.year} — ${parsed.session}` : parsed.year;

        navStack = [
            { level: 'subject', label: currentSubject.name },
            { level: 'session', label: displayName, data: { folder } },
        ];
        renderBreadcrumb();

        if (files.length === 0) {
            folderListEl.innerHTML = '<div style="padding:20px;color:var(--text-secondary);font-size:13px;text-align:center;">No papers found for this session</div>';
            return;
        }

        // Group files by paper+variant
        currentFileGroups = groupFilesByPaperVariant(files, currentSubject.code);
        const groupKeys = Object.keys(currentFileGroups).filter(k => k !== '_other').sort();

        // Show paper/variant groups
        for (const key of groupKeys) {
            const group = currentFileGroups[key];
            const fileCount = Object.keys(group).length;
            // Layers icon
            const icon = `<svg viewBox="0 0 24 24"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>`;
            const el = createFolderItem(icon, key, `${fileCount} file${fileCount !== 1 ? 's' : ''}`);
            el.addEventListener('click', () => showGroupFiles(key, folder, displayName));
            folderListEl.appendChild(el);
        }

        // Show "other" files (grade thresholds, examiner reports, etc.)
        if (currentFileGroups['_other']) {
            const other = currentFileGroups['_other'];

            const icons = {
                gt: `<svg viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>`,
                er: `<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`,
                doc: `<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`
            };

            for (const [type, file] of Object.entries(other)) {
                const icon = type === 'gt' ? icons.gt : type === 'er' ? icons.er : icons.doc;
                const el = createFileItem(icon, file.label, file.name);
                el.addEventListener('click', () => {
                    const url = buildDownloadUrl(file.relPath);
                    loadPdf(url, file.label);
                });
                folderListEl.appendChild(el);
            }
        }
    } catch (err) {
        showError(err.message);
    }
}

function showGroupFiles(groupKey, folder, sessionLabel) {
    folderListEl.innerHTML = '';
    const group = currentFileGroups[groupKey];

    navStack = [
        { level: 'subject', label: currentSubject.name },
        { level: 'session', label: sessionLabel, data: { folder } },
        { level: 'group', label: groupKey, data: { folder, groupKey } },
    ];
    renderBreadcrumb();

    // Add "Start Solving" button if QP exists
    if (group.qp) {
        const solveBtn = document.createElement('button');
        solveBtn.className = 'solve-btn';
        solveBtn.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
            Start Solving
        `;
        solveBtn.addEventListener('click', () => {
            SolverMode.open(group, currentSubject.code, sessionLabel);
        });
        folderListEl.appendChild(solveBtn);
    }

    // Show QP first, then MS, then others
    const order = ['qp', 'ms', 'in', 'sp', 'ci', 'pm', 'sf', 'su'];
    const docIcon = `<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`;
    const qpIcon = `<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`;
    const msIcon = `<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><polyline points="9 15 11 17 16 12"></polyline></svg>`;
    const inIcon = `<svg viewBox="0 0 24 24"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>`;
    const spIcon = `<svg viewBox="0 0 24 24"><path d="M10 2v7.31"></path><path d="M14 9.3V1.99"></path><path d="M8.5 2h7"></path><path d="M14 9.3a6.5 6.5 0 1 1-4 0"></path><path d="M5.52 16h12.96"></path></svg>`;
    const ciIcon = `<svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`;

    const icons = { qp: qpIcon, ms: msIcon, in: inIcon, sp: spIcon, ci: ciIcon };

    const shown = new Set();
    for (const type of order) {
        if (group[type]) {
            shown.add(type);
            const f = group[type];
            const el = createFileItem(icons[type] || docIcon, f.label, f.name);
            el.addEventListener('click', () => {
                const url = buildDownloadUrl(f.relPath);
                loadPdf(url, f.label + ' — ' + f.name);
            });
            folderListEl.appendChild(el);
        }
    }

    // Any remaining types not in order
    for (const [type, f] of Object.entries(group)) {
        if (!shown.has(type)) {
            const el = createFileItem(docIcon, f.label, f.name);
            el.addEventListener('click', () => {
                const url = buildDownloadUrl(f.relPath);
                loadPdf(url, f.label + ' — ' + f.name);
            });
            folderListEl.appendChild(el);
        }
    }
}

// ---- Breadcrumb ----

function renderBreadcrumb() {
    breadcrumbEl.innerHTML = '';

    if (navStack.length === 0) {
        breadcrumbEl.innerHTML = '<span class="crumb-current">Home</span>';
        return;
    }

    for (let i = 0; i < navStack.length; i++) {
        if (i > 0) {
            const sep = document.createElement('span');
            sep.className = 'crumb-sep';
            sep.textContent = '›';
            breadcrumbEl.appendChild(sep);
        }

        const item = navStack[i];
        if (i === navStack.length - 1) {
            const crumb = document.createElement('span');
            crumb.className = 'crumb-current';
            crumb.textContent = item.label;
            breadcrumbEl.appendChild(crumb);
        } else {
            const crumb = document.createElement('span');
            crumb.className = 'crumb';
            crumb.textContent = item.label;
            const idx = i;
            crumb.addEventListener('click', () => navigateToBreadcrumb(idx));
            breadcrumbEl.appendChild(crumb);
        }
    }
}

function navigateToBreadcrumb(index) {
    const item = navStack[index];
    if (item.level === 'subject') {
        showYearSessions();
    } else if (item.level === 'session') {
        showPaperVariants(item.data.folder);
    }
}

// ---- DOM Helpers ----

function createFolderItem(icon, label, meta) {
    const el = document.createElement('div');
    el.className = 'folder-item';
    el.innerHTML = `
    <span class="item-icon">${icon}</span>
    <span class="item-label">${label}</span>
    <span class="item-meta">${meta}</span>
  `;
    return el;
}

function createFileItem(icon, label, meta) {
    const el = document.createElement('div');
    el.className = 'file-item';
    el.innerHTML = `
    <span class="item-icon">${icon}</span>
    <span class="item-label">${label}</span>
    <span class="item-meta">${meta}</span>
  `;
    return el;
}

function showLoading() {
    indexLoading.classList.remove('hidden');
    indexProgressContainer.classList.remove('hidden');
    indexErrorContainer.classList.add('hidden');
    indexProgressFill.style.width = '0%';
    indexProgressFill.classList.remove('determinate');
    indexProgressText.textContent = 'Loading papers...';
    emptyState.classList.add('hidden');
    homeView.classList.add('hidden');
}

function hideLoading() {
    indexLoading.classList.add('hidden');
}

function showError(message) {
    indexLoading.classList.remove('hidden');
    indexProgressContainer.classList.add('hidden');
    indexErrorContainer.classList.remove('hidden');
    indexErrorText.textContent = message;
    emptyState.classList.add('hidden');
    homeView.classList.add('hidden');
}

async function showHomeView() {
    folderListEl.innerHTML = '';
    emptyState.classList.add('hidden');

    // Fetch recent sessions
    const recent = await window.api.getParsedCache('recent_sessions');
    const container = document.getElementById('recent-sessions-container');
    const list = document.getElementById('recent-sessions-list');

    if (recent && recent.length > 0) {
        list.innerHTML = recent.map(session => `
            <div class="recent-card" data-key="${session.paperKey}">
                <div class="recent-card-title">${session.paperName || 'Unknown Paper'}</div>
                <div class="recent-card-meta">
                    <span>${session.subjectCode} • ${session.sessionLabel}</span>
                    <span>${new Date(session.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
            </div>
        `).join('');

        // Wait for next tick so DOM elements are available
        setTimeout(() => {
            list.querySelectorAll('.recent-card').forEach(card => {
                card.addEventListener('click', async () => {
                    const key = card.dataset.key;
                    const success = await SolverMode.resume(key);
                    if (!success) {
                        alert('Could not resume session. The files may have been cleared from cache.');
                    }
                });
            });
        }, 0);

        container.classList.remove('hidden');
    } else {
        container.classList.add('hidden');
    }

    homeView.classList.remove('hidden');
}

function showEmptyState() {
    folderListEl.innerHTML = '';
    homeView.classList.add('hidden');
    emptyState.classList.remove('hidden');
}

function hideEmptyState() {
    emptyState.classList.add('hidden');
}

// ---- Modal ----

function openModal() {
    modalOverlay.classList.remove('hidden');
    subjectSearch.value = '';
    subjectSearch.focus();
    renderCatalog();
}

function closeModal() {
    modalOverlay.classList.add('hidden');
}

function renderCatalog() {
    const query = subjectSearch.value.toLowerCase().trim();
    subjectCatalog.innerHTML = '';

    const filtered = SUBJECT_CATALOG.filter(s =>
        s.name.toLowerCase().includes(query) || s.code.includes(query)
    );

    for (const s of filtered) {
        const added = isSubjectAdded(s.code);
        const el = document.createElement('div');
        el.className = 'catalog-item' + (added ? ' added' : '');
        el.innerHTML = `
      <span class="cat-name">${s.name}</span>
      <span class="cat-code">${s.code}${added ? ' ✓' : ''}</span>
    `;

        if (!added) {
            el.addEventListener('click', () => {
                addSubject(s);
                renderSidebar();
                renderCatalog();
            });
        }

        subjectCatalog.appendChild(el);
    }
}
