/* ==================== Workbench Aurora — Electron main ====================
   Fully offline Linux desktop shell.
   - Serves the static export (out/) through a custom app:// protocol so
     absolute /_next paths, localStorage and IndexedDB all work with a proper
     origin — and nothing ever touches the network.
   - Data persistence: localStorage + IndexedDB live in the Electron userData
     profile, so the workspace survives restarts. */

const { app, BrowserWindow, protocol, net, shell, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { execFile } = require('node:child_process');
const { ipcMain } = require('electron');

const DIST = path.join(__dirname, '..', 'out');
const APP_ORIGIN = 'app://workbench-aurora'; // standard scheme → absolute /_next paths resolve

/* the app is pure 2D (pdf.js canvas + DOM) — hardware acceleration only adds
   a GPU-process crash class on flaky Linux drivers (dead/grey window that
   reads like a failed navigation). Software rendering is deterministic. */
app.disableHardwareAcceleration();

/* lightweight diagnostics: failures land in <userData>/diagnostics.log so a
   reported "the app doesn't open X" always comes with evidence */
function appendDiag(line) {
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'diagnostics.log'), `${new Date().toISOString()} ${line}\n`);
  } catch {
    /* diagnostics must never break the app */
  }
}

let win = null;

/* ---------- single instance ---------- */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

/* ---------- app:// protocol ----------
   Scheme registration MUST happen before app-ready; the handler installs after. */
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

function installProtocolHandler() {
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/index.html';

    const resolved = path.normalize(path.join(DIST, pathname));
    // never escape the dist directory
    if (!resolved.startsWith(DIST)) {
      return new Response('Forbidden', { status: 403 });
    }
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      // SPA-ish fallback: unknown non-asset paths go to index.html
      const fallback = path.join(DIST, 'index.html');
      if (fs.existsSync(fallback)) return net.fetch(pathToFileURL(fallback).toString());
      return new Response('Not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(resolved).toString());
  });
}

/* ---------- native helpers ---------- */

/* poppler's pdftotext: reading-order extraction that handles legacy
   Persian/Arabic font encodings far better than in-browser extractors.
   The renderer sends the PDF bytes; pages come back separated by \f. */
ipcMain.handle('wb-pdftotext', async (_e, bytes) => {
  /* structured clone delivers the bytes as a Uint8Array (Buffer loses its
     branding over IPC) — accept any typed array / buffer view */
  if (!(bytes instanceof Uint8Array) && !Buffer.isBuffer(bytes) && !Array.isArray(bytes)) {
    throw new Error('bad payload');
  }
  const tmp = path.join(app.getPath('temp'), `wb-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  try {
    await fs.promises.writeFile(tmp, Buffer.from(bytes));
    return await new Promise((resolve, reject) => {
      execFile('pdftotext', ['-enc', 'UTF-8', tmp, '-'], { maxBuffer: 128 * 1024 * 1024, timeout: 120000 }, (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout);
      });
    });
  } finally {
    fs.promises.unlink(tmp).catch(() => {});
  }
});

/* ---------- window ---------- */
function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 980,
    minHeight: 640,
    show: false,
    backgroundColor: '#f5f4f1',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    title: 'Workbench Aurora',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  win.once('ready-to-show', () => win.show());

  /* CI smoke mode: SMOKE=1 verifies the UI actually rendered, then exits.
     SMOKE=2 additionally tries to navigate the renderer to file:// and
     asserts the will-navigate guard kept the app alive.
     Run with: SMOKE=1 electron . --ozone-platform=headless */
  if (process.env.SMOKE) {
    win.webContents.once('did-finish-load', async () => {
      try {
        if (process.env.SMOKE === '2') {
          await win.webContents.executeJavaScript(`location.href = 'file:///etc/hostname'; true;`);
          await new Promise((r) => setTimeout(r, 900));
          const still = await win.webContents.executeJavaScript(
            `({ title: document.title, ready: !!document.querySelector('.wb-app') })`
          );
          console.log('[smoke2]', JSON.stringify(still));
          process.exit(still.ready ? 0 : 4);
          return;
        }
        const result = await win.webContents.executeJavaScript(
          `(() => ({ title: document.title, ready: !!document.querySelector('.wb-app'), nav: document.querySelectorAll('.navlink').length }))()`
        );
        const ok = result.ready && result.nav >= 8;
        console.log('[smoke]', JSON.stringify(result));
        process.exit(ok ? 0 : 3);
      } catch (err) {
        console.error('[smoke] failed', err);
        process.exit(3);
      }
    });
  }

  // open real <a target="_blank"> links in the system browser, not a new window
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  /* never let the renderer navigate away from the app: dropping a file on the
     window makes Chromium navigate to file://…pdf (→ "This page couldn't
     load", there is no PDF viewer) — the renderer guards drops too, this is
     the belt to its braces */
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith(APP_ORIGIN)) return;
    appendDiag(`will-navigate blocked: ${url}`);
    e.preventDefault();
  });

  /* every failed load gets logged AND replaced by the app itself — the
     Chromium error page must never be the user's terminal state */
  win.webContents.on('did-fail-load', (_e, code, desc, url, isMain) => {
    if (!isMain) return;
    appendDiag(`did-fail-load ${code} ${desc} ${url}`);
    setTimeout(() => {
      if (win && !win.isDestroyed()) void win.loadURL(`${APP_ORIGIN}/index.html`);
    }, 250);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    appendDiag(`renderer gone: ${details.reason}`);
    setTimeout(() => {
      if (win && !win.isDestroyed()) void win.loadURL(`${APP_ORIGIN}/index.html`);
    }, 400);
  });

  win.on('closed', () => {
    win = null;
  });

  void win.loadURL(`${APP_ORIGIN}/index.html`);
}

/* ---------- lifecycle ---------- */
app.whenReady().then(() => {
  installProtocolHandler();

  Menu.setApplicationMenu(null);

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
