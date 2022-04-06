const ConsumerInterface = require(__dir + "/interfaces/consumer-interface");
const axios = require('axios');

class Consumer extends ConsumerInterface {
    constructor($event, origin = null, qos = 0, paths = []) {
        super();
        this.code = Consumer.generateConsumerCode;
        this.origin = origin;
        this.qos = qos;
        this.paths = paths;
        this.processing_request_count = 0;
        this.$event = $event;
    }

    static generateConsumerCode(length = 32) {
        let retVal = '';

        const characters  = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        var charactersLength = characters.length;
        for (let i = 0; i < length; i++) {
            retVal += characters.charAt(Math.floor(Math.random() * charactersLength));
        }

        return retVal;
    }

    async consume(message, io = null) {
        if (message.data && message.data.url && message.data.method) {
            this.processing_request_count++;
            let self = this;
            
            let config = this.buildRequestConfig(message, io);
            axios(config).then(function (response) {
                self.processing_request_count--;
                message.status = 'DONE';
                message.last_processed_at = Date.now();
                self.$event.fire('consumer::done', {message, consumer: self, response, status: 'successful'});
            }).catch(function (error) {
                self.processing_request_count--;
                message.status = 'WAITING';
                if (message.last_processing_at) {
                    message.retry_count++; 
                }
                self.$event.fire('consumer::done', {message, consumer: self, response: error.response, status: 'error'});
            });
        }
    }

    buildRequestConfig(message, io = null) {
        let retVal = {
            method: message.data.method,
            url: this.origin + message.data.url
        };

        let data = null;
        if (message.data.payload 
            && Object.keys(message.data.payload).length !== 0
            && Object.getPrototypeOf(message.data.payload) === Object.prototype) {
            data = message.data.payload;
        }
        retVal.data = data;

        let headers = {};
        if (io) {
            headers = Object.assign({}, io.request.headers);
            headers["x-forwarded-for"] = io.request.connection.remoteAddress
            delete headers['content-length'];
        }
        retVal.headers = headers;

        return retVal;
    }
}

module.exports = Consumer;
