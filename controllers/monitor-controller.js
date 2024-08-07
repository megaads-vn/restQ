module.exports = MonitorController;
const moment = require('moment');
const knex = require('knex');

function MonitorController($event, $config, $queueServer) {
    const dbConnection = knex($config.get("database"));
    var summaryDays = 7;
    this.index = async function (io) {
        var summaryData = [];
        var consumers = $config.get("consumers.consumers");
        let summaryDateLabels = [];
        for (let i = 0; i < summaryDays; i++) {
            const date = moment().subtract(i, 'days').format('YYYY-MM-DD');
            summaryDateLabels.push(date);
        }
        for (let index = 0; index < consumers.length; index++) {
            let consumerSummaryData = {
                name: consumers[index].name,
                labels: summaryDateLabels,
                data: []
            };
            const consumer = consumers[index];
            const waitingSummary = await summaryMessages(consumer.name, "WAITING", summaryDays);
            const failedSummary = await summaryMessages(consumer.name, "FAILED", summaryDays);
            let waitingSummaryByDate = {
                name: "WAITING",
                data: []
            }
            let failedSummaryByDate = {
                name: "FAILED",
                data: []
            };
            summaryDateLabels.forEach(date => {
                const waiting = waitingSummary.find(row => row.date === date);
                waitingSummaryByDate.data.push(waiting ? waiting.count : 0);
                const failed = failedSummary.find(row => row.date === date);
                failedSummaryByDate.data.push(failed ? failed.count : 0);
            });
            consumerSummaryData.data.push(waitingSummaryByDate);
            consumerSummaryData.data.push(failedSummaryByDate);
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
}
