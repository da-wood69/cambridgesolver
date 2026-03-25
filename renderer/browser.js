// ============================================
// Past Paper Browser — pastpapers.co Directory Indexing
// ============================================

const BASE_URL = 'https://pastpapers.co/cie';

/**
 * Fetch a pastpapers.co directory page and extract the entries JSON from the
 * React Server Components payload embedded in the HTML.
 * @param {string} pathOrRelPath - Either a subject slug like "Physics-9702"
 *   or a full relPath like "A-Level/Physics-9702/2024-May-June"
 */
async function fetchDirectoryEntries(pathOrRelPath) {
    // Check disk JSON cache first
    const diskCache = await window.api.getParsedCache(pathOrRelPath);
    if (diskCache) return diskCache;

    // The web route uses lowercase segments for the level part
    // relPath from entries: "A-Level/Physics-9702/2024-May-June"
    // web URL: /cie/a-level/Physics-9702/2024-May-June/
    let urlPath = pathOrRelPath;
    if (urlPath.startsWith('A-Level/')) {
        urlPath = 'a-level/' + urlPath.substring('A-Level/'.length);
    }
    // If it's just a subject slug (no A-Level/ prefix), prepend a-level/
    if (!urlPath.startsWith('a-level/')) {
        urlPath = 'a-level/' + urlPath;
    }

    const url = `${BASE_URL}/${urlPath}/`;

    try {
        const html = await window.api.fetchDirectory(url);
        const entries = parseRSCEntries(html);

        // Save parsing result to disk
        await window.api.setParsedCache(pathOrRelPath, entries);

        return entries;
    } catch (err) {
        console.error(`Failed to index ${pathOrRelPath}:`, err);
        throw err;
    }
}

/**
 * Parse the React Server Component inline payload to extract the "entries" array.
 * The entries are embedded in script tags as JSON within the RSC stream.
 */
