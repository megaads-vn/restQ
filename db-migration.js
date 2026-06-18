global.__dir = __dirname;

const knex = require('knex');
const knexConfig = require(__dir + "/config/database");
delete knexConfig.connection.charset;
const db = knex(knexConfig);

module.exports = {
    "db": db,
    "migrate": async function () {
        return new Promise((resolve, reject) => {
            db.migrate.latest()
                .then(() => {
                    console.log('Database migrated successfully');
                    resolve();
                })
                .catch(error => {
                    console.error('Failed to migrate database:', error);
                    reject(error);
                });
        });
    }
};

// Run migration when executed directly: `node db-migration.js`
if (require.main === module) {
    module.exports.migrate()
        .then(() => db.destroy())
        .then(() => process.exit(0))
        .catch(() => db.destroy().then(() => process.exit(1)));
}
