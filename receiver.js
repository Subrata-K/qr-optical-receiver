/* ===================================================================
   QR Optical File Receiver v3 - Color Code + Duplex ACK edition
   Must match qr_optical_file_transmitter_v3.py exactly:
     PALETTE, ANCHOR_SIZE, SWATCH_*, GRID_PRESETS, packet binary layout.
=================================================================== */

const PALETTE = [
  [0, 0, 0], [255, 0, 0], [0, 255, 0], [0, 0, 255],
  [255, 255, 0], [255, 0, 255], [0, 255, 255], [255, 255, 255]
];
const ANCHOR_SIZE = 4;
const SWATCH_ROWS = 2, SWATCH_COLS = 2;
const SWATCH_START_ROW = 5, SWATCH_START_COL = 5;
const MAGIC = 0xC5;
const GRID_PRESETS = { small: 29, medium: 45, large: 65 };

const $ = id => document.getElementById(id);

let cameraRunning = false, videoStream = null, decodeTimer = null;
let completedBlob = null, downloadUrl = null;
let ackEnabled = true, ackTimer = null;
let N_CURRENT = GRID_PRESETS.medium;

let transfer = {
  id: null, total: 0, name: null, size: 0, sha256: null,
  chunks: new Map(), duplicates: 0, decodedAttempts: 0, decodedGood: 0,
  firstScan: null, lastScan: null
};

