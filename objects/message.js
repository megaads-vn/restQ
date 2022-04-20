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
        this.first_processing_at = 0,
        this.last_processing_at = 0,
        this.last_processed_at = 0
    }

    static generateMessageCode(length = 32) {
        let retVal = '';

        const characters  = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
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
            last_processed_at: this.last_processed_at
        }
    }

    static buildMessageFromDatabaseRecord(data) {
        let retVal = new Message();
        retVal.code = data.code ?? retVal.code;
        retVal.data = data.data ? JSON.parse(data.data) : retVal.data;
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

        return retVal;
    }

    static buildMessageFromIO(io) {
        let retVal = new Message();
        
        retVal.data = {
            url: io.request.url,
            method: io.request.method,
            payload: Object.assign({}, io.request.inputs)
        };
        retVal.path = io.request.url;
        retVal.priority = io.request.inputs.priority ?? 0;
        retVal.postback_url = io.request.inputs.postback_url ?? null;

        if (typeof io.request.inputs.is_callback === 'undefined' || io.request.inputs.is_callback) {
            retVal.is_callback = 1;
        } else {
            retVal.is_callback = 0;
        }
        
        return retVal;
    }
}

module.exports = Message;
