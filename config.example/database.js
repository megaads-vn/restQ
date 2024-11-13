module.exports = {
    client: 'mysql',
    connection: {
        host: '127.0.0.1',
        database: 'restq',
        user: 'root',
        password: '',
        charset: 'utf8mb4_unicode_ci'
    },
    pool: { min: 2, max: 20 },
    migrations: {
        tableName: 'knex_migrations'
    },
    message: {
        index: 'getMessage'
    }
};