function parseRSCEntries(html) {
    // The entries array is embedded like: "entries":[{...},{...}]
    // We need to find and extract this JSON array
    const entries = [];

    try {
        // Look for the entries pattern in RSC payload
        // It appears as: \"entries\":[{\"name\":...},...,{\"name\":...}]
        // But it's double-escaped in the HTML script tags

        // Strategy: find all name/relPath/isDir objects in the raw HTML
        // They appear as: {\"name\":\"...\",\"relPath\":\"...\",\"isDir\":true/false,...}
        // But double-escaped: {\\\"name\\\":\\\"...\\\",\\\"relPath\\\":\\\"...\\\",\\\"isDir\\\":true,...}

        // Find the entries array - look for "entries":[ pattern (escaped)
        const entriesRegex = /\\?"entries\\?":\s*\[/g;
        let match = entriesRegex.exec(html);
        if (!match) return entries;

        // Find the start of the array
        const startIdx = match.index + match[0].length - 1;

        // Now we need to find the matching ] bracket, accounting for nesting
        let depth = 0;
        let endIdx = startIdx;
        for (let i = startIdx; i < html.length; i++) {
            if (html[i] === '[') depth++;
            else if (html[i] === ']') {
                depth--;
                if (depth === 0) {
                    endIdx = i + 1;
                    break;
                }
            }
        }

        let jsonStr = html.substring(startIdx, endIdx);

        // Unescape the JSON string (it may be double/triple escaped)
        // Remove outer escaping layers
        while (jsonStr.includes('\\"')) {
            jsonStr = jsonStr.replace(/\\"/g, '"');
        }
        while (jsonStr.includes('\\\\')) {
            jsonStr = jsonStr.replace(/\\\\/g, '\\');
        }
        // Handle unicode escapes
        jsonStr = jsonStr.replace(/\\u([0-9a-fA-F]{4})/g, (m, code) =>
            String.fromCharCode(parseInt(code, 16))
        );

        const parsed = JSON.parse(jsonStr);
        return parsed;
    } catch (err) {
        console.error('Failed to parse RSC entries:', err);

        // Fallback: regex-based extraction of individual entries
        const itemRegex = /\{[^{}]*?"name"\s*:\s*"([^"]+)"[^{}]*?"relPath"\s*:\s*"([^"]+)"[^{}]*?"isDir"\s*:\s*(true|false)[^{}]*?\}/g;
        let itemMatch;
        const seen = new Set();
        while ((itemMatch = itemRegex.exec(html)) !== null) {
            const name = itemMatch[1];
            const relPath = itemMatch[2];
            const isDir = itemMatch[3] === 'true';
            if (!seen.has(relPath)) {
                seen.add(relPath);
                entries.push({ name, relPath, isDir });
            }
        }
        return entries;
    }
}

/**
 * Fetch the list of available year/session folders for a subject.
 * Returns entries like: { name: "2024-May-June", relPath: "A-Level/Physics-9702/2024-May-June", isDir: true }
 */
async function fetchSubjectFolders(subjectSlug) {
    const entries = await fetchDirectoryEntries(subjectSlug);
    // Filter to only year/session directories (exclude Notes, Syllabus, Solved, Topical)
    return entries.filter(e => e.isDir && /^\d{4}/.test(e.name));
}

/**
 * Fetch the files inside a specific year/session folder.
 * Returns entries like: { name: "9702_s24_qp_11.pdf", relPath: "...", isDir: false }
 */
async function fetchSessionFiles(relPath) {
    const entries = await fetchDirectoryEntries(relPath);
    return entries.filter(e => !e.isDir && e.name.endsWith('.pdf'));
}

/**
 * Parse a session folder name into a structured object.
 * Handles formats like "2024-May-June", "2024-Oct-Nov", "2024-March", "2022-Feb-March", "2017"
 */
function parseSessionFolder(name) {
    // Try year-session format first
    const match = name.match(/^(\d{4})[-\s](.+)$/);
    if (match) {
        return { year: match[1], session: match[2].replace(/-/g, ' ') };
    }
    // Just a year (older papers)
    if (/^\d{4}$/.test(name)) {
        return { year: name, session: 'All Sessions' };
    }
    return { year: name, session: '' };
}

/**
 * Given a list of PDF filenames from a session folder, group them by paper+variant.
 * Returns: { 'Paper 1 Variant 1': { qp: {...}, ms: {...} }, ... }
 */
function groupFilesByPaperVariant(files, subjectCode) {
    const groups = {};

    const typeLabels = {
        'qp': 'Question Paper',
        'ms': 'Mark Scheme',
        'in': 'Insert',
        'gt': 'Grade Threshold',
        'er': 'Examiner Report',
        'sp': 'Specimen Paper',
        'ci': 'Confidential Instructions',
        'ir': 'Information Report',
        'sf': 'Source Files',
        'su': 'Supplementary',
        'pm': 'Pre-release Material',
    };

    for (const file of files) {
        // Pattern: 9702_s24_qp_11.pdf or 9702_s24_ms_11.pdf
        const match = file.name.match(/^(\d{4})_([swm])(\d{2})_(qp|ms|in|gt|er|sp|ci|ir|sf|su|pm)(?:_(\d)(\d))?\.pdf$/i);
        if (match) {
            const [, code, session, yy, type, paper, variant] = match;

            if (paper && variant) {
                const key = `Paper ${paper} Variant ${variant}`;
                if (!groups[key]) groups[key] = {};
                groups[key][type] = {
                    name: file.name,
                    relPath: file.relPath,
                    label: typeLabels[type] || type.toUpperCase(),
                };
            } else {
                // Files without paper/variant (like gt, er)
                const key = typeLabels[type] || type.toUpperCase();
                if (!groups['_other']) groups['_other'] = {};
                groups['_other'][type] = {
                    name: file.name,
                    relPath: file.relPath,
                    label: key,
                };
            }
        } else {
            // Non-standard filename - put as-is
            if (!groups['_other']) groups['_other'] = {};
            groups['_other'][file.name] = {
                name: file.name,
                relPath: file.relPath,
                label: file.name,
            };
        }
    }

    return groups;
}

/**
 * Build a direct download URL for a PDF file on pastpapers.co.
 * PDFs are served via the /api/file/ endpoint.
 */
function buildDownloadUrl(relPath) {
    // pastpapers.co serves PDFs through /api/file/caie/{relPath}
    return `https://pastpapers.co/api/file/caie/${relPath.split('/').map(p => encodeURIComponent(p)).join('/')}`;
}
