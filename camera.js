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

    function init(videoElement, canvasElement) {
        video = videoElement;
        canvas = canvasElement;
        ctx = canvas.getContext('2d', { willReadFrequently: true });
    }

    async function start(resolution) {
        resolution = resolution || '1280x720';
        if (!video) throw new Error('Camera not initialized');
        const [w, h] = resolution.split('x').map(Number);
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user', width: { ideal: w }, height: { ideal: h } },
                audio: false
            });
            video.srcObject = stream;
            await video.play();
            canvas.width = video.videoWidth || w;
            canvas.height = video.videoHeight || h;
            isRunning = true;
            startFrameLoop();
            return true;
        } catch (err) {
            console.error('Camera error:', err);
            throw err;
        }
    }

    function stop() {
        isRunning = false;
        if (animationId) cancelAnimationFrame(animationId);
        if (stream) {
            stream.getTracks().forEach(t => t.stop());
            stream = null;
        }
        if (video) video.srcObject = null;
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
