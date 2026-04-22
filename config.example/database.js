let timezone = '+07:00';
try {
    const appConfig = require(__dir + '/config/app');
    if (appConfig && appConfig.timezone) {
        timezone = appConfig.timezone;
    }
} catch (e) {}

module.exports = {
    client: 'mysql',
    connection: {
        host: '127.0.0.1',
        database: 'restq',
        user: 'root',
        password: '',
        charset: 'utf8mb4_unicode_ci',
        timezone: timezone
    },
    pool: {
        min: 2,
        max: 20,
        afterCreate: function (conn, done) {
            conn.query(`SET time_zone = '${timezone}'`, function (err) {
                done(err, conn);
            });
        }
    },
    migrations: {
        tableName: 'knex_migrations'
    },
    message: {
        index: 'getMessage'
    }
};
