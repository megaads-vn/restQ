const Producer = require(__dir + "/objects/producer");

class ProducerManager {
    constructor($event) {
        let self = this;
        self.producers = [];
        $event.listen('message::publish', function (eventType, messageInfo) {
            console.log(messageInfo);
            let producer = new Producer();
            self.producers.push(producer);
        })
    }

    getProducer(messageCode) {
        //
    }
}

module.exports = ProducerManager;
