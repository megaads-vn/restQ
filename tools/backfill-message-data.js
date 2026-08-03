/**
 * Moves the payload of existing rows out of the `message.data` longtext column and
 * into gzipped files, filling in `data_path`.
 *
 * Usage:
 *   node tools/backfill-message-data.js --dry-run
 *   node tools/backfill-message-data.js --batch=500 --limit=100000
 *
 * Run this only AFTER the `data_path` migration has been applied and the new code is
 * deployed (older code does not know how to read `data_path` and would treat every
 * backfilled row as having no payload).
 *
 * NOTE: MySQL does not hand the freed space back to the OS after `SET data = NULL`.
 * Run `OPTIMIZE TABLE message;` afterwards to actually reclaim disk - it locks the
 * table and takes a while on a big table, so do it during a quiet period.
 */
global.__dir = require('path').resolve(__dirname, '..');

const knexConfig = require(__dir + "/config/database");
const knex = require('knex')(knexConfig);
const messageStore = require(__dir + "/message-queue/message/message-store");

function getArg(name, defaultValue) {
    const prefix = '--' + name + '=';
    const match = process.argv.find(arg => arg.indexOf(prefix) === 0);
    return match ? match.substring(prefix.length) : defaultValue;
}

const dryRun = process.argv.indexOf('--dry-run') >= 0;
const batchSize = parseInt(getArg('batch', '500'), 10);
const limit = parseInt(getArg('limit', '0'), 10); // 0 = no limit

async function main() {
    console.log('backfill start', JSON.stringify({ dryRun, batchSize, limit, root: messageStore.root }));

    let lastId = 0;
    let migrated = 0;
    let failed = 0;

    for (; ;) {
        const rows = await knex('message')
            .select('id', 'code', 'created_at', 'data')
            .whereNotNull('data')
            .whereNull('data_path')
            .where('id', '>', lastId)
            .orderBy('id', 'asc')
            .limit(batchSize);

        if (rows.length === 0) {
            break;
        }

        for (const row of rows) {
            lastId = row.id;
            let payload;
            try {
                payload = JSON.parse(row.data);
            } catch (error) {
                console.log('skip id=' + row.id + ' (unparsable data): ' + error.message);
                failed++;
                continue;
            }
            if (dryRun) {
                migrated++;
                continue;
            }
            try {
                // created_at drives the day directory so file age keeps matching the
                // message age, which is what the orphan sweeper reasons about.
                const dataPath = await messageStore.write({
                    code: row.code,
                    created_at: row.created_at,
                    data: payload
                });
                await knex('message').where('id', row.id).update({
                    data: null,
                    data_path: dataPath
                });
                migrated++;
            } catch (error) {
                console.log('failed id=' + row.id + ': ' + error.message);
                failed++;
            }
        }

        console.log('progress: migrated=' + migrated + ' failed=' + failed + ' lastId=' + lastId);
        if (limit > 0 && migrated >= limit) {
            console.log('reached --limit, stopping');
            break;
        }
    }

    console.log('backfill done', JSON.stringify({ migrated, failed, dryRun }));
    if (!dryRun && migrated > 0) {
        console.log('Reminder: run `OPTIMIZE TABLE message;` to actually reclaim disk space.');
    }
}

main()
    .then(() => knex.destroy())
    .then(() => process.exit(0))
    .catch(error => {
        console.error('backfill failed:', error);
        return knex.destroy().then(() => process.exit(1));
    });
