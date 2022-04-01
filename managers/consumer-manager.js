const Consumer = require(__dir + "/objects/consumer");

class ConsumerManager {
    constructor() {
        this.consumers = [];
    }

    getConsumer(message) {
        let retVal = null;

        this.consumers.every(function (consumer) {
            if (consumer.processing_request_count < consumer.qos) {
                if (message.data.url[0] != '/') {
                    message.data.url = '/' + message.data.url;
                }
                let regex = new RegExp(consumer.path); 
                if (regex.test(message.data.url)) {
                    retVal = consumer;
                    return false;
                }
            }
            return true;
        })

        return retVal;
    }

    updateConsumer(consumer) {
        let retVal = 0;

        this.consumers.every(function (item, index) {
            if (item.code == consumer.code) {
                this.consumers[index] = consumer;
                retVal = 1;
                return false;
            }
            return true;
        });

        return retVal;
    }

    loadConsumer(consumerConfig) {
        let consumer = new Consumer();
        consumer.ip = consumerConfig.ip;
        consumer.port = consumerConfig.port;
        consumer.qos = consumerConfig.qos;
        consumer.path = consumerConfig.path;
        consumer.processing_request_count = consumerConfig.processing_request_count;
        
        this.consumers.push(consumer);
    }
}

module.exports = ConsumerManager;
