/**
 * UI update utilities.
 */

const UI = (function() {
    const elements = {};

    function init() {
        elements.status = document.getElementById('connectionStatus');
        elements.state = document.getElementById('stateValue');
        elements.colorMode = document.getElementById('colorModeValue');
        elements.calibration = document.getElementById('calibrationValue');
        elements.frame = document.getElementById('frameValue');
        elements.received = document.getElementById('receivedValue');
        elements.decodeTime = document.getElementById('decodeTimeValue');
        elements.accuracy = document.getElementById('accuracyValue');
        elements.crc = document.getElementById('crcValue');
        elements.progressFill = document.getElementById('progressFill');
        elements.progressText = document.getElementById('progressText');
        elements.log = document.getElementById('logContent');
        elements.ackLabel = document.getElementById('ackLabel');
        elements.cameraOverlay = document.getElementById('cameraOverlay');
        elements.downloadSection = document.getElementById('downloadSection');
    }

    function setStatus(status) {
        if (elements.status) {
            elements.status.textContent = status;
            elements.status.className = 'status-badge ' + status.toLowerCase().replace(/\s+/g, '-');
        }
    }

    function setState(state) { if (elements.state) elements.state.textContent = state; }
    function setColorMode(mode) { if (elements.colorMode) elements.colorMode.textContent = mode; }
    function setCalibration(status) { if (elements.calibration) elements.calibration.textContent = status; }
    function setFrame(current, total) { if (elements.frame) elements.frame.textContent = current + ' / ' + total; }

    function setReceived(bytes, total) {
        if (elements.received) elements.received.textContent = formatBytes(bytes) + ' / ' + formatBytes(total);
    }

    function setDecodeTime(ms) { if (elements.decodeTime) elements.decodeTime.textContent = ms.toFixed(0) + ' ms'; }
    function setAccuracy(acc) { if (elements.accuracy) elements.accuracy.textContent = (acc * 100).toFixed(1) + '%'; }

    function setCrc(valid) {
        if (elements.crc) {
            elements.crc.textContent = valid ? 'VALID' : 'INVALID';
            elements.crc.style.color = valid ? '#4CAF50' : '#f44336';
        }
    }

    function setProgress(pct) {
        if (elements.progressFill) elements.progressFill.style.width = pct + '%';
        if (elements.progressText) elements.progressText.textContent = pct.toFixed(1) + '%';
    }

    function setAckLabel(text) { if (elements.ackLabel) elements.ackLabel.textContent = text; }
    function showCamera() { if (elements.cameraOverlay) elements.cameraOverlay.style.display = 'none'; }
    function hideCamera() { if (elements.cameraOverlay) elements.cameraOverlay.style.display = 'flex'; }

    function log(message, type) {
        type = type || 'info';
        if (!elements.log) return;
        const entry = document.createElement('div');
        entry.className = 'log-entry ' + type;
        const time = new Date().toLocaleTimeString();
        entry.textContent = '[' + time + '] ' + message;
        elements.log.appendChild(entry);
        elements.log.scrollTop = elements.log.scrollHeight;
    }

    function showDownload(fileName, fileSize, hash) {
        document.getElementById('downloadFileName').textContent = fileName;
        document.getElementById('downloadFileSize').textContent = formatBytes(fileSize);
        document.getElementById('downloadHash').textContent = hash;
        elements.downloadSection.style.display = 'block';
    }

    function formatBytes(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024*1024) return (bytes/1024).toFixed(2) + ' KB';
        return (bytes/(1024*1024)).toFixed(2) + ' MB';
    }

    return {
        init, setStatus, setState, setColorMode, setCalibration, setFrame,
        setReceived, setDecodeTime, setAccuracy, setCrc, setProgress,
        setAckLabel, showCamera, hideCamera, log, showDownload
    };
})();
