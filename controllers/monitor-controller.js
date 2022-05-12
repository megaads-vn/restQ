module.exports = MonitorController;

function MonitorController($event, $config, $queueServer) {
    this.stop = function (io) {
        io.json({
            status: $queueServer.stop(),
            is_running: $queueServer.isRunning
        });
    }
    this.start = function (io) {
        io.json({
            status: $queueServer.start(),
            is_running: $queueServer.isRunning
        });
    }
}
