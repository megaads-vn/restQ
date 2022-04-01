class Producer {
    constructor(messageCode = null, request = null, response = null) {
        this.messageCode = messageCode;
        this.request = request;
        this.response = response;
    }
}

module.exports = Producer;
