const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    downloadPaper: (url) => ipcRenderer.invoke('download-paper', url),
    fetchDirectory: (url) => ipcRenderer.invoke('fetch-directory', url),
    clearCache: () => ipcRenderer.invoke('clear-cache'),
    getParsedCache: (key) => ipcRenderer.invoke('get-parsed-cache', key),
    setParsedCache: (key, data) => ipcRenderer.invoke('set-parsed-cache', key, data),
    onDownloadProgress: (callback) => ipcRenderer.on('download-progress', (event, data) => callback(data)),
    onFetchProgress: (callback) => ipcRenderer.on('fetch-progress', (event, data) => callback(data)),
    windowMinimize: () => ipcRenderer.send('window-minimize'),
    windowMaximize: () => ipcRenderer.send('window-maximize'),
    windowClose: () => ipcRenderer.send('window-close'),
});
