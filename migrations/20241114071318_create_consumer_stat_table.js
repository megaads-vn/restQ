/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
    return knex.schema.createTable('consumer_stat', function (table) {
        table.bigIncrements('id').primary();
        table.string('name', 100).nullable();
        table.integer('count');
        table.float('avg_time').nullable();
    });
  
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
    return knex.schema.dropTable('consumer_stat');
};
