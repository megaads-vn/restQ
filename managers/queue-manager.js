const configuration = require(__dir + '/config/database');   
const knex = require('knex')(configuration);
const Message = require(__dir + "/objects/message");

class QueueManager {
    constructor() {
        this.retryTimeGeometricProgression = 30; // 30s
    }

    push(message) {
        return knex('message').insert(message.serialize());
    }

    async pop() {
        let retVal = null;

        let retryTimeGeometricProgression = this.retryTimeGeometricProgression;
        let messageRecord = await knex('message')
            .where('status', 'WAITING')
            .where('retry_count', '<=', 5)
            .whereRaw(`if ((? >= last_processing_at + retry_count * ? * 1000), 1, 0) = 1`, [
                Date.now(),
                retryTimeGeometricProgression
            ])
            .orderBy('priority', 'desc')
            .orderBy('retry_count', 'asc')
            .first();

        if (messageRecord) {
            let message = new Message();
            retVal = message.buildMessage(messageRecord);
        }

        return retVal;
    }

    update(message) {
        return knex('message').where('code', message.code).update(message.serialize());
    }

    delete(messageCode) {
        return knex('message').where('code', messageCode).del();
    }

    count() {
        return knex('message').where('status', 'WAITING').count('id');
    }
}

module.exports = QueueManager;
