exports.up = function (knex) {
    // Appended at the end of the table on purpose: no `.after('data')`, so MySQL 8
    // can apply this with ALGORITHM=INSTANT instead of rebuilding the whole table
    // (a rebuild would hold a long lock and fire the message_stat triggers).
    return knex.schema.alterTable('message', function (table) {
        table.string('data_path', 255).nullable();
    });
};

exports.down = function (knex) {
    return knex.schema.alterTable('message', function (table) {
        table.dropColumn('data_path');
    });
};
