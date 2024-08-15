const ConsumerInterface = require("./consumer-interface");
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

        const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        var charactersLength = characters.length;
        for (let i = 0; i < length; i++) {
            retVal += characters.charAt(Math.floor(Math.random() * charactersLength));
        }

        return retVal;
    }

    async consume(message, requestTimeout, io = null) {
        this.$logger.debug('Consume.consume: ' + this.name);
        this.$logger.debug('- message.code: ' + message.code);        
        this.$logger.debug('- consume.processing_request_count: ' + this.processing_request_count);
        this.$logger.debug('- consume.qos: ' + this.qos);
        if (this.processing_request_count < this.qos
            && message.data
            && message.data.url
            && message.data.method
        ) {
            this.processing_request_count++;
            let self = this;
            let requestConfig = this.buildRequestConfig(message, requestTimeout, io);
            requestConfig.maxContentLength = Infinity;
            requestConfig.maxBodyLength = Infinity;
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
                    self.$logger.error('Consume Function: ' + error.message, requestConfig);
                    if (error.code === 'ECONNABORTED') {
                        message.status = 'FAILED';
                    } else {
                        message.status = 'WAITING';
                    }

                    self.processing_request_count--;
                    if (message.last_processing_at > message.first_processing_at) {
                        message.retry_count++;
                        message.delay_to = Date.now() + Math.pow(self.$config.get("consumers.retryTime"), message.retry_count) * 1000;
                    }
                    message.last_consumer = self.name;

                    self.$event.fire('consumer::response', {
                        message,
                        consumer: self,
                        response: {
                            status: error.response ? error.response.status : 504, // 504 - timeout in proxy
                            data: error.response ? error.response.data : { status: 'failed', message: error.message }
                        },
                        status: 'error',
                        errorCode: error.code
                    });
                });
        } else {
            this.$logger.debug('Consume.consume - QOS ERROR ' + this.name);
            this.$logger.debug('- message.code: ' + message.code);        
            this.$logger.debug('- consume.processing_request_count: ' + this.processing_request_count);
            this.$logger.debug('- consume.qos: ' + this.qos);
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
            method: this.method != null && ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'].indexOf(this.method) >= 0 ? this.method : message.data.method,
            url: this.buildRequestOrigin(message) + message.data.url,
            timeout: requestTimeout * 1000
        };

        let data = null;
        if (message.data.payload
            && Object.keys(message.data.payload).length !== 0
            && Object.getPrototypeOf(message.data.payload) === Object.prototype) {            
            if (message.data.payload["form-data"] != null) {
                data = Buffer.from(message.data.payload["form-data"], 'base64').toString('utf-8');
            } else {
                data = message.data.payload;
            }
        }
        retVal.data = data;

        let headers = {};
        if (message.data.headers) {
            headers = Object.assign({}, message.data.headers);
        }
        if (self.origin) {
            headers["host"] = urlPackage.parse(self.origin).host;
        }
        retVal.headers = headers;

        return retVal;
    }

    /**
     * Build Request Origin using Regex Group
     * For example:
     * - path: /api/([A-Za-z]{2})/order => /api/us/order
     * - orgin: $1.api.com => us.api.com
     * @param {*} message
     * @returns {String}
     */
    buildRequestOrigin(message) {
        var retVal = this.origin;
        if (retVal.indexOf("$") >= 0) {
            for (let index = 0; index < this.paths.length; index++) {
                const path = this.paths[index];
                let regex = new RegExp(path);
                let matches = message.data.url.match(regex);
                if (matches != null) {
                    for (let index = 1; index < matches.length; index++) {
                        retVal = retVal.replace("$" + index, matches[index]);
                    }
                    break;
                }
            }
        }
        return retVal;
    }
}

module.exports = Consumer;
