const Message = require(__dir + "/objects/message");

class QueueServer {
    constructor($event) {
        let self = this;
        self.$event = $event;
        $event.listen('request::new', function (eventType, io) {
            self.publish(io);
        });
    }

    publish(io) { 
        let messageData = {
            url: io.request.url,
            method: io.request.method,
            payload: io.request.inputs
        };
        let callback_url = io.request.inputs.callback_url ?? null;
        let is_callback = io.request.inputs.is_callback ?? 0;
        let priority = io.request.inputs.priority ?? 0;
        delete messageData.payload._;
       
        let message = new Message(messageData, callback_url, is_callback, priority);

        this.$event.fire('message::publish', {io, message})
    }

    feedConsumerAMessage(consumer, message) {
        let now = Date.now();
        message.status = 'PROCESSING';
        message.last_processing_at = now;
        message.first_processing_at = message.first_processing_at ?? now;
        
        consumer.consume(message);
    }
}

module.exports = QueueServer;
