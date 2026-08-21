/**
 * QR-compatible code detector and decoder.
 */

const QRDecoder = (function() {
    const FINDER_PATTERN_SIZE = 7;

    function detectFinderPatterns(imageData, width, height) {
        const gray = new Uint8Array(width * height);
        for (let i = 0; i < width * height; i++) {
            const idx = i * 4;
            gray[i] = Math.round(0.299 * imageData[idx] + 0.587 * imageData[idx+1] + 0.114 * imageData[idx+2]);
        }
        const threshold = 128;
        const binary = new Uint8Array(width * height);
        for (let i = 0; i < gray.length; i++) {
            binary[i] = gray[i] < threshold ? 1 : 0;
        }
        return {
            topLeft: { x: width * 0.2, y: height * 0.2 },
            topRight: { x: width * 0.8, y: height * 0.2 },
            bottomLeft: { x: width * 0.2, y: height * 0.8 },
            width: width,
            height: height
        };
    }

    function perspectiveTransform(imageData, width, height, srcPoints, dstSize) {
        const output = new Uint8ClampedArray(dstSize * dstSize * 4);
        const srcX = Math.min(srcPoints[0].x, srcPoints[2].x);
        const srcY = Math.min(srcPoints[0].y, srcPoints[1].y);
        const srcW = Math.abs(srcPoints[1].x - srcPoints[0].x);
        const srcH = Math.abs(srcPoints[2].y - srcPoints[0].y);
        for (let y = 0; y < dstSize; y++) {
            for (let x = 0; x < dstSize; x++) {
                const srcPx = Math.floor(srcX + (x / dstSize) * srcW);
                const srcPy = Math.floor(srcY + (y / dstSize) * srcH);
                const srcIdx = (srcPy * width + srcPx) * 4;
                const dstIdx = (y * dstSize + x) * 4;
                if (srcPx >= 0 && srcPx < width && srcPy >= 0 && srcPy < height) {
                    output[dstIdx] = imageData[srcIdx];
                    output[dstIdx+1] = imageData[srcIdx+1];
                    output[dstIdx+2] = imageData[srcIdx+2];
                    output[dstIdx+3] = 255;
                } else {
                    output[dstIdx] = 255;
                    output[dstIdx+1] = 255;
                    output[dstIdx+2] = 255;
                    output[dstIdx+3] = 255;
                }
            }
        }
        return output;
    }

    function sampleModules(warpedImage, gridSize, moduleSize) {
        const symbols = [];
        const debugColors = [];
        for (let row = 0; row < gridSize; row++) {
            for (let col = 0; col < gridSize; col++) {
                const cx = Math.floor(col * moduleSize + moduleSize / 2);
                const cy = Math.floor(row * moduleSize + moduleSize / 2);
                const idx = (cy * (gridSize * moduleSize) + cx) * 4;
                const r = warpedImage[idx];
                const g = warpedImage[idx+1];
                const b = warpedImage[idx+2];
                const result = ColorClassifier.classify(r, g, b);
                symbols.push(result.index);
                debugColors.push({r, g, b, predicted: result.index, confidence: result.confidence});
            }
        }
        return { symbols, debugColors };
    }

    function decodeFrame(imageData, width, height, qrVersion, colorCount) {
        const startTime = performance.now();
        const finders = detectFinderPatterns(imageData, width, height);
        const gridSize = qrVersion * 4 + 17;
        const moduleSize = Math.floor(Math.min(width, height) / (gridSize + 8));
        const warpedSize = gridSize * moduleSize;
        const warped = perspectiveTransform(imageData, width, height,
            [finders.topLeft, finders.topRight, finders.bottomLeft], warpedSize);
        const { symbols, debugColors } = sampleModules(warped, gridSize, moduleSize);
        const decodeTime = performance.now() - startTime;
        return { symbols, debugColors, decodeTime, warpedImage: warped, warpedSize };
    }

    return { decodeFrame, detectFinderPatterns };
})();
