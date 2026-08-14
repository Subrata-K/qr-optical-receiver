let scanner = null;
let cameraRunning = false;
let completedBlob = null;
let downloadUrl = null;

let transfer = {
  id: null, total: 0, name: null, size: 0, sha256: null,
  chunks: new Map(), duplicates: 0,
  firstScan: null, lastScan: null, scans: 0
};

const $ = id => document.getElementById(id);
const startButton = $("startButton");
const stopButton = $("stopButton");
const resetButton = $("resetButton");
const downloadButton = $("downloadButton");
const message = $("message");

function setMessage(text, type="info") {
  message.textContent = text;
  message.className = `message ${type}`;
}

function formatBytes(n) {
  if (!Number.isFinite(n)) return "--";
  const units=["B","KB","MB","GB","TB"];
  let i=0, v=n;
  while(v>=1024 && i<units.length-1){v/=1024;i++;}
  return `${v.toFixed(i===0?0:2)} ${units[i]}`;
}

function missingFrames() {
  const out=[];
  for(let i=1;i<=transfer.total;i++){
    if(!transfer.chunks.has(i)) out.push(i);
  }
  return out;
}

function updateUI() {
  const r=transfer.chunks.size, t=transfer.total;
  $("progressText").textContent=`${r} / ${t || 0}`;
  $("progressFill").style.width=`${t ? (100*r/t) : 0}%`;
  $("fileName").textContent=transfer.name || "Waiting...";
  $("fileSize").textContent=transfer.size ? formatBytes(transfer.size) : "--";
  $("receivedFrames").textContent=r;
  $("missingFrames").textContent=t ? missingFrames().length : "--";
  $("duplicateFrames").textContent=transfer.duplicates;
  $("transferId").textContent=transfer.id || "--";
  $("sha256").textContent=transfer.sha256 || "--";
  $("missingList").textContent=missingFrames().length ? missingFrames().join(", ") : "None";

  if(transfer.firstScan && transfer.lastScan) {
    const sec=(transfer.lastScan-transfer.firstScan)/1000;
    $("scanRate").textContent=sec>0 ? `${(transfer.scans/sec).toFixed(2)} fps` : "0.00 fps";
  } else {
    $("scanRate").textContent="0.00 fps";
  }
}

function resetTransfer(silent=false) {
  transfer={
    id:null,total:0,name:null,size:0,sha256:null,
    chunks:new Map(),duplicates:0,firstScan:null,lastScan:null,scans:0
  };
  completedBlob=null;
  if(downloadUrl){ URL.revokeObjectURL(downloadUrl); downloadUrl=null; }
  downloadButton.disabled=true;
  updateUI();
  if(!silent) setMessage("Transfer reset.", "info");
}

function decodeBase64(s) {
  const bin=atob(s);
  const out=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i);
  return out;
}

async function sha256Hex(buffer) {
  const h=await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,"0")).join("");
}

function validatePacket(p) {
  if(!p || typeof p!=="object") throw new Error("Invalid packet.");
  for(const f of ["v","id","n","total","name","size","sha256","data"]) {
    if(!(f in p)) throw new Error(`Missing field: ${f}`);
  }
  if(p.v!==1) throw new Error(`Unsupported packet version: ${p.v}`);
  if(!Number.isInteger(p.n) || p.n<1 || p.n>p.total) throw new Error("Invalid frame number.");
  if(!Number.isInteger(p.total) || p.total<1) throw new Error("Invalid frame count.");
}

