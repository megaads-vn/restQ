const Message = require(__dir + "/objects/message");
const axios = require('axios');
var queueServerInstance = null;
var config = null;
class QueueServer {
    constructor($event, $config, $producerManager, $messageManager, $consumerManager, $logger) {
        config = $config;
        this.isRunning = false;
        this.$event = $event;
        this.consumerMaxRetryCount = $config.get('consumers.maxRetryCount');
        this.$producerManager = $producerManager;
        this.$messageManager = $messageManager;
        this.$consumerManager = $consumerManager;
        this.$logger = $logger;
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
            }, 3000);
            // message::publish        
            // this.$event.listen('message::push', this.onNewMessage);
            // consumer
            this.$event.listen('consumer::done', this.onConsumerDone);
            this.isRunning = true;
            this.$logger.debug('QueueServer is started successfully.');
            return true;
        }
        return false;
    }

    pause() {
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
            this.$logger.debug('QueueServer is paused successfully.');
            return true;
        }
        return false;
    }

    async reload() {
        var retval = false;
        this.pause();
        this.$logger.debug('QueueServer is trying to reload...');
        return new Promise((resolve, reject) => {
            var tryReloadInterval = setInterval(() => {
                if (this.isRunning) {
                    clearInterval(tryReloadInterval);
                    resolve(retval);
                } else if (this.$consumerManager.isAllConsumersIdle()) {
                    clearInterval(tryReloadInterval);
                    this.start();
                    retval = true;
                    this.$logger.debug('QueueServer is reloaded successfully.');
                    resolve(retval);
                }
            }, 2000);
        });            
    }

    async publish(io) {
        let self = this;
        let messageObject = Message.buildMessageFromIO(io);
        let consumer = this.$consumerManager.getConsumer(messageObject, false);
        if (consumer) {
            messageObject.last_consumer = consumer.name;
            if (typeof io.inputs.is_callback === 'undefined' && typeof consumer.is_callback !== 'undefined') {
                io.inputs.is_callback = consumer.is_callback;
            }
            if (typeof io.inputs.postback_url === 'undefined' && typeof consumer.postback_url !== 'undefined') {
                io.inputs.postback_url = consumer.postback_url;
            }
        } else {
            // the messsage's not yet supported
            io.inputs.is_callback = 0;
        }
        let isWaitingAResponse = this.handleCallbackInRequestFromProducer(io, messageObject);

        messageObject.is_callback = io.inputs.is_callback;
        messageObject.postback_url = io.inputs.postback_url;

        if (isWaitingAResponse) {
            await this.$producerManager.push({ io, message: messageObject })
        }
        if (consumer != null || !config.get("consumers.ignoreNotSupportedMessages", true)) {
            await this.$messageManager.push(messageObject);
        }
        if (consumer != null) {
            this.$event.fire('message::push', messageObject);
        }
    }

    async onConsumerResponse(eventType, data) {
        let self = queueServerInstance;
        if (data.status == 'successful'
            && config.get("consumers.removeMessageAfterProcessing", false)) {
            await self.$messageManager.removeMessage(data.message);
        } else {
            await self.$messageManager.update(data.message);
        }
        self.$event.fire('consumer::done', data.consumer);
        if (data.status == 'successful') {
            self.respond(data);
        } else if (data.status == 'error') {
            if (data.errorCode === 'ECONNABORTED' || (data.errorCode !== 'ECONNABORTED' && data.message.retry_count >= self.consumerMaxRetryCount)) {
                self.respond(data);
            }
        }
    }

    onConsumerDone(eventType, consumer) {
        let self = queueServerInstance;
        self.$messageManager.getMessageBy({ "last_consumer": consumer.name, "delay_to": Date.now() }, (consumer.qos - consumer.processing_request_count), function (messages) {
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
        self.$messageManager.getMessageBy({ "code": messageObject.code, "delay_to": Date.now() }, 1, function (messages) {
            if (messages.length == 1) {
                let msg = messages[0];
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

    handleIfAnyConsumerIsIdle() {
        let self = this;
        let idleConsumers = self.$consumerManager.havingAnyConsumerIsIdle();
        if (idleConsumers && idleConsumers.length > 0) {
            self.shuffleArray(idleConsumers);
            idleConsumers.forEach(consumer => {
                this.$logger.debug('idleConsumer', consumer.name);
                self.$messageManager.getMessageBy({ last_consumer: consumer.name, "delay_to": Date.now() }, (consumer.qos - consumer.processing_request_count), function (messages) {
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
            });
        }
    }

    handleCallbackInRequestFromProducer(io, messageObject) {
        var isWaitingAResponse = true;
        if (messageObject.status.toLowerCase() === "duplicated") {
            this.noWaitingAndRespondItself(io, messageObject, "duplicated");
            isWaitingAResponse = false;
        } else {
            // default io.inputs.is_callback is 1
            if (typeof io.inputs.is_callback === 'undefined' || (io.inputs.is_callback && io.inputs.is_callback !== '0')) {
                // return
                if (io.inputs.postback_url) {
                    // return to postback_url
                    this.noWaitingAndRespondItself(io, messageObject);
                    isWaitingAResponse = false;
                }
            } else {
                // no return
                this.noWaitingAndRespondItself(io, messageObject);
                isWaitingAResponse = false;
            }
        }
        return isWaitingAResponse;
    }

    noWaitingAndRespondItself(io, messageObject, status = "queued") {
        io.status(200).json({
            "status": status,
            "result": {
                "message_code": messageObject.code,
            }
        });
    }

    async feedConsumerAMessage(consumer, message, io) {
        consumer.consume(message, consumer.requestTimeout, io);
    }

    respond(responseData) {
        // default responseData.message.is_callback is 1
        if (typeof responseData.message.is_callback === 'undefined' || responseData.message.is_callback) {
            // return 
            if (responseData.message.postback_url) {
                // return to postback_url
                axios({
                    method: 'POST',
                    url: responseData.message.postback_url,
                    data: {
                        request: {},
                        result: responseData.response.data
                    }
                })
                    .then()
                    .catch(function (error) {
                        this.$logger.warning('Postback::error: ' + responseData.message.code + " - " + error.message);
                    });
            } else {
                // return to itself
                let producer = this.$producerManager.getProducer(responseData.message.code);
                if (producer) {
                    try {
                        producer.io.status(responseData.response.status).json(responseData.response.data);
                    } catch (error) {
                        this.$logger.warning('Response::error: ' + error.message);
                    }
                }
            }
        }
    }

    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }
}

module.exports = QueueServer;
