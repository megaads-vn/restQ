const Message = require(__dir + "/objects/message");
const axios = require('axios');

class QueueServer {
    constructor($event, $config, $producerManager, $messageManager, $consumerManager) {
        let self = this;

        self.$event = $event;
        self.consumerMaxRetryCount = $config.get('consumers.maxRetryCount');
        self.$producerManager = $producerManager;
        self.$messageManager = $messageManager;
        self.$consumerManager = $consumerManager;

        self.$consumerManager.loadConsumers();
        setInterval(function () {
            self.handleIfAnyConsumerIsIdle();
        }, 1000);

        $event.listen('request::new', function (eventType, io) {
            self.publish(io);
        });
        $event.listen('consumer::done', function (eventType, data) {
            self.handleResponseFromConsumer(data);
        });
    }

    handleIfAnyConsumerIsIdle() {
        let self = this;

        let anyConsumerIsIdle = self.$consumerManager.havingAnyConsumerIsIdle();
        if (anyConsumerIsIdle) {
            self.$messageManager.getMessageBy(null).then(function (message) {
                if (message) {
                    let consumer = self.$consumerManager.getConsumer(message);
                    let producer = self.$producerManager.getProducer(message.code);
                    if (consumer) {
                        self.feedConsumerAMessage(consumer, message, producer ? producer.io : null);
                    }
                }
            });
        }
    }

    async publish(io) {
        let messageObject = Message.buildMessageFromIO(io);
        await this.$producerManager.push({io, message: messageObject})

        await this.$messageManager.push(messageObject);
        let message = await this.$messageManager.getMessageBy({code: messageObject.code});
        
        let consumer = this.$consumerManager.getConsumer(message);

        if (consumer) {
            this.feedConsumerAMessage(consumer, message, io);
        } else {
            message.status = 'WAITING';
            await this.$messageManager.update(message);
        }
    }

    async feedConsumerAMessage(consumer, message, io) {
        consumer.consume(message, consumer.requestTimeout, io);
    }

    async handleResponseFromConsumer(data) {
        await this.$messageManager.update(data.message);

        let consumer = data.consumer;
        let message = await this.$messageManager.getMessageBy({paths: consumer.paths});
        if (message) {
            let producer = this.$producerManager.getProducer(message.code);
            this.feedConsumerAMessage(consumer, message, producer ? producer.io : null);
        }
        if (data.status == 'successful') {
            this.respond(data);
        } else if (data.status == 'error') {
            this.$messageManager.update(data.message);
            if (data.message.retry_count >= this.consumerMaxRetryCount) {
                this.respond(data);
            }
        }
    }

    respond(responseData) {
        let producer = this.$producerManager.getProducer(responseData.message.code);
        if (producer) {
            if (responseData.message.is_callback) {
                if (responseData.message.postback_url) {
                    axios({
                        method: 'POST',
                        url: responseData.message.postback_url,
                        data: responseData.response.data
                    }).then()
                    .catch(function (error) {
                        console.log('Postback::error: ' + error.message);
                    });
                    producer.io.status(responseData.response.status).json({message: 'done'});
                } else {
                    producer.io.status(responseData.response.status).json(responseData.response.data);
                }
            } else {
                producer.io.status(responseData.response.status).json({message: 'done'});
            }
        }
    }
}

module.exports = QueueServer;
