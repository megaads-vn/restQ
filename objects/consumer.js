const ConsumerInterface = require(__dir + "/interfaces/consumer-interface");
const axios = require('axios');
const urlPackage = require('url');

class Consumer extends ConsumerInterface {
    constructor($config, $event, $logger, origin = null, qos = 0, paths = []) {
        super();
        this.code = Consumer.generateConsumerCode;
        this.origin = origin;
        this.qos = qos;
        this.paths = paths;
        this.processing_request_count = 0;
        this.$event = $event;
        this.$config = $config;
        this.$logger = $logger;
        this.requestTimeout = $config.get("consumers.defaultRequestTimeout");
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

    async consume(message, requestTimeout, io = null) {
        if (this.processing_request_count < this.qos && message.data && message.data.url && message.data.method) {
            this.processing_request_count++;
            let self = this;
            
            let requestConfig = this.buildRequestConfig(message, requestTimeout, io);
            process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
            axios(requestConfig)
            .then(function (response) {
                self.processing_request_count--;
                message.status = 'DONE';
                message.last_processed_at = Date.now();
                message.last_consumer = self.name;

                self.$event.fire('consumer::response', {
                    message, 
                    consumer: self, 
                    response, 
                    status: 'successful'
                });
            }).catch(function (error) {
                self.$logger.error('Consume Function: ' + error.message);

                if (error.code === 'ECONNABORTED') {
                    message.status = 'FAILED';
                } else {
                    message.status = 'WAITING';
                }

                self.processing_request_count--;
                if (message.last_processing_at > message.first_processing_at) {
                    message.retry_count++; 
                }
                message.last_consumer = self.name;

                self.$event.fire('consumer::response', {
                    message, 
                    consumer: self, 
                    response: {
                        status: error.response ? error.response.status : 504, // 504 - timeout in proxy
                        data: error.response ? error.response.data : {status: 'failed', message: error.message}
                    }, 
                    status: 'error',
                    errorCode: error.code
                });
            });
        } else {
            message.status = 'WAITING';
            if (message.retry_count == 0) {
                message.first_processing_at = 0;
                message.last_processing_at = 0;
            }
            self.$event.fire('consumer::response', {
                message, 
                consumer: self, 
                response: {}, 
                status: 'error',
                errorCode: 'QOS'
            });
        }
    }

    buildRequestConfig(message, requestTimeout = 0, io = null) {
        let self = this;
        let retVal = {
            method: message.data.method,
            url: this.origin + message.data.url,
            timeout: requestTimeout * 1000 
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

            if (io.request.connection && io.request.connection.remoteAddress) {
                headers["X-Forwarded-For"] = io.request.connection.remoteAddress;
            } else if (io.request.socket && io.request.socket.remoteAddress) {
                headers["X-Forwarded-For"] = io.request.socket.remoteAddress;
            }

            if (self.origin) {
                headers["host"] = urlPackage.parse(self.origin).host;
            }
            delete headers['content-length'];
        }
        retVal.headers = headers;

        return retVal;
    }
}

module.exports = Consumer;
