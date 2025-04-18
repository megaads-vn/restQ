const config = require(__dir + "/core/app/config");
const knex = require('knex')(config.get("database"));
const Message = require("./message");
var lock = new (require('async-lock'))({
    maxPending: 1000000,
    maxExecutionTime: 3000,
    maxOccupationTime: 10000
});
const PQueue = require('p-queue').default;
const queue = new PQueue({ concurrency: 10 });

const ConsumerQueueManager = require('./consumer-queue-manager');
const consumerQueueManager = new ConsumerQueueManager(knex);


class MessageManager {
    constructor() {
        this.retryTime = config.get('consumers.retryTime', 5);
        this.maxRetryCount = config.get('consumers.maxRetryCount', 5);
        let serverStartAt = Date.now();
        this.updateProcessingMessageAfterServerRestart(serverStartAt);
        // Remove done messages
        setInterval(async () => {
            let oneDayAgoTimestamp = (new Date()).setDate((new Date()).getDate() - 1);
            let result = await this.removeMessages([
                {
                    "key": "status",
                    "operator": "=",
                    "value": "DONE"
                },
                {
                    "key": "last_processed_at",
                    "operator": "<",
                    "value": oneDayAgoTimestamp
                }
            ]);
            console.log("removeMessages", result);
        }, 1 * 60 * 60 * 1000);
    }


    async push(message) {
        await queue.add(async () => {
            return await knex.transaction(async (trx) => {
                if (message.hash && message.hash !== '') {
                    const existingMessage = await trx('message')
                        .where('hash', message.hash)
                        .whereIn('status', ['WAITING', 'PROCESSING'])
                        .first();

                    if (existingMessage) {
                        message.status = 'DUPLICATED';
                        if (config.get("consumers.ignoreDuplicatedMessages", false)) {
                            return;
                        }
                    }
                }
                //@todo add to priority queue
                const item = await trx('message').insert(message.serialize())
                if (message.status !== 'DUPLICATED') {
                    this.pushToConsumerQueue(item[0], message);
                }
                
            });
        });
    }


    async getMessageBy(messageCondition = null, limit = 1, callbackFn = null) {
        var self = this;
        if (limit <= 0) {
            callbackFn([]);
        } else {
            lock.acquire("message-lock", async function (done) {
                let retVal = [];
                let query = knex.select(knex.raw("*")).from(knex.raw("message use index (" + config.get("database.message.index", "getMessage") + ")"));
                let messageRecords = await self.buildQueryByCondition(query, messageCondition).offset(0).limit(limit);
                for (let index = 0; index < messageRecords.length; index++) {
                    const messageRecord = messageRecords[index];
                    messageRecord.status = 'PROCESSING';
                    let now = Date.now();
                    if (!messageRecord.first_processing_at) {
                        messageRecord.first_processing_at = now;
                    }
                    messageRecord.last_processing_at = now;

                    let messageObj = Message.buildMessageFromDatabaseRecord(messageRecord);
                    await self.update(messageObj);
                    retVal.push(messageObj);
                }
                callbackFn(retVal);
                done();
            }, function () { });
        }
    }

    async getMessageByQueue(consumer, limit = 1, callbackFn = null) {
        var self = this;
        if (limit <= 0) {
            callbackFn([]);
        } else {
            let retVal = [];
            let messages = consumerQueueManager.getMessages(consumer, limit);
            for (let index = 0; index < messages.length; index++) {
                const message = messages[index];
                let messageRecord = await knex('message')
                .where('id', message.id)
                .where('status', 'WAITING')
                .where('retry_count', '<', self.maxRetryCount)
                .first();
                if (messageRecord) {
                    messageRecord.status = 'PROCESSING';
                    let now = Date.now();
                    if (!messageRecord.first_processing_at) {
                        messageRecord.first_processing_at = now;
                    }
                    messageRecord.last_processing_at = now;
                    let messageObj = Message.buildMessageFromDatabaseRecord(messageRecord);
                    await self.update(messageObj);
                    retVal.push(messageObj);
                }
              
            }
            callbackFn(retVal);
        }
    }
    /**
     * Remove messages by conditions
     * @param [{key, operator, value}] conditions
     * @returns Number of deleted messages
     */
    async removeMessages(conditions = []) {
        let query = knex('message');
        for (let index = 0; index < conditions.length; index++) {
            const condition = conditions[index];
            query.where(condition.key, condition.operator, condition.value);
        }
        return await query.del();
    }

