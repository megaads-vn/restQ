module.exports = MessageController;

function MessageController($event, $config, $queueServer, $messageManager) {
    const knex = require('knex')($config.get("database"));
    const messageStore = require(__dir + "/message-queue/message/message-store");

    this.onRequest = function (io) {
        $queueServer.publish(io);
    }
    this.get = async function (io) {
        let message = null;
        if (io.inputs.code) {
            message = await knex('message').where('code', io.inputs.code).first();
        }
        if (message && message.data == null && message.data_path) {
            // keep `data` a JSON string so the response shape matches pre-file rows
            try {
                message.data = JSON.stringify(await messageStore.read(message.data_path));
            } catch (error) {
                message.data = null;
            }
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
