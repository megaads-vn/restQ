class Producer {
    constructor(messageCode = null, io = null) {
        this.messageCode = messageCode;
        this.io = io;
    }
}

module.exports = Producer;
