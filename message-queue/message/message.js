const crypto = require('crypto');

class Message {
    constructor(data = null, postback_url = null, is_callback = 1, priority = 0) {
        this.code = Message.generateMessageCode(32);
        this.status = 'WAITING';
        this.data = data;
        this.path = data ? data.url : null;
        this.priority = priority;
        this.retry_count = 0;
        this.postback_url = postback_url;
        this.is_callback = is_callback;
        this.last_consumer = null;
        this.created_at = Date.now();
        this.first_processing_at = 0;
        this.last_processing_at = 0;
        this.last_processed_at = 0;
        this.delay_to = 0;
        Message.generateHash(this);
    }

    static generateMessageCode(length = 32) {
        let retVal = '';

        const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        var charactersLength = characters.length;
        for (let i = 0; i < length; i++) {
            retVal += characters.charAt(Math.floor(Math.random() * charactersLength));
        }

        return retVal;
    }

    serialize() {
        return {
            code: this.code ?? Message.generateMessageCode(32),
            data: this.data ? JSON.stringify(this.data) : null,
            hash: this.hash,
            path: this.path,
            priority: this.priority,
            status: this.status,
            retry_count: this.retry_count,
            postback_url: this.postback_url,
            is_callback: this.is_callback,
            last_consumer: this.last_consumer,
            created_at: this.created_at,
            first_processing_at: this.first_processing_at,
            last_processing_at: this.last_processing_at,
            last_processed_at: this.last_processed_at,
            delay_to: this.delay_to
        }
    }

    static buildMessageFromDatabaseRecord(data) {
        let retVal = new Message();
        retVal.id = data.id ?? retVal.id;
        retVal.code = data.code ?? retVal.code;
        retVal.data = data.data ? JSON.parse(data.data) : retVal.data;
        retVal.hash = data.hash;
        retVal.path = data.path ?? retVal.path;
        retVal.priority = data.priority ?? retVal.priority;
        retVal.status = data.status ?? retVal.status;
        retVal.retry_count = data.retry_count ?? retVal.retry_count;
        retVal.postback_url = data.postback_url ?? retVal.postback_url;
        retVal.is_callback = data.is_callback ?? retVal.is_callback;
        retVal.last_consumer = data.last_consumer ?? retVal.last_consumer;
        retVal.created_at = data.created_at ?? retVal.created_at;
        retVal.first_processing_at = data.first_processing_at ?? retVal.first_processing_at;
        retVal.last_processing_at = data.last_processing_at ?? retVal.last_processing_at;
        retVal.last_processed_at = data.last_processed_at ?? retVal.last_processed_at;
        retVal.delay_to = data.delay_to ? retVal.last_processed_at : 0;
        Message.generateHash(retVal);
        return retVal;
    }

    static buildMessageFromIO(io) {
        let retVal = new Message();

        retVal.data = {
            url: io.request.url,
            method: io.request.method
        };
        if (typeof io.inputs === "object") {
            retVal.data.payload = Object.assign({}, io.inputs);
        } else {
            retVal.data.payload = io.inputs;
        }
        // Headers
        let headers = Object.assign({}, io.request.headers);
        if (io.request.connection && io.request.connection.remoteAddress) {
            headers["X-Forwarded-For"] = io.request.connection.remoteAddress;
        } else if (io.request.socket && io.request.socket.remoteAddress) {
            headers["X-Forwarded-For"] = io.request.socket.remoteAddress;
        }
        delete headers['content-length'];
        retVal.data.headers = headers;

        retVal.path = io.request.url;
        retVal.priority = io.inputs.priority ?? 0;
        retVal.postback_url = io.inputs.postback_url ?? null;

        if (typeof io.inputs.is_callback === 'undefined' || (io.inputs.is_callback && io.inputs.is_callback !== '0')) {
            retVal.is_callback = 1;
        } else {
            retVal.is_callback = 0;
        }

        retVal.delay_to = 0;
        if (io.inputs.delay != null) {
            retVal.delay_to = Date.now() + io.inputs.delay * 1000;
        }        

        Message.generateHash(retVal);

        return retVal;
    }

    static generateHash(mesage) {
        if ((mesage.hash == null || mesage.hash == '') && mesage.data != null) {
            mesage.hash = crypto.createHash('sha1')
                .update(JSON.stringify(mesage.data))
                .digest('hex');
        } else if (mesage.data == null) {
            mesage.hash = null
        }
        return mesage;
    }

}

module.exports = Message;
