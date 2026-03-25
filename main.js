const { app, BrowserWindow, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const https = require('https');
const http = require('http');
const fs = require('fs');
const os = require('os');

const CACHE_DIR = path.join(os.homedir(), '.cie-papers-cache');
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'CIE Past Papers',
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    autoHideMenuBar: true,
    show: false,
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());

  // Window control IPC
  ipcMain.on('window-minimize', () => win.minimize());
  ipcMain.on('window-maximize', () => {
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on('window-close', () => win.close());
}

app.whenReady().then(() => {
  createWindow();
  
  // Try to check for updates (only works in packaged app)
  autoUpdater.checkForUpdatesAndNotify().catch(err => {
    console.error('Failed to check for updates:', err);
  });
});

app.on('window-all-closed', () => app.quit());

// --- IPC Handlers ---

function fetchUrl(url, onProgress) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let redirectUrl = res.headers.location;
        if (!redirectUrl.startsWith('http')) {
            const parsedBase = new URL(url);
            redirectUrl = new URL(redirectUrl, parsedBase.origin).toString();
        }
        // Fix: some servers leak localhost dev URLs in redirects
        try {
            const parsed = new URL(redirectUrl);
            if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1') {
                const originalParsed = new URL(url);
                parsed.hostname = originalParsed.hostname;
                parsed.port = '';
                parsed.protocol = originalParsed.protocol;
                redirectUrl = parsed.toString();
            }
        } catch (e) { /* ignore parse errors */ }
        return fetchUrl(redirectUrl, onProgress).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
      let receivedBytes = 0;
      res.on('data', (chunk) => {
        chunks.push(chunk);
        receivedBytes += chunk.length;
        if (onProgress) {
          onProgress(receivedBytes, totalBytes);
        }
      });
      res.on('end', () => resolve({ buffer: Buffer.concat(chunks), totalBytes, receivedBytes }));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// Download a PDF with progress
ipcMain.handle('download-paper', async (event, url) => {
  // Check cache first
  const cacheKey = Buffer.from(url).toString('base64url');
  const cachePath = path.join(CACHE_DIR, cacheKey + '.pdf');

  if (fs.existsSync(cachePath)) {
    const data = fs.readFileSync(cachePath);
    event.sender.send('download-progress', { receivedBytes: data.length, totalBytes: data.length });
    return { data: data.buffer, fromCache: true };
  }

  try {
    const { buffer } = await fetchUrl(url, (receivedBytes, totalBytes) => {
      event.sender.send('download-progress', { receivedBytes, totalBytes });
    });
    // Cache it
    fs.writeFileSync(cachePath, buffer);
    // Return ArrayBuffer
    return { data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), fromCache: false };
  } catch (err) {
    throw new Error(`Failed to download: ${err.message}`);
  }
});

// Fetch a directory listing (HTML) from GCE Guide
ipcMain.handle('fetch-directory', async (event, url) => {
  // Cache directory listings for 1 hour
  const cacheKey = 'dir_' + Buffer.from(url).toString('base64url');
  const cachePath = path.join(CACHE_DIR, cacheKey + '.html');

  if (fs.existsSync(cachePath)) {
    const stat = fs.statSync(cachePath);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs < 3600000) { // 1 hour cache
      const html = fs.readFileSync(cachePath, 'utf-8');
      event.sender.send('fetch-progress', { receivedBytes: html.length, totalBytes: html.length });
      return html;
    }
  }

  try {
    const { buffer } = await fetchUrl(url, (receivedBytes, totalBytes) => {
      event.sender.send('fetch-progress', { receivedBytes, totalBytes });
    });
    const html = buffer.toString('utf-8');
    fs.writeFileSync(cachePath, html, 'utf-8');
    return html;
  } catch (err) {
    throw new Error(`Failed to fetch directory: ${err.message}`);
  }
});

// Get parsed JSON cache
ipcMain.handle('get-parsed-cache', async (event, key) => {
  const cacheKey = 'json_' + Buffer.from(key).toString('base64url');
  const cachePath = path.join(CACHE_DIR, cacheKey + '.json');
  
  if (fs.existsSync(cachePath)) {
    try {
      const data = fs.readFileSync(cachePath, 'utf-8');
      return JSON.parse(data);
    } catch (e) {
      return null;
    }
  }
  return null;
});

// Set parsed JSON cache
ipcMain.handle('set-parsed-cache', async (event, key, data) => {
  const cacheKey = 'json_' + Buffer.from(key).toString('base64url');
  const cachePath = path.join(CACHE_DIR, cacheKey + '.json');
  
  try {
    fs.writeFileSync(cachePath, JSON.stringify(data), 'utf-8');
    return true;
  } catch (e) {
    return false;
  }
});

// Clear cache
ipcMain.handle('clear-cache', async () => {
  const files = fs.readdirSync(CACHE_DIR);
  for (const file of files) {
    fs.unlinkSync(path.join(CACHE_DIR, file));
  }
  return true;
});
