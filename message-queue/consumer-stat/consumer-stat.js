class ConsumerStat {
    constructor() {}

    static buildConsumerStatFromDatabaseRecord(data) {
        var consumerStat = new ConsumerStat();
        consumerStat.name = data.name ?? consumerStat.name;
        consumerStat.count = data.count ?? consumerStat.count;
        consumerStat.avg_time = data.avg_time ?? consumerStat.avg_time;

        return consumerStat;
    }
}

module.exports = ConsumerStat;