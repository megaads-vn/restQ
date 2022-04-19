const config = require(__dir + "/core/app/config"); 
const knex = require('knex')(config.get("database"));
const Message = require(__dir + "/objects/message");

class MessageManager {
    constructor($config) {
        this.retryTime = $config.get('consumers.retryTime');
        this.maxRetryCount = $config.get('consumers.maxRetryCount');
        let serverStartAt = Date.now();
        this.updateProcessingMessageAfterServerRestart(serverStartAt);
    }

    async push(message) {
        return knex('message').insert(message.serialize());
    }

    async getMessageBy(messageCondition = null) {
        let retVal = null;

        let query = knex('message');
        let messageRecord = await this.buildQueryByCondition(query, messageCondition).first();
        if (messageRecord) {
            messageRecord.status = 'PROCESSING';
            let now = Date.now();
            if (!messageRecord.first_processing_at) {
                messageRecord.first_processing_at = now;
            }
            messageRecord.last_processing_at = now;

            retVal = Message.buildMessageFromDatabaseRecord(messageRecord);
            await this.update(retVal);
        }

        return retVal;
    }

    buildQueryByCondition(query, messageCondition) {
        let retVal = query;

        let self = this;
        if (messageCondition) {
            if (messageCondition.code) {
                retVal = retVal.where('code', messageCondition.code);

            } else if (messageCondition.paths) {
                retVal = retVal.where('status', 'WAITING')
                    .where('retry_count', '<', self.maxRetryCount)
                    .whereRaw(`if ((? >= last_processing_at + retry_count * ? * 1000), 1, 0) = 1`, [
                        Date.now(),
                        self.retryTime
                    ])
                    .where(function() {
                        let self = this;
                        messageCondition.paths.forEach(path => {
                            self.orWhere('path', 'REGEXP', path);
                        });
                    })
                    .orderBy('priority', 'desc')
                    .orderBy('retry_count', 'asc');
            }
        } else {
            retVal = query.where('status', 'WAITING')
                .where('retry_count', '<', self.maxRetryCount)
                .whereRaw(`if ((? >= last_processing_at + retry_count * ? * 1000), 1, 0) = 1`, [
                    Date.now(),
                    self.retryTime
                ])
                .orderBy('priority', 'desc')
                .orderBy('retry_count', 'asc');
        }

        return retVal;
    }

    async update(message) {
        return knex('message').where('code', message.code).update(message.serialize());
    }

    updateProcessingMessageAfterServerRestart(serverStartAt) {
        knex('message')
            .where('status', 'PROCESSING')
            .where('last_processing_at', '<', serverStartAt)
            .update({
                status: 'FAILED'
            }).then()
            .catch(function (error) {
                console.log('updateProcessingMessageAfterServerRestart::error: ' + error.message);
            });
    }
}

module.exports = new MessageManager(config);
