// file-source.js
// Picks a music folder and scans it for playable files. Prefers the File System
// Access API (showDirectoryPicker) because it lets us re-scan later without
// asking the user to pick the folder again — we keep the directory *handle*,
// not a copy of the files. On WebViews where that API isn't available, we fall
// back to a plain <input type="file" webkitdirectory> picker, which works
// everywhere but can't be silently re-scanned (the user has to re-pick).

const AUDIO_EXTS = new Set(['flac', 'wav', 'ape', 'mp3', 'm4a', 'aac', 'ogg']);

function extOf(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

function titleFromFilename(name) {
  return name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim() || name;
}

export const supportsFileSystemAccess = typeof window.showDirectoryPicker === 'function';

let cachedDirHandle = null; // only set when File System Access API is used

async function* walkDirHandle(dirHandle, path = '') {
  for await (const [name, handle] of dirHandle.entries()) {
    const entryPath = path ? `${path}/${name}` : name;
    if (handle.kind === 'file') {
      yield { name, path: entryPath, handle };
    } else if (handle.kind === 'directory') {
      yield* walkDirHandle(handle, entryPath);
    }
  }
}

async function buildTrackFromFile(file, relativePath) {
  const ext = extOf(file.name);
  return {
    key: `${relativePath}:${file.size}:${file.lastModified}`,
    name: file.name,
    path: relativePath,
    ext,
    sizeBytes: file.size,
    title: titleFromFilename(file.name),
    artist: 'Unknown Artist',
    file, // File object (or resolved from a handle) — used directly by the audio engine
  };
}

/**
 * Opens the folder picker and returns a flat list of track objects for every
 * recognized audio file found (including .ogg — those are kept in the list so
 * the library can show them, just flagged as unsupported; nothing decodes them).
 */
export async function pickAndScanFolder(onProgress) {
  if (supportsFileSystemAccess) {
    const dirHandle = await window.showDirectoryPicker({ id: 'fydelity-music', mode: 'read' });
    cachedDirHandle = dirHandle;
    return scanDirHandle(dirHandle, onProgress);
  }
  return scanViaInputFallback(onProgress);
}

/** Re-scan the previously granted folder (File System Access only). */
export async function rescanFolder(onProgress) {
  if (!cachedDirHandle) throw new Error('No folder handle to re-scan — pick a folder first.');
  const perm = await cachedDirHandle.queryPermission({ mode: 'read' });
  if (perm !== 'granted') {
    const req = await cachedDirHandle.requestPermission({ mode: 'read' });
    if (req !== 'granted') throw new Error('Permission to re-read the folder was denied.');
  }
  return scanDirHandle(cachedDirHandle, onProgress);
}

export function canRescan() {
  return !!cachedDirHandle;
}

async function scanDirHandle(dirHandle, onProgress) {
  const tracks = [];
  let seen = 0;
  for await (const entry of walkDirHandle(dirHandle)) {
    const ext = extOf(entry.name);
    if (!AUDIO_EXTS.has(ext)) continue;
    const file = await entry.handle.getFile();
    tracks.push(await buildTrackFromFile(file, entry.path));
    seen++;
    if (onProgress) onProgress(seen);
  }
  return tracks;
}

function scanViaInputFallback(onProgress) {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.webkitdirectory = true;
    input.multiple = true;
    input.style.display = 'none';
    document.body.appendChild(input);

    input.addEventListener('change', async () => {
      try {
        const files = Array.from(input.files || []);
        const tracks = [];
        let seen = 0;
        for (const file of files) {
          const ext = extOf(file.name);
          if (!AUDIO_EXTS.has(ext)) continue;
          const relPath = file.webkitRelativePath || file.name;
          tracks.push(await buildTrackFromFile(file, relPath));
          seen++;
          if (onProgress) onProgress(seen);
        }
        document.body.removeChild(input);
        resolve(tracks);
      } catch (err) {
        document.body.removeChild(input);
        reject(err);
      }
    }, { once: true });

    // if the user cancels the picker, nothing fires — that's fine, the
    // onboarding screen just stays put waiting for another attempt
    input.click();
  });
}

/**
 * Storage snapshot for the Settings screen. Uses the real per-format byte
 * totals from the scanned library, plus navigator.storage.estimate() where
 * available for an honest device-storage figure (browser-reported, not a
 * true OS-level total — we label it as such in the UI).
 */
export async function computeStorageStats(tracks) {
  const byExt = {};
  for (const t of tracks) {
    byExt[t.ext] = (byExt[t.ext] || 0) + t.sizeBytes;
  }
  const totalUsed = Object.values(byExt).reduce((a, b) => a + b, 0);

  let quota = null;
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const est = await navigator.storage.estimate();
      quota = est.quota || null;
    } catch (_) { /* not available in this WebView */ }
  }

  return { byExt, totalUsed, quota };
}

export { extOf, titleFromFilename, AUDIO_EXTS };
