const Producer = require("./producer");
const config = require(__dir + "/core/app/config");

class ProducerManager {
    constructor() {
        let self = this;
        self.producers = [];
        // A producer holds the whole io (request/response) while waiting for a response.
        // If the message never completes, drop the producer after a timeout so the io can be GC'd.
        self.responseTimeout = config.get("producers.responseTimeout", 600) * 1000;
        setInterval(function () {
            self.removeExpiredProducers();
        }, 60 * 1000);
    }

    getProducer(messageCode) {
        let retVal = null;

        this.producers.every(function (producer) {
            if (producer.messageCode == messageCode) {
                retVal = producer;
                return false;
            }
            return true;
        })

        return retVal;
    }

    async push(messageInfo) {
        let producer = new Producer(messageInfo.message.code, messageInfo.io);
        this.producers.push(producer);
    }

    removeProducer(messageCode) {
        let index = this.producers.findIndex(function (producer) {
            return producer.messageCode == messageCode;
        });
        if (index >= 0) {
            this.producers.splice(index, 1);
            return true;
        }
        return false;
    }

    removeExpiredProducers() {
        let now = Date.now();
        let self = this;
        this.producers = this.producers.filter(function (producer) {
            if (now - producer.createdAt < self.responseTimeout) {
                return true;
            }
            try {
                producer.io.status(504).json({
                    status: 'timeout',
                    result: {
                        message_code: producer.messageCode
                    }
                });
            } catch (error) { }
            return false;
        });
    }
}

module.exports = new ProducerManager();
