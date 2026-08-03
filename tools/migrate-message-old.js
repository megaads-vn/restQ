/**
 * Migrates rows from `message_old` (payload in the `data` longtext column) into
 * `message` (payload in a gzipped file, row keeps only `data_path`).
 *
 * Ids are preserved, so the `message_stat` rows rebuilt by trg_message_after_insert
 * stay consistent and anything referencing a message id keeps working.
 *
 * Usage:
 *   node tools/migrate-message-old.js --dry-run
 *   node tools/migrate-message-old.js
 *   node tools/migrate-message-old.js --status=WAITING,PROCESSING
 *   node tools/migrate-message-old.js --from-id=1000000 --batch=1000 --limit=50000
 *
 * Safe to re-run: rows whose id already exists in `message` are skipped, so an
 * interrupted run just continues where it stopped.
 *
 * `message_old` is never modified. Drop it yourself once you have verified the result.
 */
global.__dir = require('path').resolve(__dirname, '..');

const knexConfig = require(__dir + "/config/database");
const knex = require('knex')(knexConfig);
const messageStore = require(__dir + "/message-queue/message/message-store");

const SOURCE_TABLE = 'message_old';
const TARGET_TABLE = 'message';
const WRITE_CONCURRENCY = 10;

function getArg(name, defaultValue) {
    const prefix = '--' + name + '=';
    const match = process.argv.find(arg => arg.indexOf(prefix) === 0);
    return match ? match.substring(prefix.length) : defaultValue;
}

const dryRun = process.argv.indexOf('--dry-run') >= 0;
const batchSize = parseInt(getArg('batch', '500'), 10);
const limit = parseInt(getArg('limit', '0'), 10);          // 0 = everything
const statuses = getArg('status', '').split(',').map(s => s.trim()).filter(Boolean);
let lastId = parseInt(getArg('from-id', '0'), 10);

/** Run fn over items with a small concurrency cap (gzip + fs are the slow part). */
async function mapWithConcurrency(items, concurrency, fn) {
    const results = new Array(items.length);
    let cursor = 0;
    const workers = new Array(Math.min(concurrency, items.length)).fill(0).map(async () => {
        for (; ;) {
            const index = cursor++;
            if (index >= items.length) return;
            results[index] = await fn(items[index], index);
        }
    });
    await Promise.all(workers);
    return results;
}

async function resolveColumns() {
    const sourceColumns = Object.keys(await knex(SOURCE_TABLE).columnInfo());
    const targetColumns = Object.keys(await knex(TARGET_TABLE).columnInfo());

    if (sourceColumns.length === 0) throw new Error(SOURCE_TABLE + ' not found or has no columns');
    if (targetColumns.length === 0) throw new Error(TARGET_TABLE + ' not found or has no columns');
    if (sourceColumns.indexOf('data') < 0) throw new Error(SOURCE_TABLE + ' has no `data` column');
    if (targetColumns.indexOf('data_path') < 0) throw new Error(TARGET_TABLE + ' has no `data_path` column');
    if (targetColumns.indexOf('data') >= 0) {
        console.log('WARNING: ' + TARGET_TABLE + ' still has a `data` column; it will be left NULL.');
    }

    // copy everything the two tables share, except the payload columns themselves
    const copyColumns = sourceColumns.filter(column =>
        targetColumns.indexOf(column) >= 0 && column !== 'data' && column !== 'data_path');

    const skipped = sourceColumns.filter(c => copyColumns.indexOf(c) < 0 && c !== 'data');
    if (skipped.length > 0) {
        console.log('NOTE: columns present in ' + SOURCE_TABLE + ' but not copied: ' + skipped.join(', '));
    }
    return copyColumns;
}

async function main() {
    const copyColumns = await resolveColumns();
    console.log('migrate start', JSON.stringify({
        dryRun, batchSize, limit, fromId: lastId,
        statuses: statuses.length ? statuses : 'ALL',
        storage: messageStore.root
    }));
    console.log('columns copied: ' + copyColumns.join(', ') + ' (+ data_path)');

    let migrated = 0, skipped = 0, emptyPayload = 0, failed = 0;

    for (; ;) {
        let query = knex(SOURCE_TABLE)
            .select(copyColumns.concat(['data']))
            .where('id', '>', lastId)
            .orderBy('id', 'asc')
            .limit(batchSize);
        if (statuses.length > 0) {
            query = query.whereIn('status', statuses);
        }
        const rows = await query;
        if (rows.length === 0) break;

        lastId = rows[rows.length - 1].id;

        // Skip anything already migrated so an interrupted run can just be re-run.
        const existingRows = await knex(TARGET_TABLE)
            .select('id')
            .whereIn('id', rows.map(row => row.id));
        const existing = new Set(existingRows.map(row => row.id));
        const pending = rows.filter(row => !existing.has(row.id));
        skipped += rows.length - pending.length;

        if (pending.length > 0) {
            const prepared = await mapWithConcurrency(pending, WRITE_CONCURRENCY, async (row) => {
                const record = {};
                copyColumns.forEach(column => record[column] = row[column]);
                record.data_path = null;

                if (row.data == null || row.data === '') {
                    emptyPayload++;
                    return { record, writtenPath: null };
                }
                let payload;
                try {
                    payload = JSON.parse(row.data);
                } catch (error) {
                    console.log('id=' + row.id + ': unparsable data, migrating without payload - ' + error.message);
                    failed++;
                    return { record, writtenPath: null };
                }
                if (dryRun) {
                    return { record, writtenPath: null };
                }
                // created_at drives the day directory so file age keeps matching
                // message age, which is what the orphan sweeper reasons about.
                const writtenPath = await messageStore.write({
                    code: row.code,
                    created_at: row.created_at,
                    data: payload
                });
                record.data_path = writtenPath;
                return { record, writtenPath };
            });

            if (!dryRun) {
                migrated += await insertPrepared(prepared);
            } else {
                migrated += prepared.length;
            }
        }

        console.log('progress: migrated=' + migrated + ' skipped=' + skipped
            + ' emptyPayload=' + emptyPayload + ' failed=' + failed + ' lastId=' + lastId);

        if (limit > 0 && migrated >= limit) {
            console.log('reached --limit, stopping');
            break;
        }
    }

    console.log('migrate done', JSON.stringify({ migrated, skipped, emptyPayload, failed, dryRun, lastId }));
    if (!dryRun && migrated > 0) {
        console.log('Verify, then drop the old table yourself: DROP TABLE ' + SOURCE_TABLE + ';');
    }
}

/**
 * Batch insert, falling back to row-by-row so one bad row cannot lose a whole batch.
 * Files belonging to rows that could not be inserted are unlinked again, otherwise
 * they would sit on disk with nothing pointing at them.
 */
async function insertPrepared(prepared) {
    try {
        await knex(TARGET_TABLE).insert(prepared.map(item => item.record));
        return prepared.length;
    } catch (error) {
        console.log('batch insert failed (' + error.message + '), retrying row by row');
    }
    let inserted = 0;
    for (const item of prepared) {
        try {
            await knex(TARGET_TABLE).insert(item.record);
            inserted++;
        } catch (error) {
            console.log('id=' + item.record.id + ' insert failed: ' + error.message);
            if (item.writtenPath) {
                await messageStore.remove(item.writtenPath).catch(() => { });
            }
        }
    }
    return inserted;
}

main()
    .then(() => knex.destroy())
    .then(() => process.exit(0))
    .catch(error => {
        console.error('migrate failed:', error);
        return knex.destroy().then(() => process.exit(1));
    });
