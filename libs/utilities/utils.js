// Standard CRC-32 (IEEE 802.3) table. This matches MySQL's CRC32() and
// zlib.crc32, but works on Node.js versions older than v22.2.0 where
// zlib.crc32 is not available.
let crcTable = null;
function getCRCTable() {
    if (crcTable) {
        return crcTable;
    }
    crcTable = [];
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        crcTable[n] = c >>> 0;
    }
    return crcTable;
}

module.exports = {
    crc32: function (data) {
        let buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
        const table = getCRCTable();
        let crc = 0xFFFFFFFF;
        for (let i = 0; i < buf.length; i++) {
            crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
        }
        // XOR with 0xFFFFFFFF and coerce to unsigned 32-bit.
        return (crc ^ 0xFFFFFFFF) >>> 0;
    }
}
