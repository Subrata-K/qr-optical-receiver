/**
 * Camera handling using getUserMedia.
 */

const Camera = (function() {
    let video = null;
    let canvas = null;
    let ctx = null;
    let stream = null;
    let isRunning = false;
    let frameCallback = null;
    let animationId = null;
    let debugCanvas = null;

    function init(videoElement, canvasElement) {
        video = videoElement;
        canvas = canvasElement;
        ctx = canvas.getContext('2d', { willReadFrequently: true });
        debugCanvas = document.getElementById('debugCanvas');
    }

    async function start(resolution) {
        resolution = resolution || '1280x720';
        if (!video) throw new Error('Camera not initialized');

        const [w, h] = resolution.split('x').map(Number);

        try {
            // Request camera with exact constraints
            const constraints = {
                video: {
                    facingMode: 'user',
                    width: { ideal: w },
                    height: { ideal: h }
                },
                audio: false
            };

            stream = await navigator.mediaDevices.getUserMedia(constraints);

            // Attach stream to video element
            video.srcObject = stream;

            // Wait for video to be ready
            await new Promise(function(resolve, reject) {
                video.onloadedmetadata = function() {
                    resolve();
                };
                video.onerror = function(e) {
                    reject(new Error('Video element error: ' + e.message));
                };
                // Timeout fallback
                setTimeout(function() {
                    if (video.readyState >= 2) resolve();
                }, 2000);
            });

            await video.play();

            // Set canvas size to match video
            canvas.width = video.videoWidth || w;
            canvas.height = video.videoHeight || h;
            if (debugCanvas) {
                debugCanvas.width = video.videoWidth || w;
                debugCanvas.height = video.videoHeight || h;
            }

            // Show video and debug canvas, hide overlay
            video.classList.add('active');
            if (debugCanvas) debugCanvas.classList.add('active');

            isRunning = true;
            startFrameLoop();
            return true;

        } catch (err) {
            console.error('Camera error:', err.name, err.message);
            // Provide user-friendly error messages
            let friendlyMsg = 'Camera failed to start: ';
            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                friendlyMsg += 'Camera permission denied. Please allow camera access in your browser settings and reload the page.';
            } else if (err.name === 'NotFoundError') {
                friendlyMsg += 'No camera found. Please ensure your device has a front camera.';
            } else if (err.name === 'NotReadableError') {
                friendlyMsg += 'Camera is already in use by another app. Please close other camera apps.';
            } else if (err.name === 'OverconstrainedError') {
                friendlyMsg += 'Requested camera resolution not supported. Trying fallback...';
                // Try again with lower resolution
                try {
                    return await start('640x480');
                } catch (e2) {
                    friendlyMsg = 'Camera failed: resolution not supported.';
                }
            } else {
                friendlyMsg += err.message || 'Unknown error';
            }
            throw new Error(friendlyMsg);
        }
    }

    function stop() {
        isRunning = false;
        if (animationId) cancelAnimationFrame(animationId);
        if (stream) {
            stream.getTracks().forEach(function(t) { t.stop(); });
            stream = null;
        }
        if (video) {
            video.srcObject = null;
            video.classList.remove('active');
        }
        if (debugCanvas) debugCanvas.classList.remove('active');
    }

    function startFrameLoop() {
        function loop() {
            if (!isRunning) return;
            if (video.readyState >= 2) {
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                if (frameCallback) {
                    frameCallback(imageData.data, canvas.width, canvas.height);
                }
            }
            animationId = requestAnimationFrame(loop);
        }
        loop();
    }

    function onFrame(callback) {
        frameCallback = callback;
    }

    function getImageData() {
        if (!ctx) return null;
        return ctx.getImageData(0, 0, canvas.width, canvas.height);
    }

    return {
        init, start, stop, onFrame, getImageData,
        get isRunning() { return isRunning; }
    };
})();
