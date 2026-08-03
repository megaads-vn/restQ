/**
 * Stores the message payload ("data") as a gzipped file under storage/ instead of
 * the `message.data` longtext column. The DB keeps only a relative `data_path`.
 *
 * Layout: <storagePath>/<YYYYMMDD>/<shard>/<code>.json.gz
 * where shard = first 2 hex chars of sha1(code) -> 256 evenly filled dirs per day.
 * The day prefix is what makes the orphan sweep cheap: it can skip recent dirs
 * without stat()-ing individual files.
 */
const fs = require('fs').promises;
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { promisify } = require('util');
const config = require(__dir + "/core/app/config");

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const DAY_DIR_REGEX = /^\d{8}$/;

class MessageStore {
    constructor() {
        this.root = config.get("message-store.storagePath", __dir + "/storage/messages");
        this.level = config.get("message-store.compressionLevel", 6);
        // mkdir cache: only grows with the number of day/shard dirs touched, not messages
        this.knownDirs = new Set();
        this.knownDirsLimit = 5000;
    }

    /**
     * @param {String} code message code (32 chars, generated before insert)
     * @param {Number} atMs timestamp the message was created at (message.created_at)
     */
    buildRelativePath(code, atMs) {
        const date = atMs ? new Date(Number(atMs)) : new Date();
        const day = "" + date.getFullYear()
            + String(date.getMonth() + 1).padStart(2, '0')
            + String(date.getDate()).padStart(2, '0');
        // hex shard, not a raw slice of `code`: `code` is [A-Za-z0-9] and would
        // collide on case-insensitive filesystems.
        const shard = crypto.createHash('sha1').update(code).digest('hex').substring(0, 2);
        return path.join(day, shard, code + '.json.gz');
    }

    absolute(relativePath) {
        return path.join(this.root, relativePath);
    }

    async ensureDir(dir) {
        if (this.knownDirs.has(dir)) {
            return;
        }
        await fs.mkdir(dir, { recursive: true });
        if (this.knownDirs.size > this.knownDirsLimit) {
            this.knownDirs.clear();
        }
        this.knownDirs.add(dir);
    }

