const Message = require(__dir + "/objects/message");
const axios = require('axios');
var queueServerInstance = null;
class QueueServer {
    constructor($event, $config, $producerManager, $messageManager, $consumerManager) {
        this.isRunning = false;
        this.$event = $event;
        this.consumerMaxRetryCount = $config.get('consumers.maxRetryCount');
        this.$producerManager = $producerManager;
        this.$messageManager = $messageManager;
        this.$consumerManager = $consumerManager;
        queueServerInstance = this;
        this.interval = null;
        this.$event.listen('consumer::response', this.onConsumerResponse);
        this.start();
    }

    start() {
        if (!this.isRunning) {
            this.$consumerManager.loadConsumers();
            // interval
            let self = this;
            this.interval = setInterval(function () {
                self.handleIfAnyConsumerIsIdle();
            }, 5000);
            // message::publish        
            this.$event.listen('message::push', this.onNewMessage);
            // consumer
            this.$event.listen('consumer::done', this.onConsumerDone);
            this.isRunning = true;
            return true;
        }
        return false;
    }

    stop() {
        if (this.isRunning) {
            // handleIfAnyConsumerIsIdle Interval
            if (this.interval != null) {
                clearInterval(this.interval);
            }
            // message::publish
            this.$event.unlisten('message::push', this.onNewMessage);
            // consumer
            this.$event.unlisten('consumer::done', this.onConsumerDone);
            this.isRunning = false;
            return true;
        }
        return false;
    }


    reload() {
        this.stop();
        this.start();
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
        this.handleCallbackInRequestFromProducer(io, messageObject);

        messageObject.is_callback = io.inputs.is_callback;
        messageObject.postback_url = io.inputs.postback_url;
        await this.$producerManager.push({ io, message: messageObject })

        await this.$messageManager.push(messageObject);
        //TODO: should        
        this.$event.fire('message::push', messageObject);
    }

    async onConsumerResponse(eventType, data) {
        let self = queueServerInstance;
        await self.$messageManager.update(data.message);
        self.$event.fire('consumer::done', data.consumer)
        if (data.status == 'successful') {
            self.respond(data);
        } else if (data.status == 'error') {
            await self.$messageManager.update(data.message);
            if (data.errorCode === 'ECONNABORTED' || (data.errorCode !== 'ECONNABORTED' && data.message.retry_count >= self.consumerMaxRetryCount)) {
                self.respond(data);
            }
        }
    }

    onConsumerDone(eventType, consumer) {
        let self = queueServerInstance;
        self.$messageManager.getMessageBy({ paths: consumer.paths }, (consumer.qos - consumer.processing_request_count), function (messages) {
            for (let index = 0; index < messages.length; index++) {
                let msg = messages[index];
                let consumer = self.$consumerManager.getConsumer(msg);
                if (consumer) {
                    let producer = self.$producerManager.getProducer(msg.code);
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

    onNewMessage(eventType, messageObject) {
        let self = queueServerInstance;
        self.$messageManager.getMessageBy({ 'code': messageObject.code }, 1, function (messages) {
            if (messages.length == 1) {
                let msg = messages[0];
                let consumer = self.$consumerManager.getConsumer(msg);
                if (consumer) {
                    let producer = self.$producerManager.getProducer(msg.code);
                    self.feedConsumerAMessage(consumer, msg, producer.io);
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

    handleIfAnyConsumerIsIdle() {
        let self = this;
        let anyConsumerIsIdle = self.$consumerManager.havingAnyConsumerIsIdle();
        if (anyConsumerIsIdle && anyConsumerIsIdle.length > 0) {
            self.shuffleArray(anyConsumerIsIdle);
            for (let index = 0; index < anyConsumerIsIdle.length; index++) {
                const consumer = anyConsumerIsIdle[index];
                self.$messageManager.getMessageBy({ paths: consumer.paths }, (consumer.qos - consumer.processing_request_count), function (messages) {
                    for (let index = 0; index < messages.length; index++) {
                        let msg = messages[index];
                        let consumer = self.$consumerManager.getConsumer(msg);
                        if (consumer) {
                            let producer = self.$producerManager.getProducer(msg.code);
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
    }

    handleCallbackInRequestFromProducer(io, messageObject) {
        // default io.inputs.is_callback is 1
        if (typeof io.inputs.is_callback === 'undefined' || (io.inputs.is_callback && io.inputs.is_callback !== '0')) {
            // return
            if (io.inputs.postback_url) {
                // return to postback_url
                this.noWaitingAndRespondItself(io, messageObject);
            }
        } else {
            // no return
            this.noWaitingAndRespondItself(io, messageObject);
        }
    }

    noWaitingAndRespondItself(io, messageObject) {
        io.status(200).json({
            status: 'queued',
            result: {
                message_code: messageObject.code,
            }
        });
    }

    async feedConsumerAMessage(consumer, message, io) {
        consumer.consume(message, consumer.requestTimeout, io);
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
                    try {
                        producer.io.status(responseData.response.status).json(responseData.response.data);
                    } catch (error) {
                        console.log('Response::error: ' + error.message);
                    }
                }
            }
        }
    }
}

module.exports = QueueServer;
