/**
 * Main application logic for Color QR Optical Transfer phone receiver.
 */

const App = (function() {
    const State = {
        IDLE: 'IDLE', CAMERA_INIT: 'CAMERA_INIT', CALIBRATING: 'CALIBRATING',
        HANDSHAKING: 'HANDSHAKING', RECEIVING: 'RECEIVING', DECODING: 'DECODING',
        SENDING_ACK: 'SENDING_ACK', COMPLETE: 'COMPLETE', ERROR: 'ERROR'
    };

    let currentState = State.IDLE;
    let sessionId = null;
    let colorMode = 2;
    let qrVersion = 3;
    let totalFrames = 0;
    let receivedFrames = new Map();
    let receivedBytes = 0;
    let fileData = [];
    let fileName = '';
    let frameStats = { totalClassifications: 0, correctClassifications: 0, decodeTimes: [] };

    let video, cameraCanvas, debugCanvas, ackCanvas;

    function init() {
        UI.init();
        video = document.getElementById('cameraVideo');
        cameraCanvas = document.getElementById('cameraCanvas');
        debugCanvas = document.getElementById('debugCanvas');
        ackCanvas = document.getElementById('ackCanvas');
        ackCanvas.width = 200;
        ackCanvas.height = 200;
        Camera.init(video, cameraCanvas);

        document.getElementById('btnStartCamera').addEventListener('click', startCamera);
        document.getElementById('btnCalibrate').addEventListener('click', requestCalibration);
        document.getElementById('btnStop').addEventListener('click', stop);
        document.getElementById('btnClearLog').addEventListener('click', function() {
            document.getElementById('logContent').innerHTML = '';
        });
        document.getElementById('btnDownload').addEventListener('click', downloadFile);
        document.getElementById('classifierSelect').addEventListener('change', function(e) {
            ColorClassifier.setMode(e.target.value);
            UI.log('Classifier changed to ' + e.target.value);
        });
        UI.log('App initialized. Press Start Camera to begin.');
    }

    async function startCamera() {
        try {
            const resolution = document.getElementById('resolutionSelect').value;
            await Camera.start(resolution);
            UI.showCamera();
            UI.setStatus('CAMERA READY');
            UI.log('Camera started successfully');
            document.getElementById('btnStartCamera').disabled = true;
            document.getElementById('btnCalibrate').disabled = false;
            document.getElementById('btnStop').disabled = false;
            Camera.onFrame(processFrame);
            setState(State.CAMERA_INIT);
        } catch (err) {
            UI.log('Failed to start camera: ' + err.message, 'error');
            alert('Camera access required. Please allow camera permission.');
        }
    }

    function requestCalibration() {
        UI.log('Calibration requested. Please show calibration frame from laptop.');
        setState(State.CALIBRATING);
    }

    function stop() {
        Camera.stop();
        UI.hideCamera();
        UI.setStatus('DISCONNECTED');
        setState(State.IDLE);
        document.getElementById('btnStartCamera').disabled = false;
        document.getElementById('btnCalibrate').disabled = true;
        document.getElementById('btnStop').disabled = true;
    }

    function setState(state) {
        currentState = state;
        UI.setState(state);
    }

    let lastFrameTime = 0;
    const FRAME_INTERVAL = 200;

    function processFrame(imageData, width, height) {
        const now = performance.now();
        if (now - lastFrameTime < FRAME_INTERVAL) return;
        lastFrameTime = now;
        if (currentState === State.CALIBRATING) {
            attemptCalibration(imageData, width, height);
        } else if (currentState === State.RECEIVING || currentState === State.HANDSHAKING) {
            attemptDecode(imageData, width, height);
        }
    }

    function attemptCalibration(imageData, width, height) {
        const success = Calibration.processCalibrationFrame(imageData, width, height, null);
        if (success) {
            const colors = Calibration.getCalibratedColors();
            ColorClassifier.setCalibratedColors(colors);
            UI.setCalibration(Calibration.getStatus());
            UI.log('Calibration complete with ' + colors.length + ' colors');
            displayAck('CALIBRATION_OK', 0);
            setState(State.HANDSHAKING);
        }
    }

    function attemptDecode(imageData, width, height) {
        setState(State.DECODING);
        try {
            const result = QRDecoder.decodeFrame(imageData, width, height, qrVersion, colorMode);
            const bytes = symbolsToBytes(result.symbols, colorMode);
            const packet = Protocol.parsePacket(bytes);
            if (!packet) { setState(State.RECEIVING); return; }
            handlePacket(packet, result);
        } catch (err) {
            setState(State.RECEIVING);
        }
    }

    function symbolsToBytes(symbols, colorCount) {
        const bitsPerSymbol = Math.log2(colorCount);
        let buffer = 0;
        let bitsInBuffer = 0;
        const result = [];
        for (let i = 0; i < symbols.length; i++) {
            buffer = (buffer << bitsPerSymbol) | symbols[i];
            bitsInBuffer += bitsPerSymbol;
            while (bitsInBuffer >= 8) {
                bitsInBuffer -= 8;
                result.push((buffer >> bitsInBuffer) & 0xFF);
            }
        }
        return new Uint8Array(result);
    }

    function handlePacket(packet, decodeResult) {
        if (sessionId && packet.sessionId !== sessionId) {
            UI.log('Wrong session ID, ignoring', 'warn');
            setState(State.RECEIVING); return;
        }
        frameStats.decodeTimes.push(decodeResult.decodeTime);
        UI.setDecodeTime(decodeResult.decodeTime);
        for (let i = 0; i < decodeResult.debugColors.length; i++) {
            frameStats.totalClassifications++;
        }

        if (packet.frameType === Protocol.FrameType.HANDSHAKE) {
            sessionId = packet.sessionId;
            colorMode = packet.colorMode;
            qrVersion = packet.qrVersion;
            totalFrames = packet.totalFrames;
            ColorClassifier.setPalette(colorMode);
            Calibration.setColorCount(colorMode);
            UI.setColorMode(colorMode + ' colors');
            UI.log('Handshake received. Session: ' + sessionId + ', Frames: ' + totalFrames + ', Color mode: ' + colorMode);
            displayAck('READY', 0);
            setState(State.HANDSHAKING);
            return;
        }

        if (packet.frameType === Protocol.FrameType.TRANSFER_START) {
            UI.log('Transfer starting...');
            fileData = new Array(totalFrames).fill(null);
            receivedFrames.clear();
            setState(State.RECEIVING);
            return;
        }

        if (packet.frameType === Protocol.FrameType.DATA || packet.frameType === Protocol.FrameType.LAST_FRAME) {
            if (receivedFrames.has(packet.frameNumber)) {
                UI.log('Duplicate frame ' + packet.frameNumber, 'warn');
                displayAck('ACK', packet.frameNumber);
                return;
            }
            receivedFrames.set(packet.frameNumber, packet.payload);
            fileData[packet.frameNumber] = packet.payload;
            receivedBytes += packet.payload.length;
            UI.setFrame(packet.frameNumber + 1, totalFrames);
            UI.setReceived(receivedBytes, totalFrames * 1024);
            UI.setProgress((receivedFrames.size / totalFrames) * 100);
            UI.setCrc(true);
            displayAck('ACK', packet.frameNumber);
            UI.log('Frame ' + packet.frameNumber + ' received (' + packet.payload.length + ' bytes)');
            if (packet.frameType === Protocol.FrameType.LAST_FRAME) {
                completeTransfer();
            } else {
                setState(State.RECEIVING);
            }
            return;
        }

        if (packet.frameType === Protocol.FrameType.TRANSFER_COMPLETE) {
            completeTransfer();
        }
    }

    function displayAck(status, frameNumber) {
        if (!sessionId) return;
        const ackData = Protocol.createAckPacket(sessionId, frameNumber, status);
        ACKGenerator.generateAckQr(sessionId, frameNumber, status, ackCanvas);
        UI.setAckLabel(status + ' ' + frameNumber);
        setState(State.SENDING_ACK);
        setTimeout(function() {
            if (currentState === State.SENDING_ACK) {
                setState(State.RECEIVING);
            }
        }, 300);
    }

    function completeTransfer() {
        setState(State.COMPLETE);
        UI.setStatus('COMPLETE');
        UI.log('Transfer complete! Reconstructing file...');
        const allBytes = [];
        for (let i = 0; i < fileData.length; i++) {
            if (fileData[i]) {
                for (let j = 0; j < fileData[i].length; j++) {
                    allBytes.push(fileData[i][j]);
                }
            }
        }
        const blob = new Blob([new Uint8Array(allBytes)]);
        const url = URL.createObjectURL(blob);
        crypto.subtle.digest('SHA-256', new Uint8Array(allBytes)).then(function(hashBuffer) {
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hashHex = hashArray.map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
            UI.showDownload(fileName || 'received_file.bin', allBytes.length, hashHex);
            UI.log('File reconstructed. SHA-256: ' + hashHex);
        });
        window._downloadUrl = url;
        window._downloadFilename = fileName || 'received_file.bin';
    }

    function downloadFile() {
        if (window._downloadUrl) {
            const a = document.createElement('a');
            a.href = window._downloadUrl;
            a.download = window._downloadFilename;
            a.click();
        }
    }

    return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);
