/**
 * CRC-32 implementation in JavaScript.
 * Uses standard IEEE 802.3 polynomial.
 */

const CRC32 = (function() {
    // Precomputed CRC table
    const table = new Uint32Array(256);

    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[i] = c >>> 0;
    }

    function update(crc, data) {
        if (typeof data === 'string') {
            data = new TextEncoder().encode(data);
        }
        for (let i = 0; i < data.length; i++) {
            crc = (table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8)) >>> 0;
        }
        return crc;
    }

    return {
        compute: function(data) {
            return (update(0xFFFFFFFF, data) ^ 0xFFFFFFFF) >>> 0;
        },

        verify: function(data, expectedCrc) {
            return this.compute(data) === expectedCrc;
        },

        toBytes: function(crc) {
            return new Uint8Array([
                (crc >>> 24) & 0xFF,
                (crc >>> 16) & 0xFF,
                (crc >>> 8) & 0xFF,
                crc & 0xFF
            ]);
        },

        fromBytes: function(bytes) {
            return ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
        }
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = CRC32;
}
