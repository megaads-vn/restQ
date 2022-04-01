class Message {
    constructor(data = null, callback_url = null, is_callback = 0, priority = 0) {
        this.code = Message.generateMessageCode(32);
        this.status = 'WAITING';
        this.data = data;
        this.priority = priority;
        this.retry_count = 0;
        this.callback_url = callback_url;
        this.is_callback = is_callback;
        this.created_at = Date.now();
        this.first_processing_at = null,
        this.last_processing_at = null,
        this.last_processed_at = null
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
            data: this.data,
            priority: this.priority,
            status: this.status,
            retry_count: this.retry_count,
            callback_url: this.callback_url,
            is_callback: this.is_callback,
            created_at: this.created_at,
            first_processing_at: this.first_processing_at,
            last_processing_at: this.last_processing_at,
            last_processed_at: this.last_processed_at
        }
    }

    buildMessage(data) {
        let retVal = new Message();
        retVal.code = data.code ?? retVal.code;
        retVal.data = data.data ?? retVal.data;
        retVal.priority = data.priority ?? retVal.priority;
        retVal.status = data.status ?? retVal.status;
        retVal.retry_count = data.retry_count ?? retVal.retry_count;
        retVal.callback_url = data.callback_url ?? retVal.callback_url;
        retVal.is_callback = data.is_callback ?? retVal.is_callback;
        retVal.created_at = data.created_at ?? retVal.created_at;
        retVal.first_processing_at = data.first_processing_at ?? retVal.first_processing_at;
        retVal.last_processing_at = data.last_processing_at ?? retVal.last_processing_at;
        retVal.last_processed_at = data.last_processed_at ?? retVal.last_processed_at;

        return retVal;
    }
}

module.exports = Message;
