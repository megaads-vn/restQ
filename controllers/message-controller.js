module.exports = MessageController;

function MessageController($config, $event, $logger) {
    this.onRequest = function (io) {
        $event.fire('request::new', io);
    }
}
