module.exports = MessageController;

function MessageController($event) {
    this.onRequest = function (io) {
        $event.fire('request::new', io);
    }
}
