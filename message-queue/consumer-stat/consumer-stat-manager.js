const config = require(__dir + "/core/app/config");
const knex = require('knex')(config.get("database"));
const ConsumerStat = require("./consumer-stat");

class ConsumerStatManager {
    constructor() {}

    async calculateAvgTime(message) {
        if (message.last_consumer && message.last_consumer != '') {
            knex.transaction (async (trx) => {
                try {
                    var consumerStatRecord = await knex('consumer_stat')
                        .where('name', message.last_consumer)
                        .select('*')
                        .forUpdate()
                        .first()
                        .transacting(trx);
                    if (consumerStatRecord) {
                        let consumerStat = ConsumerStat.buildConsumerStatFromDatabaseRecord(consumerStatRecord);
                        var processTime = message.last_processed_at - message.last_processing_at;
                        var newCount = consumerStat.count + 1;
                        var newAvgTime = (consumerStat.count * consumerStat.avg_time + processTime) / newCount;
                        var newConsumerStat = {
                            avg_time: newAvgTime,
                            count: newCount
                        };
    
                        await knex('consumer_stat')
                            .where('name', message.last_consumer)
                            .update(newConsumerStat)
                            .transacting(trx)
                    } else {
                        let newConsumerStat = {
                            name: message.last_consumer,
                            avg_time: message.last_processed_at - message.last_processing_at,
                            count: 1,
                        }
                        await knex('consumer_stat')
                            .insert(newConsumerStat)
                            .transacting(trx)
                    }

                    await trx.commit();
                } catch (error) {
                    await trx.rollback();
                    console.error('Transaction failed:', error);
                }                
            })
        }
    }
}

module.exports = new ConsumerStatManager(); 