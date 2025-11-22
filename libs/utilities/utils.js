const zlib = require('zlib');

module.exports = {
    crc32: function (data) {
        let buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
        // zlib.crc32 luôn trả về signed int32 ở JS,
        // dùng >>> 0 để chuyển thành unsigned 32-bit
        return zlib.crc32(buf) >>> 0;
    }
}