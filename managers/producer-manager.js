const Producer = require(__dir + "/objects/producer");

class ProducerManager {
    constructor() {
        let self = this;
        self.producers = [];
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

module.exports = new ProducerManager();
