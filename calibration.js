/**
 * Automatic color calibration module.
 */

const Calibration = (function() {
    let isCalibrated = false;
    let calibratedColors = [];
    let colorCount = 2;

    function setColorCount(count) {
        colorCount = count;
        isCalibrated = false;
        calibratedColors = [];
    }

    function processCalibrationFrame(imageData, width, height, qrGrid) {
        calibratedColors = [];
        const cols = Math.min(8, colorCount);
        const rows = Math.ceil(colorCount / cols);
        const moduleSize = 20;
        const centerX = width / 2;
        const centerY = height / 2;
        const gridWidth = cols * moduleSize;
        const gridHeight = rows * moduleSize;
        const startX = Math.floor(centerX - gridWidth / 2);
        const startY = Math.floor(centerY - gridHeight / 2);

        for (let i = 0; i < colorCount; i++) {
            const row = Math.floor(i / cols);
            const col = i % cols;
            const sx = startX + col * moduleSize + Math.floor(moduleSize / 2);
            const sy = startY + row * moduleSize + Math.floor(moduleSize / 2);
            if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
                const idx = (sy * width + sx) * 4;
                calibratedColors.push([imageData[idx], imageData[idx+1], imageData[idx+2]]);
            } else {
                const ref = ColorClassifier.REFERENCE_PALETTES[colorCount];
                calibratedColors.push(ref ? ref[i] : [128, 128, 128]);
            }
        }
        isCalibrated = calibratedColors.length === colorCount;
        return isCalibrated;
    }

    function getCalibratedColors() {
        return isCalibrated ? calibratedColors : null;
    }

    function getStatus() {
        return isCalibrated ? `Calibrated (${colorCount} colors)` : "Not Calibrated";
    }

    return {
        setColorCount,
        processCalibrationFrame,
        getCalibratedColors,
        getStatus,
        get isCalibrated() { return isCalibrated; }
    };
})();
