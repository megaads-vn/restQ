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
            self.$messageManager.getMessageBy({paths: anyConsumerIsIdle.paths}, function (msg) {    
                if (msg) {
                    let consumer = self.$consumerManager.getConsumer(msg);
                    let producer = self.$producerManager.getProducer(msg.code);
                    if (consumer) {
                        self.feedConsumerAMessage(consumer, msg, producer ? producer.io : null);
                    } else {
                        if (msg.retry_count == 0) {
                            msg.first_processing_at = 0;
                            msg.last_processing_at = 0;
                        }                         
                        msg.status = 'WAITING';
                        self.$messageManager.update(msg);
                    }
                }
            });
        }
    }

    async publish(io) {
        let self = this;
        let messageObject = Message.buildMessageFromIO(io);

        let consumer = this.$consumerManager.getConsumer(messageObject, false);
        if (consumer) {
            if (typeof io.inputs.is_callback === 'undefined' && typeof consumer.is_callback !== 'undefined') {
                io.inputs.is_callback = consumer.is_callback;
            }
            if (typeof io.inputs.postback_url === 'undefined' && typeof consumer.postback_url !== 'undefined') {
                io.inputs.postback_url = consumer.postback_url;
            }
        }
        this.handleCallbackInRequestFromProducer(io);

        messageObject.is_callback = io.inputs.is_callback;
        messageObject.postback_url = io.inputs.postback_url;
        await this.$producerManager.push({io, message: messageObject})

        await this.$messageManager.push(messageObject);
            self.$messageManager.getMessageBy({code: messageObject.code}, function(msg) {
                if (msg != null) {
                    consumer = self.$consumerManager.getConsumer(msg);
                    if (consumer) {
                        self.feedConsumerAMessage(consumer, msg, io);
                    } else {
                        if (msg.retry_count == 0) {
                            msg.first_processing_at = 0;
                            msg.last_processing_at = 0;
                        } 
                        msg.status = 'WAITING';                            
                        self.$messageManager.update(msg);
                    }
                }       
            });
    }

    handleCallbackInRequestFromProducer(io) {
        // default io.inputs.is_callback is 1
        if (typeof io.inputs.is_callback === 'undefined' || (io.inputs.is_callback && io.inputs.is_callback !== '0')) {
            // return
            if (io.inputs.postback_url) {
                // return to postback_url
                this.noWaitingAndRespondItself(io);
            }
        } else {
            // no return
            this.noWaitingAndRespondItself(io);
        }
    }

    noWaitingAndRespondItself(io) {
        io.status(200).json({
            status: 'successful',
            message: 'queued'
        });
    }

    async feedConsumerAMessage(consumer, message, io) {
        consumer.consume(message, consumer.requestTimeout, io);
    }

    async handleResponseFromConsumer(data) {
        await this.$messageManager.update(data.message);
        let self = this;
        let consumer = data.consumer;
            self.$messageManager.getMessageBy({paths: consumer.paths}, function (message) {
                if (message != null) {
                    let producer = self.$producerManager.getProducer(message.code);
                    self.feedConsumerAMessage(consumer, message, producer ? producer.io : null);
                }
            });    
        if (data.status == 'successful') {
            this.respond(data);
        } else if (data.status == 'error') {
            await this.$messageManager.update(data.message);
            if (data.errorCode === 'ECONNABORTED' || (data.errorCode !== 'ECONNABORTED' && data.message.retry_count >= this.consumerMaxRetryCount)) {
                this.respond(data);
            }
        }
    }

    respond(responseData) {
        let producer = this.$producerManager.getProducer(responseData.message.code);
        if (producer) {

            // default responseData.message.is_callback is 1
            if (typeof responseData.message.is_callback === 'undefined' || responseData.message.is_callback) {
                // return 
                if (responseData.message.postback_url) {
                    // return to postback_url
                    axios({
                        method: 'POST',
                        url: responseData.message.postback_url,
                        data: responseData.response.data
                    })
                    .then()
                    .catch(function (error) {
                        console.log('Postback::error: ' + error.message);
                    });
                } else {
                    // return to itself
                    producer.io.status(responseData.response.status).json(responseData.response.data);
                }
            }
        }
    }
}

module.exports = QueueServer;
