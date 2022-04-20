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

    getConsumer(message) {
        let retVal = null;

        if (message.data) {
            this.consumers.every(function (consumer) {
                if (consumer.processing_request_count < consumer.qos) {
                    if (message.data.url[0] != '/') {
                        message.data.url = '/' + message.data.url;
                    }
    
                    let havingAnyValidConsumer = false;
                    consumer.paths.forEach(path => {
                        let regex = new RegExp(path); 
                        if (regex.test(message.data.url)) {
                            retVal = consumer;
                            havingAnyValidConsumer = true;
                        }
                    });
                    if (havingAnyValidConsumer) {
                        return false;
                    }
                }
                return true;
            })
        }

        return retVal;
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
        let consumers = self.$config.get("consumers.consumers");

        consumers.forEach(item => {
            let consumer = new Consumer(self.$config, self.$event, self.$logger);
            consumer.origin = item.origin;
            consumer.qos = item.qos;
            consumer.paths = item.paths;
            consumer.requestTimeout = item.requestTimeout ? item.requestTimeout : consumer.requestTimeout

            self.consumers.push(consumer);
        });
    }

    havingAnyConsumerIsIdle() {
        let retVal = false;

        this.consumers.every(function (consumer) {
            if (consumer.processing_request_count < consumer.qos) {
                retVal = true;
                return false;
            }
            return true;
        })

        return retVal;
    }
}


module.exports = new ConsumerManager(config, event, logger);
