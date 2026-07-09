class Producer {
    constructor(messageCode = null, io = null) {
        this.messageCode = messageCode;
        this.io = io;
        this.createdAt = Date.now();
    }
}

module.exports = Producer;