async function handleQR(text) {
  let p;
  try { p=JSON.parse(text); }
  catch { setMessage("QR detected, but it is not a transmitter packet.", "warning"); return; }

  try { validatePacket(p); }
  catch(e) { setMessage(e.message, "warning"); return; }

  if(transfer.id===null) {
    transfer.id=p.id; transfer.total=p.total; transfer.name=p.name;
    transfer.size=p.size; transfer.sha256=p.sha256;
  } else if(p.id!==transfer.id) {
    setMessage("Different transfer detected. Press Reset Transfer first.", "warning");
    return;
  }

  if(transfer.chunks.has(p.n)) {
    transfer.duplicates++;
    updateUI();
    return;
  }

  let chunk;
  try { chunk=decodeBase64(p.data); }
  catch { setMessage(`Frame ${p.n}: invalid payload.`, "warning"); return; }

  transfer.chunks.set(p.n, chunk);
  const now=performance.now();
  if(!transfer.firstScan) transfer.firstScan=now;
  transfer.lastScan=now;
  transfer.scans++;

  updateUI();

  if(transfer.chunks.size===transfer.total) {
    await reconstruct();
  } else {
    setMessage(`Frame ${p.n} received.`, "info");
  }
}

async function reconstruct() {
  const missing=missingFrames();
  if(missing.length) {
    setMessage(`Missing ${missing.length} frame(s).`, "warning");
    return;
  }

  setMessage("All frames received. Reconstructing...", "info");

  try {
    let length=0;
    for(let i=1;i<=transfer.total;i++) length += transfer.chunks.get(i).length;

    const output=new Uint8Array(length);
    let offset=0;

    for(let i=1;i<=transfer.total;i++) {
      const chunk=transfer.chunks.get(i);
      output.set(chunk, offset);
      offset += chunk.length;
    }

    if(output.length!==transfer.size) {
      setMessage(`Size mismatch: ${formatBytes(output.length)} received, expected ${formatBytes(transfer.size)}.`, "error");
      return;
    }

    const hash=await sha256Hex(output.buffer);
    if(hash.toLowerCase()!==transfer.sha256.toLowerCase()) {
      setMessage("SHA-256 verification FAILED. File is corrupted/incomplete.", "error");
      return;
    }

    completedBlob=new Blob([output], {type:"application/octet-stream"});
    downloadUrl=URL.createObjectURL(completedBlob);
    downloadButton.disabled=false;

    setMessage("Transfer complete and SHA-256 verified successfully.", "success");
  } catch(e) {
    console.error(e);
    setMessage(`Reconstruction failed: ${e.message}`, "error");
  }
}

async function startCamera() {
  if(cameraRunning) return;

  resetTransfer(true);
  scanner=new Html5Qrcode("reader");

  const config={
    fps:30,
    qrbox:(w,h)=>{
      const s=Math.floor(Math.min(w,h)*0.75);
      return {width:s,height:s};
    },
    aspectRatio:1.0,
    disableFlip:false
  };

  try {
    $("cameraStatus").textContent="Requesting camera permission...";
    await scanner.start(
      {facingMode:"environment"},
      config,
      async decodedText => { await handleQR(decodedText); },
      () => {}
    );

    cameraRunning=true;
    startButton.disabled=true;
    stopButton.disabled=false;
    $("cameraStatus").textContent="Camera running. Aim at the laptop QR.";
    setMessage("Camera ready. Start the QR sequence on the laptop.", "info");
  } catch(e) {
    console.error(e);
    $("cameraStatus").textContent="Camera could not be started.";
    setMessage("Camera access failed. Use an HTTPS page and allow camera permission.", "error");
    try { await scanner.clear(); } catch {}
  }
}

async function stopCamera() {
  if(!scanner || !cameraRunning) return;
  try { await scanner.stop(); await scanner.clear(); } catch(e) { console.error(e); }
  cameraRunning=false;
  startButton.disabled=false;
  stopButton.disabled=true;
  $("cameraStatus").textContent="Camera is stopped.";
}

function downloadFile() {
  if(!downloadUrl) return;
  const a=document.createElement("a");
  a.href=downloadUrl;
  a.download=transfer.name || "received_file";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

startButton.addEventListener("click", startCamera);
stopButton.addEventListener("click", stopCamera);
resetButton.addEventListener("click", async()=>{ await stopCamera(); resetTransfer(); });
downloadButton.addEventListener("click", downloadFile);

resetTransfer(true);
