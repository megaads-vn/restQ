var config = require(__dir + "/core/app/config");
var routerLoader = require(__dir + "/core/loader/route-loader");
var event = require(__dir + "/core/app/event");
var logger = (require(__dir + "/core/log/logger-factory")).getLogger();
var messageManager = require(__dir + "/message-queue/message/message-manager");
var consumerManager = require(__dir + "/message-queue/consumer/consumer-manager");
var producerManager = require(__dir + "/message-queue/producer/producer-manager");
var consumerStatManager = require(__dir + "/message-queue/consumer-stat/consumer-stat-manager");
var queueServer = new (require(__dir + "/message-queue/message-queue-server"))(event, config, producerManager, messageManager, consumerManager, logger, consumerStatManager);

module.exports = function ($serviceContainer) {
    $serviceContainer.bind("$config", config);
    $serviceContainer.bind("$route", routerLoader);
    $serviceContainer.bind("$event", event);
    $serviceContainer.bind("$logger", logger);
    $serviceContainer.bind("$messageManager", messageManager);
    $serviceContainer.bind("$consumerManager", consumerManager);
    $serviceContainer.bind("$producerManager", producerManager);
    $serviceContainer.bind("$consumerStatManager", consumerStatManager);
    $serviceContainer.bind("$queueServer", queueServer);
};
