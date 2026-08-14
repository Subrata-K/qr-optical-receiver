let scanner = null;
let cameraRunning = false;
let transferActive = false;

let completedBlob = null;
let downloadUrl = null;

let transfer = newSession();

function newSession() {
  return {
    id: null,
    total: 0,
    name: null,
    size: 0,
    sha256: null,
    chunks: new Map(),
    duplicates: 0,
    decoded: 0,
    firstScan: null,
    lastScan: null
  };
}

const $ = id => document.getElementById(id);

const cameraButton = $("cameraButton");
const startButton = $("startButton");
const stopButton = $("stopButton");
const resetButton = $("resetButton");
const downloadButton = $("downloadButton");

function setMessage(text, type = "info") {
  $("message").textContent = text;
  $("message").className = `message ${type}`;
}

function formatBytes(n) {
  if (!Number.isFinite(n)) return "--";

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = n;
  let i = 0;

  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }

  return `${value.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

function getMissing() {
  if (!transfer.total) return [];

  const missing = [];

  for (let i = 1; i <= transfer.total; i++) {
    if (!transfer.chunks.has(i)) {
      missing.push(i);
    }
  }

  return missing;
}

function updateUI() {
  const received = transfer.chunks.size;
  const total = transfer.total;

  $("progressText").textContent =
    `${received} / ${total || 0}`;

  const percent =
    total ? (received / total) * 100 : 0;

  $("percentText").textContent =
    `${percent.toFixed(1)}%`;

  $("progressFill").style.width =
    `${percent}%`;

  $("fileName").textContent =
    transfer.name || "Waiting...";

  $("fileSize").textContent =
    transfer.size ? formatBytes(transfer.size) : "--";

  $("receivedFrames").textContent =
    received;

  $("missingFrames").textContent =
    total ? getMissing().length : "--";

  $("duplicateFrames").textContent =
    transfer.duplicates;

  $("decodedCount").textContent =
    transfer.decoded;

  $("transferId").textContent =
    transfer.id || "--";

  $("sha256").textContent =
    transfer.sha256 || "--";

  const missing = getMissing();

  $("missingList").textContent =
    missing.length ? missing.join(", ") : "None";

  if (cameraRunning && transferActive) {
    $("state").textContent = "RECEIVING";
  } else if (cameraRunning) {
    $("state").textContent = "CAMERA READY";
  } else {
    $("state").textContent = "CAMERA OFF";
  }
}

function resetTransfer(silent = false) {
  transfer = newSession();
  completedBlob = null;

  if (downloadUrl) {
    URL.revokeObjectURL(downloadUrl);
    downloadUrl = null;
  }

  downloadButton.disabled = true;
  transferActive = false;

  $("lastDecoded").textContent =
    "Nothing decoded yet.";

  $("startButton").disabled =
    !cameraRunning;

  updateUI();

  if (!silent) {
    setMessage(
      "Transfer reset. Press START TRANSFER when the camera is ready.",
      "info"
    );

    $("transferStatus").textContent =
      "Transfer is not started.";
  }
}

function decodeBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

async function sha256Hex(buffer) {
  const digest =
    await crypto.subtle.digest(
      "SHA-256",
      buffer
    );

  return Array.from(
    new Uint8Array(digest)
  ).map(
    x => x.toString(16).padStart(2, "0")
  ).join("");
}

function validatePacket(packet) {
  const required = [
    "v", "id", "n", "total",
    "name", "size", "sha256", "data"
  ];

  if (!packet ||
      typeof packet !== "object") {
    throw new Error(
      "Invalid packet."
    );
  }

  for (const field of required) {
    if (!(field in packet)) {
      throw new Error(
        `Packet is missing '${field}'.`
      );
    }
  }

  if (packet.v !== 1) {
    throw new Error(
      `Unsupported packet version: ${packet.v}`
    );
  }

  if (!Number.isInteger(packet.n) ||
      !Number.isInteger(packet.total) ||
      packet.n < 1 ||
      packet.total < 1 ||
      packet.n > packet.total) {

    throw new Error(
      "Invalid frame numbering."
    );
  }
}

/*
 * IMPORTANT CHANGE:
 *
 * A different transfer ID is NOT treated as an error anymore.
 *
 * If a new packet with a different ID arrives, we automatically
 * start a new session. This solves the situation where the laptop
 * creates a new transfer ID after restarting the transmitter.
 */
async function receivePacket(decodedText) {

  if (!transferActive) {
    return;
  }

  $("lastDecoded").textContent =
    decodedText.slice(0, 1200);

  transfer.decoded++;

  let packet;

  try {
    packet = JSON.parse(decodedText);
  } catch {
    setMessage(
      "QR decoded, but it is not the transmitter packet.",
      "warning"
    );

    updateUI();
    return;
  }

  try {
    validatePacket(packet);
  } catch (e) {
    setMessage(
      e.message,
      "warning"
    );

    updateUI();
    return;
  }

  /*
   * NEW TRANSFER DETECTION
   *
   * If no active session exists, initialize from this packet.
   *
   * If a different transfer ID appears, automatically replace
   * the old session. This is especially useful after the laptop
   * transmitter is stopped and restarted.
   */
  if (transfer.id === null ||
      packet.id !== transfer.id) {

    transfer = newSession();

    transfer.id = packet.id;
    transfer.total = packet.total;
    transfer.name = packet.name;
    transfer.size = packet.size;
    transfer.sha256 = packet.sha256;

    transfer.decoded = 1;

    setMessage(
      `New transfer detected: ${packet.name}`,
      "success"
    );

    $("transferStatus").textContent =
      `Receiving ${packet.name}...`;
  }

  /*
   * Basic metadata consistency check.
   */
  if (packet.total !== transfer.total) {
    setMessage(
      "Frame count changed during transfer. A new session may have started.",
      "warning"
    );

    return;
  }

  /*
   * Duplicate
   */
  if (transfer.chunks.has(packet.n)) {

    transfer.duplicates++;

    updateUI();

    return;
  }

  /*
   * Decode binary payload.
   */
  let chunk;

  try {
    chunk = decodeBase64(
      packet.data
    );
  } catch {
    setMessage(
      `Frame ${packet.n} has invalid Base64 data.`,
      "warning"
    );

    updateUI();
    return;
  }

  /*
   * Store frame.
   */
  transfer.chunks.set(
    packet.n,
    chunk
  );

  const now =
    performance.now();

  if (!transfer.firstScan) {
    transfer.firstScan = now;
  }

  transfer.lastScan = now;

  updateUI();

  setMessage(
    `Frame ${packet.n} received (${transfer.chunks.size}/${transfer.total}).`,
    "info"
  );

  /*
   * Complete?
   */
  if (
    transfer.chunks.size ===
    transfer.total
  ) {
    await reconstructFile();
  }
}

async function reconstructFile() {

  const missing =
    getMissing();

  if (missing.length) {

    setMessage(
      `Missing ${missing.length} frame(s).`,
      "warning"
    );

    return;
  }

  setMessage(
    "All frames received. Reconstructing file...",
    "info"
  );

  let totalBytes = 0;

  for (
    let i = 1;
    i <= transfer.total;
    i++
  ) {
    totalBytes +=
      transfer.chunks.get(i).length;
  }

  const output =
    new Uint8Array(totalBytes);

  let offset = 0;

  for (
    let i = 1;
    i <= transfer.total;
    i++
  ) {

    const chunk =
      transfer.chunks.get(i);

    output.set(
      chunk,
      offset
    );

    offset += chunk.length;
  }

  if (
    output.length !==
    transfer.size
  ) {

    setMessage(
      `Size mismatch: received ${formatBytes(output.length)}, expected ${formatBytes(transfer.size)}.`,
      "error"
    );

    return;
  }

  try {

    const hash =
      await sha256Hex(
        output.buffer
      );

    if (
      hash.toLowerCase() !==
      transfer.sha256.toLowerCase()
    ) {

      setMessage(
        "SHA-256 verification FAILED.",
        "error"
      );

      return;
    }

  } catch (e) {

    setMessage(
      `SHA-256 error: ${e.message}`,
      "error"
    );

    return;
  }

  completedBlob =
    new Blob(
      [output],
      { type: "application/octet-stream" }
    );

  if (downloadUrl) {
    URL.revokeObjectURL(
      downloadUrl
    );
  }

  downloadUrl =
    URL.createObjectURL(
      completedBlob
    );

  downloadButton.disabled =
    false;

  $("transferStatus").textContent =
    "Transfer completed successfully.";

  setMessage(
    `SUCCESS — ${transfer.name} received and verified.`,
    "success"
  );

  updateUI();
}

/*
 * CAMERA ONLY
 *
 * This button starts the camera but does NOT start
 * file reception. That is controlled separately by
 * START TRANSFER.
 */
async function startCamera() {

  if (cameraRunning) {
    return;
  }

  if (
    typeof Html5Qrcode ===
    "undefined"
  ) {

    setMessage(
      "QR library has not loaded. Check Internet connection and reload.",
      "error"
    );

    return;
  }

  scanner =
    new Html5Qrcode(
      "reader"
    );

  const config = {
    fps: 15,

    qrbox: (
      viewfinderWidth,
      viewfinderHeight
    ) => {

      const side =
        Math.floor(
          Math.min(
            viewfinderWidth,
            viewfinderHeight
          ) * 0.85
        );

      return {
        width: Math.max(
          220,
          Math.min(side, 550)
        ),
        height: Math.max(
          220,
          Math.min(side, 550)
        )
      };
    },

    aspectRatio: 1.0,

    disableFlip: true
  };

  try {

    $("cameraStatus").textContent =
      "Requesting camera permission...";

    const cameras =
      await Html5Qrcode.getCameras();

    if (
      !cameras ||
      cameras.length === 0
    ) {
      throw new Error(
        "No camera detected."
      );
    }

    let selected =
      cameras[cameras.length - 1];

    const rear =
      cameras.find(
        cam =>
          /back|rear|environment|main/i.test(
            cam.label || ""
          )
      );

    if (rear) {
      selected = rear;
    }

    $("cameraName").textContent =
      selected.label ||
      "Selected camera";

    await scanner.start(
      selected.id,
      config,

      async decodedText => {
        await receivePacket(
          decodedText
        );
      },

      () => {}
    );

    cameraRunning = true;

    cameraButton.disabled =
      true;

    startButton.disabled =
      false;

    stopButton.disabled =
      false;

    $("cameraStatus").textContent =
      "Camera is running.";

    $("transferStatus").textContent =
      "Camera ready. Press START TRANSFER.";

    $("state").textContent =
      "CAMERA READY";

    setMessage(
      "Camera ready. Now press START TRANSFER.",
      "info"
    );

    updateUI();

  } catch (e) {

    console.error(e);

    setMessage(
      `Camera error: ${e.message || e}`,
      "error"
    );

    $("cameraStatus").textContent =
      "Camera could not be started.";

    $("state").textContent =
      "CAMERA ERROR";

    try {
      await scanner.clear();
    } catch {}
  }
}

/*
 * START TRANSFER
 *
 * This simply enables processing of QR frames.
 * Keep the camera running continuously.
 */
function startTransfer() {

  if (!cameraRunning) {

    setMessage(
      "Start the camera first.",
      "warning"
    );

    return;
  }

  /*
   * Start with a clean session each time Start Transfer is pressed.
   */
  transfer = newSession();

  transferActive = true;

  completedBlob = null;

  if (downloadUrl) {
    URL.revokeObjectURL(
      downloadUrl
    );

    downloadUrl = null;
  }

  downloadButton.disabled =
    true;

  $("transferStatus").textContent =
    "Waiting for first QR frame...";

  $("state").textContent =
    "WAITING FOR QR";

  setMessage(
    "TRANSFER STARTED. Now start the laptop transmitter.",
    "success"
  );

  updateUI();
}

/*
 * STOP = stop receiving, but keep camera alive.
 */
function stopTransfer() {

  transferActive =
    false;

  $("transferStatus").textContent =
    "Transfer stopped.";

  if (cameraRunning) {
    $("state").textContent =
      "CAMERA READY";
  }

  setMessage(
    "Transfer stopped. Press START TRANSFER to receive again.",
    "info"
  );
}

/*
 * Stop actual camera.
 */
async function stopCamera() {

  if (
    !scanner ||
    !cameraRunning
  ) {
    return;
  }

  transferActive =
    false;

  try {

    await scanner.stop();
    await scanner.clear();

  } catch (e) {
    console.error(e);
  }

  cameraRunning =
    false;

  cameraButton.disabled =
    false;

  startButton.disabled =
    true;

  stopButton.disabled =
    true;

  $("cameraStatus").textContent =
    "Camera is stopped.";

  $("transferStatus").textContent =
    "Transfer is not started.";

  $("state").textContent =
    "CAMERA OFF";

  updateUI();
}

function downloadFile() {

  if (!downloadUrl) {
    return;
  }

  const a =
    document.createElement(
      "a"
    );

  a.href =
    downloadUrl;

  a.download =
    transfer.name ||
    "received_file";

  document.body.appendChild(
    a
  );

  a.click();

  a.remove();
}

/*
 * BUTTONS
 */
cameraButton.addEventListener(
  "click",
  startCamera
);

startButton.addEventListener(
  "click",
  startTransfer
);

stopButton.addEventListener(
  "click",
  stopTransfer
);

resetButton.addEventListener(
  "click",
  async () => {

    transferActive =
      false;

    resetTransfer();

    /*
     * Reset the transfer session but DON'T kill the camera.
     * This makes restarting a transfer fast.
     */
    if (cameraRunning) {

      $("cameraStatus").textContent =
        "Camera is running.";

      $("transferStatus").textContent =
        "Camera ready. Press START TRANSFER.";

      setMessage(
        "Transfer reset. Camera remains ready.",
        "info"
      );

    }
  }
);

downloadButton.addEventListener(
  "click",
  downloadFile
);

updateUI();
