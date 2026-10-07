/* ==================== Workbench Aurora — preload ====================
   Sandboxed bridge: the renderer asks the main process to run native
   helpers. Exposed as window.wbNative (undefined in a plain browser). */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wbNative', {
  /** Extract text from PDF bytes with poppler's pdftotext — pages separated
      by \f, reading order and legacy Persian/Arabic encodings handled. */
  pdftotext: (bytes) => ipcRenderer.invoke('wb-pdftotext', bytes),
});
