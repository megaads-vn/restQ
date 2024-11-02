module.exports = MonitorController;
const moment = require('moment');
const knex = require('knex');

function MonitorController($event, $config, $queueServer) {
    const dbConnection = knex($config.get("database"));
    var summaryDays = 7;
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
    async function summaryMessages(consumer = "", status = "WAITING", days = 7) {
        try {
            const rows = await dbConnection('message')
                .select(dbConnection.raw("DATE_FORMAT(created_at_time, '%Y-%m-%d') as date, count(*) as count"))
                .where('status', status)
                .andWhere('last_consumer', consumer)
                .andWhere('created_at_time', '>=', moment().subtract(days, 'days').format('YYYY-MM-DD 00:00:00'))
                .groupByRaw("DATE_FORMAT(created_at_time, '%Y-%m-%d')");

            return rows;
        } catch (error) {
            console.error(error);
            return [];
        }
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
        const waitingSummary = await summaryMessages(name, "WAITING", summaryDays);
        const processingSummary = await summaryMessages(name, "PROCESSING", summaryDays);
        const failedSummary = await summaryMessages(name, "FAILED", summaryDays);
        let waitingSummaryByDate = {
            name: "WAITING",
            data: []
        }
        let processingSummaryByDate = {
            name: "PROCESSING",
            data: []
        }
        let failedSummaryByDate = { 
            name: "FAILED",
            data: []
        };
        summaryDateLabels.forEach(date => {
            const waiting = waitingSummary.find(row => row.date === date);
            waitingSummaryByDate.data.push(waiting ? waiting.count : 0);
            const processing = processingSummary.find(row => row.date === date);
            processingSummaryByDate.data.push(processing ? processing.count : 0);
            const failed = failedSummary.find(row => row.date === date);
            failedSummaryByDate.data.push(failed ? failed.count : 0);                
        });
        consumerSummaryData.data.push(waitingSummaryByDate);
        consumerSummaryData.data.push(processingSummaryByDate);
        consumerSummaryData.data.push(failedSummaryByDate);

        io.json({
            status: 'successful',
            result: consumerSummaryData
        });
    }
}
