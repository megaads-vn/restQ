module.exports = MessageController;

function MessageController($event, $config, $queueServer, $messageManager) {
    const knex = require('knex')($config.get("database"));
    const messageStore = require(__dir + "/message-queue/message/message-store");

    this.onRequest = function (io) {
        $queueServer.publish(io);
    }
    /**
     * Reads the payload of a row, from the `data` column for rows written before the
     * file store, or from its gzipped file otherwise.
     * @returns {payload, error} - payload is the parsed object, or null with a reason
     */
    async function readPayload(message) {
        if (message == null) {
            return { payload: null, error: null };
        }
        if (message.data != null) {
            try {
                return { payload: JSON.parse(message.data), error: null };
            } catch (error) {
                return { payload: null, error: 'Invalid JSON in data column: ' + error.message };
            }
        }
        if (!message.data_path) {
            return { payload: null, error: 'Message has no payload' };
        }
        try {
            return { payload: await messageStore.read(message.data_path), error: null };
        } catch (error) {
            return { payload: null, error: 'Cannot read ' + message.data_path + ': ' + error.message };
        }
    }

    this.get = async function (io) {
        let message = null;
        if (io.inputs.code) {
            message = await knex('message').where('code', io.inputs.code).first();
        }
        if (message && message.data == null && message.data_path) {
            // keep `data` a JSON string so the response shape matches pre-file rows
            const { payload } = await readPayload(message);
            message.data = payload == null ? null : JSON.stringify(payload);
        }
        return io.json({
            'status': 'success',
            'result': message == null ? null : message
        });
    }

    /**
     * GET /message/data?id=123 - returns the payload of one message, decompressed.
     */
    this.getData = async function (io) {
        const id = io.inputs.id;
        if (id == null || id === '' || !/^\d+$/.test(String(id))) {
            return io.status(400).json({
                'status': 'error',
                'message': 'Missing or invalid "id"'
            });
        }
        const message = await knex('message').where('id', id).first();
        if (message == null) {
            return io.status(404).json({
                'status': 'error',
                'message': 'Message not found'
            });
        }
        const { payload, error } = await readPayload(message);
        return io.json({
            'status': 'success',
            'result': {
                'id': message.id,
                'code': message.code,
                'status': message.status,
                'path': message.path,
                'last_consumer': message.last_consumer,
                'retry_count': message.retry_count,
                'created_at': message.created_at,
                'data_path': message.data_path ?? null,
                'data': payload,
                'data_error': error
            }
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
