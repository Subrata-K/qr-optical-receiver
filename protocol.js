/**
 * Communication protocol decoder for Multi-Color QR Optical Transfer.
 */

const Protocol = (function() {
    const MAGIC = [0x43, 0x51, 0x4F, 0x54]; // "CQOT"
    const HEADER_SIZE = 28;
    const FULL_HEADER_SIZE = 32;
    const MAX_PAYLOAD = 1024;

    const FrameType = {
        CALIBRATION: 0x01,
        DATA: 0x02,
        ACK: 0x03,
        NACK: 0x04,
        READY: 0x05,
        READY_ACK: 0x06,
        TRANSFER_START: 0x07,
        TRANSFER_READY: 0x08,
        TRANSFER_COMPLETE: 0x09,
        HANDSHAKE: 0x0A,
        HANDSHAKE_ACK: 0x0B,
        LAST_FRAME: 0x0C
    };

    const StatusCode = {
        OK: 0x00,
        CRC_ERROR: 0x01,
        INVALID_FRAME: 0x02,
        WRONG_SESSION: 0x03,
        DUPLICATE: 0x04,
        DECODE_ERROR: 0x05,
        CALIBRATION_OK: 0x10,
        CALIBRATION_FAIL: 0x11,
        READY: 0x20,
        TRANSFER_COMPLETE: 0x30
    };

    function bytesToHex(bytes) {
        return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    function parsePacket(data) {
        if (data.length < FULL_HEADER_SIZE + 4) {
            return null;
        }

        // Check magic
        for (let i = 0; i < 4; i++) {
            if (data[i] !== MAGIC[i]) return null;
        }

        // Verify header CRC
        const headerNoCrc = data.slice(0, HEADER_SIZE);
        const storedHeaderCrc = CRC32.fromBytes(data.slice(HEADER_SIZE, FULL_HEADER_SIZE));
        const computedHeaderCrc = CRC32.compute(headerNoCrc);

        if (storedHeaderCrc !== computedHeaderCrc) {
            console.warn("Header CRC mismatch");
            return null;
        }

        // Parse header fields
        const protocolVersion = data[4];
        const frameType = data[5];
        const colorMode = data[6];
        const qrVersion = data[7];
        const sessionId = data.slice(8, 16);
        const frameNumber = (data[16] << 24) | (data[17] << 16) | (data[18] << 8) | data[19];
        const totalFrames = (data[20] << 24) | (data[21] << 16) | (data[22] << 8) | data[23];
        const payloadLength = (data[24] << 8) | data[25];

        // Parse payload
        const payloadStart = FULL_HEADER_SIZE;
        const payloadEnd = payloadStart + payloadLength;

        if (data.length < payloadEnd + 4) {
            return null;
        }

        const payload = data.slice(payloadStart, payloadEnd);
        const storedPayloadCrc = CRC32.fromBytes(data.slice(payloadEnd, payloadEnd + 4));
        const computedPayloadCrc = CRC32.compute(payload);

        if (storedPayloadCrc !== computedPayloadCrc) {
            console.warn("Payload CRC mismatch");
            return null;
        }

        return {
            protocolVersion,
            frameType,
            colorMode,
            qrVersion,
            sessionId: bytesToHex(sessionId),
            frameNumber,
            totalFrames,
            payloadLength,
            payload: payload,
            valid: true
        };
    }

    function createAckPacket(sessionId, frameNumber, status) {
        // Simple ACK format: "ACK:SESSION:FRAME:STATUS"
        return `ACK:${sessionId}:${frameNumber}:${status}`;
    }

    return {
        FrameType,
        StatusCode,
        parsePacket,
        createAckPacket,
        bytesToHex
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Protocol;
}
