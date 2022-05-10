module.exports = MessageController;

function MessageController($event, $config) {
    const knex = require('knex')($config.get("database"));
    
    this.onRequest = function (io) {
        $event.fire('request::new', io);
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
}
