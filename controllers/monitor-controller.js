module.exports = MonitorController;
const moment = require('moment');
const knex = require('knex');
const utils = require(__dir + '/libs/utilities/utils');

function MonitorController($event, $config, $queueServer) {
    const dbConnection = knex($config.get("database"));

    this.index = async function (io) {
        var summaryData = [];
        var consumers = $config.get("consumers.consumers");
        for (let index = 0; index < consumers.length; index++) {
            let consumerSummaryData = {
                name: consumers[index].name,
            };
            summaryData.push(consumerSummaryData);
        }
        io.render("/monitor/index", {
            "summaryData": summaryData,
            "serverStatus": $queueServer.isRunning ? "Running" : "Paused",
            "authToken": $config.get("auth.token"),
        });
    }
    this.pause = function (io) {
        io.json({
            status: $queueServer.pause(),
            is_running: $queueServer.isRunning
        });
    }
    this.reload = async function (io) {
        io.json({
            status: await $queueServer.reload(),
            is_running: $queueServer.isRunning
        });
    }
    this.start = function (io) {
        io.json({
            status: $queueServer.start(),
            is_running: $queueServer.isRunning
        });
    }
    async function summaryMessages(consumerHash = "", days = 5) {
        var result = {};
        try {
            const rows = await dbConnection('message_stat')
                                .join('message', 'message_stat.id', 'message.id')
                                .select(dbConnection.raw("DATE(message.created_at_time) as date, COUNT(*) as count, message.status"))
                                .andWhere('message_stat.last_consumer_hash', consumerHash)
                                .whereIn('message.status', ['WAITING', 'PROCESSING', 'FAILED'])
                                .andWhere('message.created_at_time', '>=', moment().subtract(days, 'days').format('YYYY-MM-DD 00:00:00'))
                                .groupBy('message.status')
                                .groupBy('date');

            rows.forEach(msg => {
                const date = moment(msg.date).format('YYYY-MM-DD');
                if (!result[msg.status]) {
                    result[msg.status] = {};
                }
                if (!result[msg.status][date]) {
                    result[msg.status][date] = {
                        count: 0,
                        date: date
                    };
                }
                result[msg.status][date].count += Number(msg.count);
                
            });
        } catch (error) {
            console.error(error);
        }
        return result;
    }

    async function summaryRetryFailedMessages(consumerHash = "", days = 5) {
        var result = {};
        const maxRetryCount = $config.get("consumers.maxRetryCount", 2);
        try {
            const rows = await dbConnection('message_stat')
                                .join('message', 'message_stat.id', 'message.id')
                                .select(dbConnection.raw("DATE(message.created_at_time) as date, COUNT(*) as count"))
                                .andWhere('message_stat.last_consumer_hash', consumerHash)
                                .andWhere('message.retry_count', '>=', maxRetryCount)
                                .andWhere('created_at_time', '>=', moment().subtract(days, 'days').format('YYYY-MM-DD 00:00:00'))
                                .groupBy('date');

            rows.forEach(row => {
                const date = moment(row.date).format('YYYY-MM-DD');
                if (!result[date]) {
                    result[date] = {
                        count: 0,
                        date: date  
                    };
                }
                result[date].count += Number(row.count);
            });
        } catch (error) {
            console.error(error);
        }
        return result;
    }

    this.getConsumerData = async function (io) {
        var name = io.inputs.name;
        var summaryDays = 7;
        let summaryDateLabels = [];
        for (let i = 0; i < summaryDays; i++) {
            const date = moment().subtract(i, 'days').format('YYYY-MM-DD');
            summaryDateLabels.push(date);
        }
      
        let consumerSummaryData = {
            name: name,
            labels: summaryDateLabels,
            data: []
        };
        let lastConsumerHash = utils.crc32(name);
        const dataSummary = await summaryMessages(lastConsumerHash, summaryDays);
        const waitingSummary = dataSummary['WAITING'];
        const processingSummary = dataSummary['PROCESSING'];
        const failedSummary = dataSummary['FAILED'];
        const retryFailedSummary = await summaryRetryFailedMessages(lastConsumerHash, summaryDays);

        let waitingSummaryByDate = {
            name: "WAITING",
            data: []
        };
        let processingSummaryByDate = {
            name: "PROCESSING",
            data: []
        }
        let failedSummaryByDate = { 
            name: "FAILED",
            data: []
        };
        let retryFailedSummaryByDate = { 
            name: "RETRY_FAILED",
            data: []
        };
        summaryDateLabels.forEach(date => {
            waitingSummaryByDate.data.push(waitingSummary && waitingSummary[date] ? waitingSummary[date].count : 0);
            processingSummaryByDate.data.push(processingSummary && processingSummary[date] ? processingSummary[date].count : 0);
            failedSummaryByDate.data.push(failedSummary && failedSummary[date] ? failedSummary[date].count : 0);  
            retryFailedSummaryByDate.data.push(retryFailedSummary && retryFailedSummary[date] ? retryFailedSummary[date].count : 0);             
        });
        consumerSummaryData.data.push(waitingSummaryByDate);
        consumerSummaryData.data.push(processingSummaryByDate);
        consumerSummaryData.data.push(failedSummaryByDate);
        consumerSummaryData.data.push(retryFailedSummaryByDate);

        const consumerStat = await getConsumerStat(name);
        const response = {
            status: 'successful',
            result: {
                consumerSummaryData,
                consumerStat
            }
        }

        io.json(response);
    }

    async function getConsumerStat(name) {
        try {
            const row = await dbConnection('consumer_stat')
                .where('name', name)
                .select('*')
                .first();

            return row;
        } catch (error) {
            console.error(error);
            return {};
        }
    }
}
