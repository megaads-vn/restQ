global.__dir = __dirname;

const knex = require('knex');
const knexConfig = require(__dir + "/config/database");
delete knexConfig.connection.charset;
const db = knex(knexConfig);
module.exports = db;

module.exports = {
    "migrate": async function () {
        return new Promise((resolve, reject) => {
            db.migrate.latest(knexConfig.development)
                .then(() => {
                    console.log('Database migrated successfully');
                    resolve();
                })
                .catch(error => {
                    console.error('Failed to migrate database:', error);
                    reject();
                });
        });
    }
};

