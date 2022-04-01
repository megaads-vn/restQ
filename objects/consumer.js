const ConsumerInterface = require(__dir + "/interfaces/consumer-interface");
const axios = require('axios');

class Consumer extends ConsumerInterface {
    constructor(port, ip, qos, path, $event) {
        super();
        this.code = Consumer.generateConsumerCode;
        this.port = port;
        this.ip = ip;
        this.qos = qos;
        this.path = path;
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

    async consume(message) {
        if (message.data && message.data.url && message.data.method) {
            this.processing_request_count++;
            let self = this;

            axios({
                method: message.data.method,
                url: message.data.url,
                data: message.data.payload ?? null
            }).then(function (response) {
                self.processing_request_count--;
                if (response.status == 200) {
                    message.status = 'DONE';
                    message.last_processed_at = Date.now();
                    self.$event.fire('consumer::done::successful', message);
                } else {
                    message.status = 'WAITING';
                    self.$event.fire('consumer::done::failed', message);
                }
            }).catch(function (error) {
                self.processing_request_count--;
                message.status = 'WAITING';
                self.$event.fire('consumer::done::failed', message);
            });
        }
    }
}

module.exports = Consumer;
