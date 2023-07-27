module.exports = MessageController;

function MessageController($event, $config, $queueServer, $messageManager) {
    const knex = require('knex')($config.get("database"));

    this.onRequest = function (io) {
        $queueServer.publish(io);
    }
    this.get = async function (io) {
        let message = null;
        if (io.inputs.code) {
            message = await knex('message').where('code', io.inputs.code).first();
        }
        return io.json({
            'status': 'success',
            'result': message == null ? null : message
        });
    }
    this.removeDoneMessages = async function (io) {
        let result = await $messageManager.removeMessages([{
            "key": "status",
            "operator": "=",
            "value": "DONE"
        }]);
        io.json({
            "status": "successful",
            "result": result
        });
    }
}
