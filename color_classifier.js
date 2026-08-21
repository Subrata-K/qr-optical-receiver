/**
 * Color classification algorithms for multi-color QR decoding.
 * Supports RGB Euclidean, HSV distance, and Lab/ΔE classification.
 */

const ColorClassifier = (function() {
    let currentMode = 'lab'; // 'rgb', 'hsv', 'lab'
    let palette = [];
    let calibratedColors = null;

    // Reference palettes (same as laptop)
    const REFERENCE_PALETTES = {
        2:  [[0,0,0], [255,255,255]],
        4:  [[0,0,0], [255,255,255], [255,0,0], [0,0,255]],
        8:  [[0,0,0], [255,255,255], [255,0,0], [0,255,0], [0,0,255], [255,255,0], [255,0,255], [0,255,255]],
        16: [[0,0,0], [255,255,255], [255,0,0], [139,0,0], [0,255,0], [0,139,0], [0,0,255], [0,0,139],
             [255,255,0], [180,180,0], [255,0,255], [139,0,139], [0,255,255], [0,139,139], [255,165,0], [128,0,128]],
        32: [[0,0,0], [255,255,255], [255,0,0], [0,255,0], [0,0,255], [255,255,0], [255,0,255], [0,255,255],
             [255,128,128], [128,255,128], [128,128,255], [255,255,128], [255,128,255], [128,255,255], [255,165,0], [255,192,203],
             [139,0,0], [0,139,0], [0,0,139], [180,180,0], [139,0,139], [0,139,139], [255,140,0], [165,42,42],
             [128,0,128], [0,128,128], [128,128,0], [0,0,128], [128,0,0], [34,139,34], [255,127,80], [64,224,208]]
    };

    function setMode(mode) {
        currentMode = mode;
    }

    function setPalette(colorCount) {
        palette = REFERENCE_PALETTES[colorCount] || REFERENCE_PALETTES[2];
        calibratedColors = null;
    }

    function setCalibratedColors(colors) {
        calibratedColors = colors;
    }

    function rgbToLab(r, g, b) {
        r = r / 255; g = g / 255; b = b / 255;
        r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
        g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
        b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;
        let x = r * 0.4124564 + g * 0.3575761 + b * 0.1804375;
        let y = r * 0.2126729 + g * 0.7151522 + b * 0.0721750;
        let z = r * 0.0193339 + g * 0.1191920 + b * 0.9503041;
        const f = (t) => t > 0.008856 ? Math.pow(t, 1/3) : (7.787 * t + 16/116);
        const l = 116 * f(y) - 16;
        const a = 500 * (f(x/0.95047) - f(y));
        const bval = 200 * (f(y) - f(z/1.08883));
        return [l, a, bval];
    }

    function rgbToHsv(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h, s, v = max;
        const d = max - min;
        s = max === 0 ? 0 : d / max;
        if (max === min) {
            h = 0;
        } else {
            switch (max) {
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }
            h /= 6;
        }
        return [h * 360, s, v];
    }

    function deltaE(lab1, lab2) {
        return Math.sqrt(
            Math.pow(lab1[0] - lab2[0], 2) +
            Math.pow(lab1[1] - lab2[1], 2) +
            Math.pow(lab1[2] - lab2[2], 2)
        );
    }

    function rgbDistance(c1, c2) {
        return Math.sqrt(
            Math.pow(c1[0] - c2[0], 2) +
            Math.pow(c1[1] - c2[1], 2) +
            Math.pow(c1[2] - c2[2], 2)
        );
    }

    function hsvDistance(hsv1, hsv2) {
        const dh = Math.min(Math.abs(hsv1[0] - hsv2[0]), 360 - Math.abs(hsv1[0] - hsv2[0])) / 180;
        const ds = Math.abs(hsv1[1] - hsv2[1]);
        const dv = Math.abs(hsv1[2] - hsv2[2]);
        return Math.sqrt(dh * dh * 4 + ds * ds + dv * dv);
    }

    function classify(r, g, b) {
        const colors = calibratedColors || palette;
        if (!colors || colors.length === 0) return { index: 0, confidence: 0, distance: 999 };

        let bestIndex = 0;
        let bestDistance = Infinity;
        let secondBest = Infinity;

        if (currentMode === 'lab') {
            const lab = rgbToLab(r, g, b);
            for (let i = 0; i < colors.length; i++) {
                const refLab = rgbToLab(colors[i][0], colors[i][1], colors[i][2]);
                const d = deltaE(lab, refLab);
                if (d < bestDistance) {
                    secondBest = bestDistance;
                    bestDistance = d;
                    bestIndex = i;
                } else if (d < secondBest) {
                    secondBest = d;
                }
            }
        } else if (currentMode === 'hsv') {
            const hsv = rgbToHsv(r, g, b);
            for (let i = 0; i < colors.length; i++) {
                const refHsv = rgbToHsv(colors[i][0], colors[i][1], colors[i][2]);
                const d = hsvDistance(hsv, refHsv);
                if (d < bestDistance) {
                    secondBest = bestDistance;
                    bestDistance = d;
                    bestIndex = i;
                } else if (d < secondBest) {
                    secondBest = d;
                }
            }
        } else {
            for (let i = 0; i < colors.length; i++) {
                const d = rgbDistance([r, g, b], colors[i]);
                if (d < bestDistance) {
                    secondBest = bestDistance;
                    bestDistance = d;
                    bestIndex = i;
                } else if (d < secondBest) {
                    secondBest = d;
                }
            }
        }

        const confidence = secondBest > 0 ? 1 - (bestDistance / secondBest) : 1;
        return {
            index: bestIndex,
            confidence: Math.max(0, Math.min(1, confidence)),
            distance: bestDistance
        };
    }

    return {
        setMode,
        setPalette,
        setCalibratedColors,
        classify,
        rgbToLab,
        rgbToHsv,
        REFERENCE_PALETTES
    };
})();