// ---------------------------------------------------------------
// Utility / UI
// ---------------------------------------------------------------
function setMessage(text, type = 'info') {
  const m = $('message'); m.textContent = text; m.className = `message ${type}`;
}
function formatBytes(n) {
  if (!Number.isFinite(n)) return '--';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i === 0 ? 0 : 2)} ${u[i]}`;
}
function getMissing() {
  if (!transfer.total) return [];
  const a = [];
  for (let i = 1; i <= transfer.total; i++) if (!transfer.chunks.has(i)) a.push(i);
  return a;
}
function updateUI() {
  const r = transfer.chunks.size, t = transfer.total;
  const p = t ? (100 * r / t) : 0;
  $('progressText').textContent = `${r} / ${t || 0}`;
  $('percentText').textContent = `${p.toFixed(1)}%`;
  $('progressFill').style.width = `${p}%`;
  $('fileName').textContent = transfer.name || 'Waiting...';
  $('fileSize').textContent = transfer.size ? formatBytes(transfer.size) : '--';
  $('receivedFrames').textContent = r;
  $('missingFrames').textContent = t ? getMissing().length : '--';
  $('duplicateFrames').textContent = transfer.duplicates;
  $('decodedCount').textContent = `${transfer.decodedGood} / ${transfer.decodedAttempts}`;
  $('transferId').textContent = transfer.id || '--';
  $('sha256').textContent = transfer.sha256 || '--';
  $('missingList').textContent = getMissing().length ? getMissing().join(', ') : 'None';
  if (transfer.firstScan && transfer.lastScan > transfer.firstScan) {
    const fps = transfer.decodedGood / ((transfer.lastScan - transfer.firstScan) / 1000);
    $('scannerState').textContent = cameraRunning ? `RUNNING (${fps.toFixed(2)} good/s)` : 'STOPPED';
  } else {
    $('scannerState').textContent = cameraRunning ? 'RUNNING' : 'STOPPED';
  }
}
function resetTransfer(silent = false) {
  transfer = {
    id: null, total: 0, name: null, size: 0, sha256: null,
    chunks: new Map(), duplicates: 0, decodedAttempts: 0, decodedGood: 0,
    firstScan: null, lastScan: null
  };
  completedBlob = null;
  if (downloadUrl) { URL.revokeObjectURL(downloadUrl); downloadUrl = null; }
  $('downloadButton').disabled = true;
  $('lastDecoded').textContent = 'Nothing decoded yet.';
  updateUI();
  updateAckQr();
  if (!silent) setMessage('Transfer session reset.', 'info');
}

// ---------------------------------------------------------------
// CRC32
// ---------------------------------------------------------------
const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC32_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ---------------------------------------------------------------
// Grid layout (must match Python compute_layout)
// ---------------------------------------------------------------
const layoutCache = new Map();
function computeLayout(n) {
  if (layoutCache.has(n)) return layoutCache.get(n);
  const reserved = new Set();
  const a = ANCHOR_SIZE;
  const corners = [[0, 0], [0, n - a], [n - a, 0], [n - a, n - a]];
  for (const [r0, c0] of corners) {
    for (let r = r0; r < r0 + a; r++) for (let c = c0; c < c0 + a; c++) reserved.add(r * n + c);
  }
  const swatches = [];
  for (let i = 0; i < 8; i++) {
    const r0 = SWATCH_START_ROW, c0 = SWATCH_START_COL + i * SWATCH_COLS;
    swatches.push({ color: i, r0, c0 });
    for (let r = r0; r < r0 + SWATCH_ROWS; r++) for (let c = c0; c < c0 + SWATCH_COLS; c++) reserved.add(r * n + c);
  }
  const dataCells = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (!reserved.has(r * n + c)) dataCells.push([r, c]);
  const result = { swatches, dataCells };
  layoutCache.set(n, result);
  return result;
}
function anchorCellCenters(n) {
  const a = ANCHOR_SIZE;
  return {
    TL: { x: a / 2, y: a / 2 },
    TR: { x: n - a / 2, y: a / 2 },
    BL: { x: a / 2, y: n - a / 2 },
    BR: { x: n - a / 2, y: n - a / 2 }
  };
}

// ---------------------------------------------------------------
// Homography (4-point projective transform via DLT)
// ---------------------------------------------------------------
function gaussianSolve(A, b) {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    const pv = M[col][col];
    if (Math.abs(pv) < 1e-9) continue;
    for (let c = col; c <= n; c++) M[col][c] /= pv;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map(row => row[n]);
}
function solveHomography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i], { x: X, y: Y } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]); b.push(X);
    A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]); b.push(Y);
  }
  const h = gaussianSolve(A, b);
  return (x, y) => {
    const denom = h[6] * x + h[7] * y + 1;
    return { x: (h[0] * x + h[1] * y + h[2]) / denom, y: (h[3] * x + h[4] * y + h[5]) / denom };
  };
}

// ---------------------------------------------------------------
// Anchor (finder blob) detection
// ---------------------------------------------------------------
function findAnchors(sourceCanvas, fullW, fullH) {
  const searchW = 220;
  const scale = searchW / fullW;
  const searchH = Math.max(1, Math.round(fullH * scale));
  const sc = document.createElement('canvas');
  sc.width = searchW; sc.height = searchH;
  const sctx = sc.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(sourceCanvas, 0, 0, searchW, searchH);
  const img = sctx.getImageData(0, 0, searchW, searchH).data;

  const DARK_T = 90;
  const dark = new Uint8Array(searchW * searchH);
  for (let i = 0; i < searchW * searchH; i++) {
    const r = img[i * 4], g = img[i * 4 + 1], b = img[i * 4 + 2];
    dark[i] = ((r + g + b) / 3 < DARK_T) ? 1 : 0;
  }

  const visited = new Uint8Array(searchW * searchH);
  const comps = [];
  const stack = [];
  for (let y = 0; y < searchH; y++) {
    for (let x = 0; x < searchW; x++) {
      const idx = y * searchW + x;
      if (dark[idx] && !visited[idx]) {
        let sumX = 0, sumY = 0, count = 0, minX = x, maxX = x, minY = y, maxY = y;
        stack.length = 0; stack.push(idx); visited[idx] = 1;
        while (stack.length) {
          const cur = stack.pop();
          const cy = (cur / searchW) | 0, cx = cur - cy * searchW;
          sumX += cx; sumY += cy; count++;
          if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
          const candidates = [
            [cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]
          ];
          for (const [nx, ny] of candidates) {
            if (nx < 0 || ny < 0 || nx >= searchW || ny >= searchH) continue;
            const nb = ny * searchW + nx;
            if (dark[nb] && !visited[nb]) { visited[nb] = 1; stack.push(nb); }
          }
        }
        comps.push({ cx: sumX / count, cy: sumY / count, area: count, w: maxX - minX + 1, h: maxY - minY + 1 });
      }
    }
  }

  const totalArea = searchW * searchH;
  const valid = comps.filter(c =>
    c.area >= totalArea * 0.002 && c.area <= totalArea * 0.22 &&
    (c.w / c.h) > 0.45 && (c.w / c.h) < 2.2
  );
  if (valid.length < 4) return null;
  valid.sort((a, b) => b.area - a.area);
  const top4 = valid.slice(0, 4).map(c => ({ x: c.cx / scale, y: c.cy / scale }));

  const bySum = [...top4].sort((a, b) => (a.x + a.y) - (b.x + b.y));
  const TL = bySum[0], BR = bySum[bySum.length - 1];
  const byDiff = [...top4].sort((a, b) => (a.x - a.y) - (b.x - b.y));
  const BL = byDiff[0], TR = byDiff[byDiff.length - 1];
  return { TL, TR, BL, BR };
}

// ---------------------------------------------------------------
// Sampling + classification
// ---------------------------------------------------------------
function sampleColor(imgData, w, h, x, y) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const px = Math.round(x + dx), py = Math.round(y + dy);
    if (px < 0 || py < 0 || px >= w || py >= h) continue;
    const idx = (py * w + px) * 4;
    r += imgData[idx]; g += imgData[idx + 1]; b += imgData[idx + 2]; n++;
  }
  return n ? [r / n, g / n, b / n] : [255, 255, 255];
}
function classify(rgb, refs) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < refs.length; i++) {
    const dr = rgb[0] - refs[i][0], dg = rgb[1] - refs[i][1], db = rgb[2] - refs[i][2];
    const d = dr * dr + dg * dg + db * db;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// ---------------------------------------------------------------
// Packet parsing
// ---------------------------------------------------------------
function parseColorPacket(bytes) {
  try {
    let off = 0;
    if (bytes.length < 13) return null;
    if (bytes[off++] !== MAGIC) return null;
    const ver = bytes[off++]; if (ver !== 1) return null;
    const id = ((bytes[off] << 24) | (bytes[off + 1] << 16) | (bytes[off + 2] << 8) | bytes[off + 3]) >>> 0; off += 4;
    const frameNo = ((bytes[off] << 16) | (bytes[off + 1] << 8) | bytes[off + 2]) >>> 0; off += 3;
    const totalFrames = ((bytes[off] << 16) | (bytes[off + 1] << 8) | bytes[off + 2]) >>> 0; off += 3;
    const nameLen = bytes[off++];
    if (off + nameLen > bytes.length) return null;
    const name = new TextDecoder().decode(bytes.slice(off, off + nameLen)); off += nameLen;
    if (off + 8 > bytes.length) return null;
    let fileSize = 0; for (let i = 0; i < 8; i++) fileSize = fileSize * 256 + bytes[off + i]; off += 8;
    if (off + 32 > bytes.length) return null;
    const shaBytes = bytes.slice(off, off + 32); off += 32;
    const sha256Hex = Array.from(shaBytes).map(b => b.toString(16).padStart(2, '0')).join('');
    if (off + 2 > bytes.length) return null;
    const payloadLen = ((bytes[off] << 8) | bytes[off + 1]) >>> 0; off += 2;
    if (off + payloadLen + 4 > bytes.length) return null;
    const payload = bytes.slice(off, off + payloadLen); off += payloadLen;
    const crcExpected = ((bytes[off] << 24) | (bytes[off + 1] << 16) | (bytes[off + 2] << 8) | bytes[off + 3]) >>> 0;
    if (crc32(payload) !== crcExpected) return null;
    return { id, frameNo, totalFrames, name, fileSize, sha256Hex, payload };
  } catch { return null; }
}

// ---------------------------------------------------------------
// Frame handling / reconstruction (same integrity model as v2)
// ---------------------------------------------------------------
async function sha256Hex(buffer) {
  const d = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(d)).map(x => x.toString(16).padStart(2, '0')).join('');
}
async function reconstructFile() {
  if (getMissing().length) { setMessage(`Missing ${getMissing().length} frame(s).`, 'warning'); return; }
  setMessage('All frames received. Reconstructing file...', 'info');
  let len = 0;
  for (let i = 1; i <= transfer.total; i++) len += transfer.chunks.get(i).length;
  const out = new Uint8Array(len);
  let offset = 0;
  for (let i = 1; i <= transfer.total; i++) { const c = transfer.chunks.get(i); out.set(c, offset); offset += c.length; }
  if (out.length !== transfer.size) {
    setMessage(`Size verification failed: received ${formatBytes(out.length)}, expected ${formatBytes(transfer.size)}.`, 'error');
    return;
  }
  try {
    const hash = await sha256Hex(out.buffer);
    if (hash.toLowerCase() !== transfer.sha256.toLowerCase()) {
      setMessage('SHA-256 verification failed. The reconstructed file is corrupted/incomplete.', 'error');
      return;
    }
  } catch (e) {
    setMessage(`SHA-256 verification error: ${e.message}`, 'error'); return;
  }
  completedBlob = new Blob([out], { type: 'application/octet-stream' });
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = URL.createObjectURL(completedBlob);
  $('downloadButton').disabled = false;
  setMessage(`SUCCESS - ${transfer.name} received and SHA-256 verified.`, 'success');
  updateUI();
  updateAckQr();
}
function handleDecodedFrame(p) {
  const idHex = p.id.toString(16).padStart(8, '0');
  transfer.decodedGood++;
  $('lastDecoded').textContent = `frame ${p.frameNo}/${p.totalFrames}  id=${idHex}  payload=${p.payload.length}B`;

  if (transfer.id === null) {
    transfer.id = idHex; transfer.total = p.totalFrames; transfer.name = p.name;
    transfer.size = p.fileSize; transfer.sha256 = p.sha256Hex;
    setMessage(`File detected: ${p.name} (${formatBytes(p.fileSize)})`, 'info');
  }
  if (idHex !== transfer.id) {
    setMessage('A different transfer ID was detected. Press RESET before changing files.', 'warning');
    updateUI(); return;
  }
  if (transfer.chunks.has(p.frameNo)) {
    transfer.duplicates++;
    updateUI();
    return;
  }
  transfer.chunks.set(p.frameNo, p.payload);
  const now = performance.now();
  if (!transfer.firstScan) transfer.firstScan = now;
  transfer.lastScan = now;
  updateUI();
  setMessage(`Frame ${p.frameNo} received (${transfer.chunks.size}/${transfer.total}).`, 'info');
  if (transfer.chunks.size === transfer.total) reconstructFile();
}

// ---------------------------------------------------------------
// Camera + decode loop
// ---------------------------------------------------------------
const workCanvas = document.createElement('canvas');
function tryDecodeColorFrame() {
  if (!cameraRunning) return;
  const video = $('videoEl');
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return;
  const W = Math.min(vw, 720);
  const H = Math.round(vh * W / vw);
  workCanvas.width = W; workCanvas.height = H;
  const wctx = workCanvas.getContext('2d', { willReadFrequently: true });
  wctx.drawImage(video, 0, 0, W, H);

  transfer.decodedAttempts++;

  const anchors = findAnchors(workCanvas, W, H);
  if (!anchors) { updateUI(); return; }

  const n = N_CURRENT;
  const centers = anchorCellCenters(n);
  const src = [centers.TL, centers.TR, centers.BL, centers.BR];
  const dst = [anchors.TL, anchors.TR, anchors.BL, anchors.BR];
  const mapFn = solveHomography(src, dst);
  const imgData = wctx.getImageData(0, 0, W, H).data;
  const { swatches, dataCells } = computeLayout(n);

  const refs = new Array(8);
  for (const sw of swatches) {
    const cx = sw.c0 + SWATCH_COLS / 2, cy = sw.r0 + SWATCH_ROWS / 2;
    const p = mapFn(cx, cy);
    refs[sw.color] = sampleColor(imgData, W, H, p.x, p.y);
  }

  const bits = [];
  for (const [r, c] of dataCells) {
    const p = mapFn(c + 0.5, r + 0.5);
    const rgb = sampleColor(imgData, W, H, p.x, p.y);
    const v = classify(rgb, refs);
    bits.push((v >> 2) & 1, (v >> 1) & 1, v & 1);
  }
  const byteLen = Math.floor(bits.length / 8);
  const bytes = new Uint8Array(byteLen);
  for (let i = 0; i < byteLen; i++) {
    let v = 0;
    for (let k = 0; k < 8; k++) v = (v << 1) | bits[i * 8 + k];
    bytes[i] = v;
  }
  const packet = parseColorPacket(bytes);
  if (packet) handleDecodedFrame(packet);
  updateUI();
}
function decodeLoop() {
  if (!cameraRunning) return;
  tryDecodeColorFrame();
  decodeTimer = setTimeout(decodeLoop, 140);
}
async function startCamera() {
  if (cameraRunning) return;
  resetTransfer(true);
  N_CURRENT = GRID_PRESETS[$('gridSizeSelect').value];
  try {
    $('cameraStatus').textContent = 'Requesting camera permission...';
    const constraints = { video: { facingMode: { exact: 'user' } }, audio: false };
    videoStream = await navigator.mediaDevices.getUserMedia(constraints);
    const video = $('videoEl');
    video.srcObject = videoStream;
    await video.play();
    cameraRunning = true;
    $('startButton').disabled = true; $('stopButton').disabled = false;
    $('cameraStatus').textContent = 'Camera running. Point the rear camera at the laptop code.';
    setMessage('Receiver is ACTIVE. Start the laptop transmitter now.', 'success');
    updateUI();
    decodeLoop();
    startAckLoop();
  } catch (e) {
    console.error(e);
    cameraRunning = false;
    $('cameraStatus').textContent = 'Camera could not be started.';
    setMessage(`Camera error: ${e.message || e}. Make sure camera permission is allowed and the page uses HTTPS.`, 'error');
  }
}
async function stopCamera() {
  if (!cameraRunning) return;
  cameraRunning = false;
  if (decodeTimer) clearTimeout(decodeTimer);
  stopAckLoop();
  if (videoStream) { videoStream.getTracks().forEach(t => t.stop()); videoStream = null; }
  $('startButton').disabled = false; $('stopButton').disabled = true;
  $('cameraStatus').textContent = 'Camera stopped.';
  updateUI();
}
function downloadFile() {
  if (!downloadUrl) return;
  const a = document.createElement('a');
  a.href = downloadUrl; a.download = transfer.name || 'received_file';
  document.body.appendChild(a); a.click(); a.remove();
}

// ---------------------------------------------------------------
// Duplex ACK: generate + display a QR the laptop's webcam reads
// ---------------------------------------------------------------
function rangesFromSortedArray(arr) {
  if (!arr.length) return '';
  const parts = []; let start = arr[0], prev = arr[0];
  for (let i = 1; i <= arr.length; i++) {
    const v = arr[i];
    if (v === prev + 1) { prev = v; continue; }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    if (i < arr.length) { start = v; prev = v; }
  }
  return parts.join(',');
}
function buildAckPayload() {
  if (!transfer.id) return null;
  const have = [...transfer.chunks.keys()].sort((a, b) => a - b);
  const complete = transfer.total > 0 && have.length === transfer.total && completedBlob;
  return JSON.stringify({ v: 1, type: complete ? 'complete' : 'ack', id: transfer.id, have: rangesFromSortedArray(have) });
}
function updateAckQr() {
  const canvas = $('ackCanvas');
  const actx = canvas.getContext('2d');
  if (!ackEnabled) {
    actx.clearRect(0, 0, canvas.width, canvas.height);
    $('ackStatus').textContent = 'Return channel disabled.';
    return;
  }
  const payload = buildAckPayload();
  if (!payload) {
    actx.clearRect(0, 0, canvas.width, canvas.height);
    $('ackStatus').textContent = 'Waiting for first frame before generating an ACK...';
    return;
  }
  try {
    const qr = qrcode(0, 'L');
    qr.addData(payload);
    qr.make();
    const modCount = qr.getModuleCount();
    const size = canvas.width;
    const cell = Math.floor(size / modCount);
    const offset = Math.floor((size - cell * modCount) / 2);
    actx.fillStyle = '#fff'; actx.fillRect(0, 0, size, size);
    actx.fillStyle = '#000';
    for (let r = 0; r < modCount; r++) for (let c = 0; c < modCount; c++) {
      if (qr.isDark(r, c)) actx.fillRect(offset + c * cell, offset + r * cell, cell, cell);
    }
    $('ackStatus').textContent = `Sent ACK: ${transfer.chunks.size}/${transfer.total || '?'} frames confirmed.`;
  } catch (e) {
    console.error(e);
    $('ackStatus').textContent = 'ACK encoding error (transfer may be too large for one ACK frame).';
  }
}
function startAckLoop() { if (!ackTimer) ackTimer = setInterval(updateAckQr, 1000); updateAckQr(); }
function stopAckLoop() { if (ackTimer) { clearInterval(ackTimer); ackTimer = null; } }

// ---------------------------------------------------------------
// Wire up
// ---------------------------------------------------------------
$('startButton').addEventListener('click', startCamera);
$('stopButton').addEventListener('click', stopCamera);
$('resetButton').addEventListener('click', async () => { await stopCamera(); resetTransfer(); });
$('downloadButton').addEventListener('click', downloadFile);
$('ackToggle').addEventListener('change', e => { ackEnabled = e.target.checked; updateAckQr(); });
$('gridSizeSelect').addEventListener('change', e => { N_CURRENT = GRID_PRESETS[e.target.value]; });
resetTransfer(true);