    buildQueryByCondition(query, messageCondition) {
        let retVal = query;
        let self = this;
        if (messageCondition) {
            if (messageCondition.code) {
                retVal = retVal.where('code', messageCondition.code).where('status', 'WAITING');
            } else if (messageCondition.id){
                retVal = retVal.where('id', messageCondition.id).where('status', 'WAITING');
            } else if (messageCondition.paths) {
                retVal = retVal.where('status', 'WAITING')
                    .where('retry_count', '>=', 0)
                    .where('retry_count', '<', self.maxRetryCount)
                    // .whereRaw(`if ((? >= last_processing_at + retry_count * ? * 1000), 1, 0) = 1`, [
                    //     Date.now(),
                    //     self.retryTime
                    // ])
                    .where(function () {
                        let self = this;
                        messageCondition.paths.forEach(path => {
                            self.orWhere('path', 'REGEXP', path);
                        });
                    })
                // .orderBy('priority', 'desc')
                // .orderBy('retry_count', 'asc')
                //.orderBy('id', 'asc');
            } else if (messageCondition.last_consumer) {
                retVal = retVal.where('status', 'WAITING')
                    .where('retry_count', '>=', 0)
                    .where('retry_count', '<', self.maxRetryCount)
                    // .whereRaw(`if ((? >= last_processing_at + retry_count * ? * 1000), 1, 0) = 1`, [
                    //     Date.now(),
                    //     self.retryTime
                    // ])
                    .where('last_consumer', '=', messageCondition.last_consumer)
                // .orderBy('priority', 'desc')
                // .orderBy('retry_count', 'asc')
                //.orderBy('id', 'asc');
            }
            if (messageCondition.delay_to) {
                retVal = retVal.where('delay_to', '>=', 0)
                    .where('delay_to', '<=', messageCondition.delay_to);
            }
        } else {
            retVal = query.where('status', 'WAITING')
                .where('retry_count', '>=', 0)
                .where('retry_count', '<', self.maxRetryCount)
                .whereRaw(`if ((? >= last_processing_at + retry_count * ? * 1000), 1, 0) = 1`, [
                    Date.now(),
                    self.retryTime
                ])
                .orderBy('priority', 'desc')
                .orderBy('retry_count', 'asc')
                .orderBy('id', 'asc');
        }
        return retVal;
    }

    async update(message, ignoreData = true) {
        let updatedMessage = message.serialize();
        if (ignoreData) {
            delete updatedMessage.data;
        }
        return await knex('message').where('code', message.code).update(updatedMessage);
    }

    async removeMessage(message) {
        return await knex('message').where('code', message.code).del();
    }

    async updateProcessingMessageAfterServerRestart(serverStartAt) {
        try {
            await knex('message')
            .where('status', 'PROCESSING')
            .where('is_callback', '1')
            .whereNotNull('postback_url')
            .where('last_processing_at', '<', serverStartAt)
            .update({
                status: 'WAITING'
            });

            await knex('message')
            .where('status', 'PROCESSING')
            .where('last_processing_at', '<', serverStartAt)
            .update({
                status: 'FAILED'
            });
        } catch (error) {
            console.log('updateProcessingMessageAfterServerRestart::error: ' + error.message);
        }
    }

    async pushToConsumerQueue(id, message) {
        consumerQueueManager.setMessage(message.last_consumer, {
            id: id,
            delay_to: message.delay_to,
            last_consumer: message.last_consumer,
            retry_count: message.retry_count
        });
    }

    loadConsumerQueue(consummers) {
        consumerQueueManager.init(consummers);
    }
}

module.exports = new MessageManager();
