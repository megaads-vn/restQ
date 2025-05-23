const Message = require("./message/message");
const axios = require('axios');
var mqServerInstance = null;
var config = null;
class MQServer {
    constructor($event, $config, $producerManager, $messageManager, $consumerManager, $logger, $consumerStatManager) {
        config = $config;
        this.isRunning = false;
        this.$event = $event;
        this.consumerMaxRetryCount = $config.get('consumers.maxRetryCount', 2);
        this.$producerManager = $producerManager;
        this.$messageManager = $messageManager;
        this.$consumerManager = $consumerManager;
        this.$consumerStatManager = $consumerStatManager;
        this.$logger = $logger;
        mqServerInstance = this;
        this.interval = null;
        this.$event.listen('consumer::response', this.onConsumerResponse);
        this.start();
        $logger.info('===========================================================');
        $logger.info('Monitoring available at: /monitor?token=' + $config.get('auth.token'));
    }

    start() {
        if (!this.isRunning) {
            this.$consumerManager.loadConsumers();
            this.$messageManager.loadConsumerQueue(this.$consumerManager.getConsummers());
            // interval
            let self = this;
            this.interval = setInterval(function () {
                self.handleIfAnyConsumerIsIdle();
            }, 3000);
            // message::publish        
            // this.$event.listen('message::push', this.onNewMessage);
            // consumer
            this.$event.listen('consumer::released', this.onConsumerReleased);
            this.isRunning = true;
            this.$logger.debug('MQServer is started successfully.');
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
            this.$event.unlisten('consumer::released', this.onConsumerReleased);
            this.isRunning = false;
            this.$logger.debug('MQServer is paused successfully.');
            return true;
        }
        return false;
    }

    async reload() {
        var retval = false;
        let self = this;
        this.pause();
        this.$logger.debug('MQServer is trying to reload...');
        return new Promise((resolve, reject) => {
            var tryReloadInterval = setInterval(() => {
                if (self.isRunning) {
                    clearInterval(tryReloadInterval);
                    resolve(retval);
                } else if (self.$consumerManager.isAllConsumersIdle()) {
                    clearInterval(tryReloadInterval);
                    self.start();
                    retval = true;
                    self.$logger.debug('MQServer is reloaded successfully.');
                    resolve(retval);
                }
            }, 2000);
        });
    }

    hardRestart() {
        this.pause();        
        this.start();
        this.$logger.debug('MQServer is hard restarted successfully.');
        return true;
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
        let self = mqServerInstance;        
        if (data.status == 'successful'
            && config.get("consumers.removeMessageAfterProcessing", false)) {            
            await self.$messageManager.removeMessage(data.message);
        } else {
            //@todo
            if (data.message.retry_count < self.consumerMaxRetryCount && data.message.status !== 'FAILED') {
                await self.$messageManager.pushToConsumerQueue(data.message.id, data.message);
            }
            await self.$messageManager.update(data.message);
        }
        const waitPostbackCompleted = config.get("consumers.waitPostbackCompleted", false);        
        if (!waitPostbackCompleted) {
            self.$event.fire('consumer::released', data.consumer);
        }        
        if (data.status === 'successful') {
            if (config.get("consumers.statAvgProcessingTime", false) === true) {
            await self.$consumerStatManager.calculateAvgTime(data.message);
            }
            if (waitPostbackCompleted) {                
                await self.respond(data);
            } else {
                self.respond(data);
            }
        } else if (data.status === 'error') {
            if (data.errorCode === 'ECONNABORTED' || (data.errorCode !== 'ECONNABORTED' && data.message.retry_count >= self.consumerMaxRetryCount)) {
                if (waitPostbackCompleted) {                
                    await self.respond(data);
                } else {
                    self.respond(data);
                }
            }
        }
        if (waitPostbackCompleted) {
            self.$event.fire('consumer::released', data.consumer);
        }
    }

    onConsumerReleased(eventType, consumer) {
        let self = mqServerInstance;
        self.$messageManager.getMessageByQueue(consumer.name, (consumer.qos - consumer.processing_request_count), function (messages) {
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
                    self.$messageManager.pushToConsumerQueue(msg.id, msg);

                }
            }
        });
    }

    onNewMessage(eventType, messageObject) {
        let self = mqServerInstance;
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
                    self.$messageManager.pushToConsumerQueue(msg.id, msg);
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
                self.$messageManager.getMessageByQueue(consumer.name, (consumer.qos - consumer.processing_request_count), function (messages) {
                    if (messages.length > 0) {
                        self.$logger.debug("Idle consumer", consumer.name);
                        self.$logger.debug("-> Feeding '" + consumer.name + "' " + messages.length + " message(s).");
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
                                self.$messageManager.pushToConsumerQueue(msg.id, msg);
                            }
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

    async respond(responseData) {
        let self = this;
        // default responseData.message.is_callback is 1
        if (typeof responseData.message.is_callback === 'undefined' || responseData.message.is_callback) {
            if (responseData.message.postback_url) {
                // respond to postback_url
                let consumer = this.$consumerManager.getConsumer(responseData.message, false);
                let postBackRequestData = {};
                if (consumer != null
                    && (consumer.postback_include_request_data == null
                        || consumer.postback_include_request_data === true
                        || consumer.postback_include_request_data === 1)) {
                    postBackRequestData = responseData.message.data;
                }
                try {
                    await axios({
                        method: 'POST',
                        url: responseData.message.postback_url,
                        data: {
                            request: postBackRequestData,
                            result: responseData.response.data
                        }
                    });
                } catch (error) {
                    self.$logger.warning('Postback::error: ' + responseData.message.code + " - " + error.message);
                }
            } else {
                // respond to producer
                let producer = self.$producerManager.getProducer(responseData.message.code);
                if (producer) {
                    try {
                        await producer.io.status(responseData.response.status).json(responseData.response.data);
                    } catch (error) {
                        self.$logger.warning('Response::error: ' + error.message);
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

module.exports = MQServer;
