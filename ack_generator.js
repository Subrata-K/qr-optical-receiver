/**
 * ACK code generator for phone display.
 */

const ACKGenerator = (function() {
    function generateAckQr(sessionId, frameNumber, status, canvas) {
        const ctx = canvas.getContext('2d');
        const size = canvas.width;
        const data = `ACK:${sessionId}:${frameNumber}:${status}`;
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, size, size);
        ctx.fillStyle = 'black';
        ctx.font = 'bold 16px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const border = 4;
        ctx.fillRect(0, 0, size, border);
        ctx.fillRect(0, size - border, size, border);
        ctx.fillRect(0, 0, border, size);
        ctx.fillRect(size - border, 0, border, size);
        ctx.fillRect(border, border, 20, 20);
        ctx.fillRect(size - 24, border, 20, 20);
        ctx.fillRect(border, size - 24, 20, 20);
        ctx.fillStyle = 'black';
        ctx.fillText(data, size/2, size/2);
        return data;
    }

    function clearAck(canvas) {
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    return { generateAckQr, clearAck };
})();
