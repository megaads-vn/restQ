const Producer = require(__dir + "/objects/producer");
const event = require(__dir + "/core/app/event");

class ProducerManager {
    constructor($event) {
        let self = this;

        self.producers = [];

        $event.listen('message::publish', function (eventType, messageInfo) {
            self.push(messageInfo);
        })
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
}

module.exports = new ProducerManager(event);
