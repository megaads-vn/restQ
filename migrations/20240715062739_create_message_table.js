exports.up = function (knex) {
    return knex.schema.createTable('message', function (table) {
        table.bigIncrements('id').primary();
        table.string('code', 50).nullable().index();
        table.string('hash', 64).nullable().index();
        table.text('data', 'longtext');
        table.string('path', 500).nullable();
        table.integer('priority', 2).unsigned().defaultTo(0);
        table.enu('status', ['WAITING', 'DONE', 'PROCESSING', 'FAILED', 'DUPLICATED']).defaultTo('WAITING');
        table.integer('retry_count', 2).unsigned().defaultTo(0);
        table.boolean('is_callback').defaultTo(true);
        table.string('postback_url', 2048).nullable();
        table.bigInteger('created_at').unsigned().defaultTo(0);
        table.bigInteger('delay_to').unsigned().defaultTo(0);
        table.bigInteger('first_processing_at').unsigned().defaultTo(0);
        table.bigInteger('last_processing_at').unsigned().defaultTo(0);
        table.bigInteger('last_processed_at').unsigned().defaultTo(0);
        table.string('last_consumer', 100).nullable();
        table.timestamp('created_at_time').defaultTo(knex.fn.now());

        table.index(['status', 'retry_count', 'last_consumer', 'delay_to'], 'getMessage');
    });
};

exports.down = function (knex) {
    return knex.schema.dropTable('message');
};