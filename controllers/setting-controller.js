module.exports = SettingController;
const fs = require('fs').promises;

function SettingController($event, $config, $queueServer) {
    this.viewConsumers = function (io) {
        io.render("/setting/consumers", {
            "consumers": $config.get("consumers", {}, true),
            "authToken": $config.get("auth.token")
        });
    };

    this.saveConsumers = async function (io) {
        let result = await saveConsumersConfig(io.inputs.consumers);
        io.json({
            status: result ? "successful" : "failed",
        });
    };

    async function saveConsumersConfig(consumers) {
        var retval = false;
        let configPath = __dir + '/config/consumers.js';
        try {
            await fs.writeFile(configPath, "module.exports = " + JSON.stringify(consumers, null, 4), 'utf8');
            $queueServer.reload();
            retval = true;
        } catch (error) {
            console.error('Error reading or writing file:', error);
        }
        return retval;
    };
}
