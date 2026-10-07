# Installing & updating Workbench Aurora

Workbench Aurora ships as two Linux packages built from this repo:

| Package | Best for |
|---|---|
| `Workbench Aurora-<version>-x86_64.AppImage` | Portable single file — run from anywhere, no root needed |
| `Workbench Aurora-<version>-amd64.deb` | System install on Debian/Ubuntu/Mint & friends — menu launcher, updates with your package manager |

Both are the same app. **Pick one — you don't need both.**

---

## Requirements

- 64-bit Linux (x86_64), glibc-based distro (Debian/Ubuntu/Mint/Pop!_OS/elementary, Arch via deb extract, etc.)
- ~250 MB free disk space
- **No internet needed at any point after you have the package file** — no account, no server, no telemetry. The app never opens a network socket.

---

## Install — AppImage (portable)

```bash
# 1. put it somewhere you keep apps (optional but tidy)
mkdir -p ~/Apps
cp "Workbench Aurora-1.0.0-x86_64.AppImage" ~/Apps/

# 2. make it executable
chmod +x ~/Apps/"Workbench Aurora-1.0.0-x86_64.AppImage"

# 3. run it
~/Apps/"Workbench Aurora-1.0.0-x86_64.AppImage"
```

To get a menu entry for the AppImage, create `~/.local/share/applications/workbench-aurora.desktop`:

```ini
[Desktop Entry]
Type=Application
Name=Workbench Aurora
Comment=Local-first productivity workbench — fully offline
Exec=/home/YOURNAME/Apps/Workbench Aurora-1.0.0-x86_64.AppImage
Icon=workbench-aurora
Terminal=false
Categories=Office;
StartupWMClass=workbench-aurora
```

(Replace `YOURNAME`, and update the `Exec` path whenever the version in the filename changes — or rename the file to drop the version.)

## Install — deb (system)

```bash
sudo apt install ./Workbench Aurora-1.0.0-amd64.deb
# or: sudo dpkg -i Workbench Aurora-1.0.0-amd64.deb
```

This installs:

- the binary as `workbench-aurora` — launch from your app menu (**Office** category) or run `workbench-aurora` in a terminal
- a desktop entry with `StartupWMClass=workbench-aurora` so your dock groups the window correctly

Remove it any time with `sudo apt remove workbench-aurora` — your data (below) is untouched.

---

## Where your data lives

All data is local, stored **outside** the program files:

| What | Where |
|---|---|
| Everything (library metadata, goals, habits, journal, stats, settings) | `~/.config/workbench-aurora/` |
| Imported PDFs & markdown (blobs, covers, annotations) | IndexedDB inside that same profile |

**Installing, updating, or removing the app never touches this folder.**

Back up with **Settings → Backup & data → Export** (JSON) for an extra copy; the PDF files themselves stay in the profile, so for a full backup copy `~/.config/workbench-aurora/` while the app is closed.

---

## Updating

Updates are manual by design — the app is fully offline and never checks anything. When you have a newer package (rebuilt via `npm run app:build`, or received as a file):

**AppImage:** delete the old file, copy the new one, keep it executable. If you made a `.desktop` entry, point its `Exec` at the new file (or rename the new file to the old name). That's all.

```bash
rm ~/Apps/"Workbench Aurora-1.0.0-x86_64.AppImage"
cp "Workbench Aurora-1.1.0-x86_64.AppImage" ~/Apps/
chmod +x ~/Apps/"Workbench Aurora-1.1.0-x86_64.AppImage"
```

**deb:** just install the new package over the old one — it upgrades in place:

```bash
sudo apt install ./"Workbench Aurora-1.1.0-amd64.deb"
```

**Your data survives every update** — the profile in `~/.config/workbench-aurora/` is versioned and migrated automatically by the app on first launch after an update. Even so, an **Export** backup before a major update is good hygiene.

You can verify which build you're on from the package filename, or inside the app: **Settings → About** shows the version.

---

## Troubleshooting

**AppImage won't start** (`dlopen(): error loading libfuse.so.2`): AppImages need FUSE.

```bash
sudo apt install libfuse2          # Debian/Ubuntu/Mint
```

or run without FUSE:

```bash
./"Workbench Aurora-1.0.0-x86_64.AppImage" --appimage-extract-and-run
```

**"The SUID sandbox helper binary was found, but is not configured correctly"** — only happens when running from the unpacked build dir (`dist-app/linux-unpacked/workbench-aurora`):

```bash
sudo chown root:root dist-app/linux-unpacked/chrome-sandbox
sudo chmod 4755 dist-app/linux-unpacked/chrome-sandbox
```

The packaged AppImage/deb are not affected.

**Window blank or doesn't appear on Wayland:** Electron normally runs through XWayland automatically. If your compositor misbehaves, try:

```bash
workbench-aurora --ozone-platform-hint=auto
```

**Dropped a PDF and saw "This page couldn't load"?** Fixed in builds from Task 41 onward — update to the latest package. Dropping files works on the library shelf and folder rows (it imports them); anywhere else it is safely ignored.

**The app is fully offline and that's intentional** — if something in it asks for network access, that's a bug; report it.

---

## Build from source

```bash
# once (Node.js 20+ and npm required — network only for npm itself)
npm install

# web-only build (static export in out/)
npm run build

# full desktop packages: static export + AppImage + deb into dist-app/
npm run app:build
```

Useful during development:

```bash
npm run dev         # web preview at http://localhost:3000
npm run app:start   # Electron shell against the last export (out/)
npm run typecheck && npm run lint
SMOKE=1 npx electron . --ozone-platform=headless --no-sandbox --disable-gpu  # headless self-test (exit 0 = pass)
SMOKE=2 …           # same + verifies the window can't be navigated away (drop guard)
```
