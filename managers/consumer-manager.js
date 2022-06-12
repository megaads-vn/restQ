const Consumer = require(__dir + "/objects/consumer");
const config = require(__dir + "/core/app/config"); 
const event = require(__dir + "/core/app/event");
const logger = (require(__dir + "/core/log/logger-factory")).getLogger();

class ConsumerManager {
    constructor($config, $event, $logger) {
        this.consumers = [];
        this.$config = $config;
        this.$event = $event;
        this.$logger = $logger;
    }

    getConsumer(message, isIdle = true) {
        let retVal = null;
        let self = this;

        if (message!= null && message.data) {
            for (let index = 0; index < this.consumers.length; index++) {
                const consumer = this.consumers[index];
                if (isIdle) {
                    if (consumer.processing_request_count < consumer.qos) {
                        let havingAnyValidConsumer = self.executeGettingConsumer(message, consumer);
                        if (havingAnyValidConsumer) {
                            retVal = havingAnyValidConsumer;
                            break;
                        }
                    }
                } else {
                    let havingAnyValidConsumer = self.executeGettingConsumer(message, consumer);
                    if (havingAnyValidConsumer) {
                        retVal = havingAnyValidConsumer;
                        break;
                    }
                }
            }
        }

        return retVal;
    }

    executeGettingConsumer(message, consumer) {
        if (message.data.url[0] != '/') {
            message.data.url = '/' + message.data.url;
        }
        let havingAnyValidConsumer = false;
        consumer.paths.forEach(path => {
            let regex = new RegExp(path); 
            if (regex.test(message.data.url)) {
                havingAnyValidConsumer = consumer;
            }
        });

        return havingAnyValidConsumer;
    }

    updateConsumer(consumer) {
        let retVal = 0;

        let self = this;
        this.consumers.every(function (item, index) {
            if (item.code == consumer.code) {
                self.consumers[index] = consumer;
                retVal = 1;
                return false;
            }
            return true;
        });

        return retVal;
    }

    loadConsumers() {
        let self = this;
        self.consumers = [];

        let configConsumers = self.$config.get("consumers.consumers");
        configConsumers.forEach(item => {
            let consumer = new Consumer(self.$config, self.$event, self.$logger);
            consumer.origin = item.origin;
            consumer.name = item.name;
            consumer.qos = item.qos;
            consumer.paths = item.paths;
            consumer.requestTimeout = item.requestTimeout ? item.requestTimeout : consumer.requestTimeout
            consumer.is_callback = item.is_callback;
            consumer.postback_url = item.postback_url;
            
            self.consumers.push(consumer);
        });
    }

    havingAnyConsumerIsIdle() {
        let retVal = [];
        for (let index = 0; index < this.consumers.length; index++) {
            const consumer = this.consumers[index];
            if (consumer.processing_request_count < consumer.qos) {
                retVal.push(consumer);
            }
        }
        return retVal.length > 0 ? retVal : false;
    }
}


module.exports = new ConsumerManager(config, event, logger);
