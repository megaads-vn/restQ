module.exports = MessageController;

function MessageController($event) {
    this.onRequest = function (io) {
        $event.fire('request::new', io);

        // default io.inputs.is_callback is 1
        if (typeof io.inputs.is_callback === 'undefined' || io.inputs.is_callback) {
            // return
            if (!io.inputs.postback_url) {
                // return to itself
                noWaitingAndRespondItself(io);
            }
        } else {
            // no return
            noWaitingAndRespondItself(io);
        }
    }

    noWaitingAndRespondItself = function (io) {
        io.status(200).json({
            status: 'successful',
            message: 'queued'
        });
    }
}
