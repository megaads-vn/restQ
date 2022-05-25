var config = require(__dir + "/core/app/config");
var routerLoader = require(__dir + "/core/loader/route-loader");
var event = require(__dir + "/core/app/event");
var logger = (require(__dir + "/core/log/logger-factory")).getLogger();
var messageManager = require(__dir + "/managers/message-manager");
var consumerManager = require(__dir + "/managers/consumer-manager");
var producerManager = require(__dir + "/managers/producer-manager");
var queueServer = new (require(__dir + "/queue-server/queue-server"))(event, config, producerManager, messageManager, consumerManager);

module.exports = function ($serviceContainer) {
    $serviceContainer.bind("$config", config);
    $serviceContainer.bind("$route", routerLoader);
    $serviceContainer.bind("$event", event);
    $serviceContainer.bind("$logger", logger);
    $serviceContainer.bind("$messageManager", messageManager);
    $serviceContainer.bind("$consumerManager", consumerManager);
    $serviceContainer.bind("$producerManager", producerManager);
    $serviceContainer.bind("$queueServer", queueServer);
};