    /**
     * Write message.data as gzip. Returns the relative path to store in `data_path`.
     */
    async write(message) {
        const relativePath = this.buildRelativePath(message.code, message.created_at);
        const absolutePath = this.absolute(relativePath);
        const dir = path.dirname(absolutePath);
        await this.ensureDir(dir);
        const buffer = await gzip(Buffer.from(JSON.stringify(message.data), 'utf-8'), { level: this.level });
        // tmp + rename so a crash mid-write never leaves a truncated .gz behind
        const tmpPath = absolutePath + '.tmp';
        try {
            await this.writeAndRename(tmpPath, absolutePath, buffer);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                throw error;
            }
            // The directory disappeared after we cached it (sweeper rmdir, manual
            // cleanup, remounted volume). Forget the cache entry and rebuild it once.
            this.knownDirs.delete(dir);
            await this.ensureDir(dir);
            await this.writeAndRename(tmpPath, absolutePath, buffer);
        }
        return relativePath;
    }

    async writeAndRename(tmpPath, absolutePath, buffer) {
        await fs.writeFile(tmpPath, buffer);
        await fs.rename(tmpPath, absolutePath);
    }

    /**
     * Throws on purpose (ENOENT / corrupt gzip / bad JSON) - the caller decides the policy.
     */
    async read(relativePath) {
        const buffer = await fs.readFile(this.absolute(relativePath));
        return JSON.parse((await gunzip(buffer)).toString('utf-8'));
    }

    async remove(relativePath) {
        if (!relativePath) {
            return;
        }
        try {
            await fs.unlink(this.absolute(relativePath));
        } catch (error) {
            if (error.code !== 'ENOENT') {
                throw error;
            }
        }
    }

    /**
     * Delete files that no `message` row points at any more (crash between the row
     * delete and the file delete, rolled back inserts, manual DELETEs in SQL...).
     *
     * Only walks day dirs older than minAgeHours so it can never race a file that
     * was just written but whose transaction has not committed yet.
     *
     * @param {Function} lookupExistingCodes async (codes[]) => Set of codes still in DB
     * @param {Object} options {dryRun, minAgeHours, chunkSize}
     */
    async sweepOrphans(lookupExistingCodes, options = {}) {
        const dryRun = options.dryRun !== false;
        const minAgeHours = options.minAgeHours != null ? options.minAgeHours : 48;
        const chunkSize = options.chunkSize != null ? options.chunkSize : 500;
        const minAgeMs = minAgeHours * 60 * 60 * 1000;
        const now = Date.now();
        const result = { scanned: 0, orphans: 0, removed: 0, days: 0 };

        let dayEntries;
        try {
            dayEntries = await fs.readdir(this.root, { withFileTypes: true });
        } catch (error) {
            if (error.code === 'ENOENT') {
                return result;
            }
            throw error;
        }

        for (const dayEntry of dayEntries) {
            if (!dayEntry.isDirectory() || !DAY_DIR_REGEX.test(dayEntry.name)) {
                continue;
            }
            // A day dir is only eligible once its LAST possible moment is old enough.
            const year = parseInt(dayEntry.name.substring(0, 4), 10);
            const month = parseInt(dayEntry.name.substring(4, 6), 10) - 1;
            const day = parseInt(dayEntry.name.substring(6, 8), 10);
            const endOfDay = new Date(year, month, day + 1).getTime();
            if (now - endOfDay < minAgeMs) {
                continue;
            }
            result.days++;
            await this.sweepDayDir(dayEntry.name, lookupExistingCodes, {
                dryRun, chunkSize, now, minAgeMs
            }, result);
        }
        return result;
    }

    async sweepDayDir(dayName, lookupExistingCodes, options, result) {
        const dayPath = path.join(this.root, dayName);
        const shardEntries = await fs.readdir(dayPath, { withFileTypes: true });

        for (const shardEntry of shardEntries) {
            if (!shardEntry.isDirectory()) {
                continue;
            }
            const shardPath = path.join(dayPath, shardEntry.name);
            const fileNames = await fs.readdir(shardPath);
            let pending = [];

            for (const fileName of fileNames) {
                if (fileName.endsWith('.tmp')) {
                    // leftover from an interrupted atomic write
                    result.orphans++;
                    if (!options.dryRun) {
                        await this.unlinkQuietly(path.join(shardPath, fileName), result);
                    }
                    continue;
                }
                if (!fileName.endsWith('.json.gz')) {
                    continue;
                }
                result.scanned++;
                pending.push(fileName);
                if (pending.length >= options.chunkSize) {
                    await this.sweepChunk(shardPath, pending, lookupExistingCodes, options, result);
                    pending = [];
                }
            }
            if (pending.length > 0) {
                await this.sweepChunk(shardPath, pending, lookupExistingCodes, options, result);
            }
            await this.removeDirIfEmpty(shardPath, options.dryRun);
        }
        await this.removeDirIfEmpty(dayPath, options.dryRun);
    }

    async sweepChunk(shardPath, fileNames, lookupExistingCodes, options, result) {
        const codes = fileNames.map(name => name.substring(0, name.length - '.json.gz'.length));
        const existing = await lookupExistingCodes(codes);
        for (let index = 0; index < fileNames.length; index++) {
            if (existing.has(codes[index])) {
                continue;
            }
            result.orphans++;
            if (!options.dryRun) {
                await this.unlinkQuietly(path.join(shardPath, fileNames[index]), result);
            }
        }
    }

    async unlinkQuietly(absolutePath, result) {
        try {
            await fs.unlink(absolutePath);
            result.removed++;
        } catch (error) {
            if (error.code !== 'ENOENT') {
                console.log('MessageStore::sweep unlink error: ' + absolutePath + ' - ' + error.message);
            }
        }
    }

    async removeDirIfEmpty(dir, dryRun) {
        if (dryRun) {
            return;
        }
        try {
            await fs.rmdir(dir);
            this.knownDirs.delete(dir);
        } catch (error) {
            // ENOTEMPTY is the normal case; anything else is not worth failing the sweep
        }
    }
}

module.exports = new MessageStore();
