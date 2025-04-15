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
    async function summaryMessages(consumer = "", status = "WAITING", days = 5) {
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

    async function getMinMaxIds(fromDate) {
        // 1. Lấy id nhỏ nhất theo created_at_time
        const [minResult] = await dbConnection('message')
            .select('id')
            .where('created_at_time', '>=', fromDate)
            .orderBy('created_at_time', 'asc')
            .limit(1);
    
        // 2. Lấy id lớn nhất
        const [maxResult] = await dbConnection('message')
            .select('id')
            .orderBy('id', 'desc')
            .limit(1);

        if (!minResult || !maxResult) {
            return { minId: 0, maxId: 0 };
        }
    
        return {
            minId: minResult.id,
            maxId: maxResult.id
        };
    }

    async function summaryMessagesNew(consumer = "", days = 5) {
        try {
            const { minId, maxId } = await getMinMaxIds(moment().subtract(days, 'days').format('YYYY-MM-DD 00:00:00'));
          
            if (minId === 0 || maxId === 0) {
                return {};
            }

            const result = {};
            let interval = 2000;
            for (let currentId = minId; currentId <= maxId; currentId += interval) {
                const endId = Math.min(currentId + interval - 1, maxId);
                const rows = await dbConnection('message')
                            .select(dbConnection.raw("DATE_FORMAT(created_at_time, '%Y-%m-%d') as date, count(*) as count, status"))
                            .whereIn('status', ['WAITING', 'PROCESSING', 'FAILED'])
                            .andWhere('last_consumer', consumer)
                            .andWhere('id', '>=', currentId)
                            .andWhere('id', '<=', endId)
                            .groupBy('status')
                            .groupByRaw("DATE_FORMAT(created_at_time, '%Y-%m-%d')");    
                rows.forEach(msg => {
                    const date = msg.date;
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
            }

            return result;
        } catch (error) {
            console.error('Error in summaryMessagesNew:', error);
            throw error;
        }
    }

    async function summaryRetryFailedMessages(consumer = "", days = 5) {
        const maxRetryCount = $config.get("consumers.maxRetryCount", 2);
        try {
            const rows = await dbConnection('message')
                .select(dbConnection.raw("DATE_FORMAT(created_at_time, '%Y-%m-%d') as date, count(*) as count"))
                .andWhere('retry_count', '>=', maxRetryCount)
                .andWhere('last_consumer', consumer)
                .andWhere('created_at_time', '>=', moment().subtract(days, 'days').format('YYYY-MM-DD 00:00:00'))
                .groupByRaw("DATE_FORMAT(created_at_time, '%Y-%m-%d')");

            return rows;
        } catch (error) {
            console.error(error);
            return [];
        }
    }

    async function summaryRetryFailedMessagesNew(consumer = "", days = 5) {
        const maxRetryCount = $config.get("consumers.maxRetryCount", 2);
        try {
            const { minId, maxId } = await getMinMaxIds(moment().subtract(days, 'days').format('YYYY-MM-DD 00:00:00'));
            if (minId === 0 || maxId === 0) {
                return {};
            }
            let interval = 2000;
            const result = {};
            for (let currentId = minId; currentId <= maxId; currentId += interval) {
                const endId = Math.min(currentId + interval - 1, maxId);
                const rows = await dbConnection('message')
                            .select(dbConnection.raw("DATE_FORMAT(created_at_time, '%Y-%m-%d') as date, count(*) as count"))
                            .andWhere('retry_count', '>=', maxRetryCount)
                            .andWhere('last_consumer', consumer)
                            .andWhere('id', '>=', currentId)
                            .andWhere('id', '<=', endId)
                            .groupByRaw("DATE_FORMAT(created_at_time, '%Y-%m-%d')");
             
                rows.forEach(row => {
                    const date = row.date;
                    if (!result[date]) {
                        result[date] = {
                            count: 0,
                            date: date  
                        };
                    }
                    result[date].count += Number(row.count);
                });
            }
            return result;
        } catch (error) {
            console.error(error);
            return [];
        }
    }

    const cache = {
        data: null,
        timestamp: 0,
        CACHE_DURATION: 15 * 60 * 1000  // 10 phút tính bằng milliseconds
    };
    
    // Hàm kiểm tra cache còn hạn không
    function isCacheValid() {
        return cache.data && (Date.now() - cache.timestamp < cache.CACHE_DURATION);
    }
    function setCache(data) {
        cache.data = data;
        cache.timestamp = Date.now();
    }

    this.getConsumerData = async function (io) {
        // if (isCacheValid() && io.inputs.clear_cache !== 1) {
        //     cache.data.from_cache = 1;
        //     io.json(cache.data);
        //     return;
        // }
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
        const dataSummary = await summaryMessagesNew(name, summaryDays);
        const waitingSummary = dataSummary['WAITING'];
        const processingSummary = dataSummary['PROCESSING'];
        const failedSummary = dataSummary['FAILED'];
        const retryFailedSummary = await summaryRetryFailedMessagesNew(name, summaryDays);
     
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

        setCache(response);
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
