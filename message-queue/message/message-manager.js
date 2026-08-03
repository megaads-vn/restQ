const config = require(__dir + "/core/app/config");
const knex = require('knex')(config.get("database"));
const Message = require("./message");
const messageStore = require("./message-store");
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
        // Orphan file sweeper. Registered here (constructor of a singleton) rather
        // than in MQServer.start(), which reload()/hardRestart() call again and would
        // therefore stack up duplicate intervals.
        this.startOrphanSweeper();
    }

    startOrphanSweeper() {
        // On by default, like the store itself. Only an explicit `enabled: false` in
        // config/message-store.js turns it off.
        const sweeper = config.get("message-store.sweeper", {}) || {};
        if (sweeper.enabled === false) {
            return;
        }
        const intervalMinutes = sweeper.intervalMinutes != null ? sweeper.intervalMinutes : 360;
        const dryRun = sweeper.dryRun === true;
        const run = async () => {
            try {
                const result = await messageStore.sweepOrphans(
                    (codes) => this.getExistingMessageCodes(codes),
                    {
                        dryRun: dryRun,
                        minAgeHours: sweeper.minAgeHours != null ? sweeper.minAgeHours : 48
                    }
                );
                console.log("sweepOrphans", (dryRun ? "(dry-run) " : "") + JSON.stringify(result));
            } catch (error) {
                console.log('sweepOrphans::error: ' + error.message);
            }
        };
        setInterval(run, intervalMinutes * 60 * 1000);
    }

    async getExistingMessageCodes(codes) {
        const rows = await knex('message').select('code').whereIn('code', codes);
        return new Set(rows.map(row => row.code));
    }


    async push(message) {
        return await queue.add(async () => {
            // Written before (not inside) the transaction so the DB connection is not
            // held during gzip + fs. The two non-insert exits below unlink it again.
            let writtenPath = null;
            if (message.data != null) {
                // No fallback: the `message` table has no `data` column any more, so a
                // failed write means the payload has nowhere to live. Fail the publish
                // loudly instead of storing a message that can never be consumed.
                writtenPath = await messageStore.write(message);
                message.data_path = writtenPath;
            }
            let inserted = false;
            try {
                const id = await knex.transaction(async (trx) => {
                    if (message.hash && message.hash !== '') {
                        const existingMessage = await trx('message')
                            .select('id')
                            .where('hash', message.hash)
                            .whereIn('status', ['WAITING', 'PROCESSING'])
                            .first();

                        if (existingMessage) {
                            message.status = 'DUPLICATED';
                            if (config.get("consumers.ignoreDuplicatedMessages", false)) {
                                message.id = existingMessage.id;
                                return existingMessage.id;
                            }
                        }
                    }
                    //@todo add to priority queue
                    const item = await trx('message').insert(message.serialize())
                    inserted = true;
                    message.id = item[0];
                    if (message.status !== 'DUPLICATED') {
                        this.pushToConsumerQueue(item[0], message);
                    }
                    return item[0];
                });
                if (!inserted && writtenPath) {
                    // ignoreDuplicatedMessages returned early, no row owns this file
                    message.data_path = null;
                    await messageStore.remove(writtenPath).catch(() => { });
                }
                return id;
            } catch (error) {
                if (writtenPath) {
                    // insert threw or the transaction rolled back
                    message.data_path = null;
                    await messageStore.remove(writtenPath).catch(() => { });
                }
                throw error;
            }
        });
    }

    /**
     * Build a Message from a DB row, reading the payload back from disk when the row
     * is file-backed. Throws if the file is missing or corrupt.
     */
    async hydrateMessage(messageRecord) {
        let messageObj = Message.buildMessageFromDatabaseRecord(messageRecord);
        if (messageObj.data == null && messageRecord.data_path) {
            messageObj.data = await messageStore.read(messageRecord.data_path);
        }
        return messageObj;
    }

    /**
     * A message whose payload cannot be read can never be consumed: consumer.consume()
     * would drop it into the QOS branch and requeue it as WAITING forever. Fail it.
     */
    async failUnreadableMessage(messageRecord, error) {
        console.log('MessageStore::read error: ' + messageRecord.code + ' - ' + error.message);
        try {
            await knex('message').where('id', messageRecord.id).update({
                status: 'FAILED',
                last_processed_at: Date.now()
            });
        } catch (updateError) {
            console.log('failUnreadableMessage::error: ' + updateError.message);
        }
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
                    let messageObj;
                    try {
                        messageObj = await self.hydrateMessage(messageRecord);
                    } catch (error) {
                        await self.failUnreadableMessage(messageRecord, error);
                        continue;
                    }
                    messageObj.status = 'PROCESSING';
                    let now = Date.now();
                    if (!messageObj.first_processing_at) {
                        messageObj.first_processing_at = now;
                    }
                    messageObj.last_processing_at = now;

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
                    let messageObj;
                    try {
                        messageObj = await self.hydrateMessage(messageRecord);
                    } catch (error) {
                        await self.failUnreadableMessage(messageRecord, error);
                        continue;
                    }
                    messageObj.status = 'PROCESSING';
                    let now = Date.now();
                    if (!messageObj.first_processing_at) {
                        messageObj.first_processing_at = now;
                    }
                    messageObj.last_processing_at = now;
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
        // Batched so the payload files of the deleted rows can be removed too, and so
        // a large backlog is not deleted under one long lock (the message_stat delete
        // trigger fires per row).
        const batchSize = config.get("message-store.deleteBatchSize", 1000);
        let total = 0;
        for (; ;) {
            let selectQuery = knex('message').select('id', 'data_path');
            for (let index = 0; index < conditions.length; index++) {
                const condition = conditions[index];
                selectQuery.where(condition.key, condition.operator, condition.value);
            }
            const rows = await selectQuery.limit(batchSize);
            if (rows.length === 0) {
                break;
            }
            const deleted = await knex('message').whereIn('id', rows.map(row => row.id)).del();
            total += deleted;
            if (deleted === 0) {
                // nothing could be deleted although rows still match: stop instead of
                // spinning forever inside the hourly purge
                console.log('removeMessages: no rows deleted for a matching batch, aborting');
                break;
            }
            for (let index = 0; index < rows.length; index++) {
                const dataPath = rows[index].data_path;
                if (!dataPath) {
                    continue;
                }
                try {
                    await messageStore.remove(dataPath);
                } catch (error) {
                    console.log('MessageStore::remove error: ' + dataPath + ' - ' + error.message);
                }
            }
            if (rows.length < batchSize) {
                break;
            }
        }
        return total;
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
            // written once at insert, never rewritten
            delete updatedMessage.data_path;
        }
        return await knex('message').where('code', message.code).update(updatedMessage);
    }

    /**
     * Row first, file second. A crash in between leaves an orphan file (the sweeper
     * cleans those up); the opposite order would leave a row pointing at a missing
     * file, which is unrecoverable and kills the message.
     * message.data is deliberately left intact - respond() still needs it to build
     * the postback body after this returns.
     */
    async removeMessage(message) {
        const result = await knex('message').where('code', message.code).del();
        if (message.data_path) {
            try {
                await messageStore.remove(message.data_path);
            } catch (error) {
                console.log('MessageStore::remove error: ' + message.code + ' - ' + error.message);
            }
        }
        return result;
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
        // Only registered consumers (qos > 0) are drained by the scheduler.
        // Skip the rest (e.g. qos <= 0) so their messages don't pile up in an
        // in-memory queue that is never consumed.
        if (!consumerQueueManager.hasConsumer(message.last_consumer)) {
            return;
        }
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
