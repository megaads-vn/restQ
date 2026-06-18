# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

RestQ is an HTTP gateway message queue. Producers send normal HTTP requests to RestQ instead of directly to a backend; RestQ persists each request as a "message", queues it, and re-issues it to the matching upstream ("consumer") with QoS/retry/delay/priority control. It can respond to the producer synchronously, fire-and-forget, or POST the result to a `postback_url`. See `README.md` for the producer-facing request options (`is_callback`, `postback_url`, `priority`, `delay`).

## Running & developing

- **Run the server:** `node app.js` (listens on `app.port`, default `2307`). There are no npm scripts and no build step.
- **Dependencies:** `npm install`. Requires a reachable MySQL instance (see `config/database.js`).
- **DB migrations:** knex. `db-migration.js` exposes `migrate()` but it is commented out in `app.js`, so migrations are NOT run automatically on boot — run them manually if needed (`knex migrate:latest`, or uncomment the call in `app.js`). Schema lives in `migrations/`.
- **`message_stat.sql`** is applied by hand, separately from knex migrations: it creates a HASH-partitioned `message_stat` table (64 partitions on `CRC32(last_consumer)`) plus AFTER INSERT/DELETE triggers on `message`. This is the "message stat using partition" feature.
- **Load test:** `node tests/pusher.js` is a manual throughput script (hammers `localhost:2307`), not a unit test suite. There is no test framework configured.

## Configuration

- `config/` holds runtime config and is **git-ignored**. `config.example/` is the committed template — copy it to `config/` for a fresh setup. When adding a config key, update `config.example/` too.
- `config.get("file.key", default)` maps to `config/file.js` exporting `{ key: ... }` (e.g. `config.get("app.port")` → `config/app.js`'s `port`). Values are cached after first read; pass a third arg `true` to bypass the cache (used for live consumer reloads).
- **Consumers are configured in `config/consumers.js`**, not in code. Each consumer maps URL path regexes → an upstream `origin`, with `qos` (max concurrent in-flight), `method`, `requestTimeout`, `is_callback`, `postback_url`. `origin` supports `$1`-style regex-group substitution from the matched path (e.g. path `/api/([a-z]{2})/x` + origin `$1.api.com`). `qos: 0` means the consumer is never fed by the in-memory scheduler.
- `config/auth.js` `token` gates `/monitor` and `/setting` routes (passed as `?token=`).

## Architecture

This runs on a small hand-rolled MVC micro-framework in `core/` (vintage ~2015, author "Phuluong"), not Express. Two ideas drive almost everything:

**1. IoC container + autoloader with constructor injection by parameter name.**
- `config/service-providers.js` binds named services into `core/ioc-container/service-container.js` (e.g. `$config`, `$event`, `$logger`, `$messageManager`, `$consumerManager`, `$producerManager`, `$queueServer`, `$route`).
- `core/loader/auto-loader.js` reads `app.autoload` directories (`/controllers`, `/entities`, `/start`), and for each exported constructor function it inspects the parameter names and injects the matching service-container binding. **A constructor/function param named `$foo` is auto-wired** — this is why controllers like `MessageController($event, $config, $queueServer, $messageManager)` get their dependencies for free.
- Controllers register as classes; routes reference actions by string `"ControllerName@method"` (e.g. `"MessageController@onRequest"`).

**2. Routing → IO abstraction.**
- `start/routes.js` defines all routes via `$route.get/post/.../any/options`. `core/loader/route-loader.js` wraps every HTTP (and socket.io) request in an `IO` object (`core/io/`) that unifies `io.inputs`, `io.json()`, `io.status()`, `io.header()`, before/after filters, etc. Actions receive a single `io` argument.
- The catch-all `$route.any("/*", "MessageController@onRequest")` is the main data path: any unmatched request becomes a queued message. CORS headers are set in its `before` filter.
- The boot sequence is `app.js` → `core/app/start.js` `boot()` (session manager → route loader → service providers → autoload → HTTP/socket.io listeners → `system.booted` event).

**3. The message-queue engine (`message-queue/`).**
- `message-queue-server.js` (`$queueServer`) is the orchestrator. `publish(io)` builds a `Message`, finds the matching consumer, decides callback behavior, persists via `$messageManager`, and fires `message::push`.
- Scheduling is **interval-driven, not purely event-driven**: a `setInterval` (every 3s) calls `handleIfAnyConsumerIsIdle()`, which finds idle consumers (`processing_request_count < qos`) and feeds them messages. Completion flows back through the `consumer::response` event → `onConsumerResponse` (retry/remove/postback) → `consumer::released`.
- `message/message-manager.js` (`$messageManager`) owns all MySQL access for the `message` table via knex, plus an in-memory `ConsumerQueueManager`. It uses `async-lock` + `p-queue` to serialize message fetch/insert. Note `getMessageBy` forces `use index (getMessage)` (configurable via `database.message.index`).
- `message/consumer-queue-manager.js` keeps a **per-consumer in-memory `PriorityQueue`** (ordered by `delay_to`, then `priority`, then `id`) so the scheduler doesn't hit the DB to pick the next message. `loadQueues()` rehydrates these queues from the DB in `id`-range batches on startup (this is the "load queue manager" optimization). The DB is the source of truth; the priority queues are a fast index of `WAITING` message ids.
- `consumer/consumer.js` performs the actual upstream HTTP call with axios, manages `processing_request_count` against `qos`, computes exponential backoff (`retryTime ^ retry_count` seconds) into `delay_to`, and emits `consumer::response`.
- On restart, `updateProcessingMessageAfterServerRestart` reconciles stuck `PROCESSING` rows (callback-with-postback → back to `WAITING`; others → `FAILED`).

**Message lifecycle / status:** `WAITING → PROCESSING → DONE | FAILED`, plus `DUPLICATED` (deduped by `hash` against existing `WAITING`/`PROCESSING` rows when `ignoreDuplicatedMessages`). Old `DONE` rows are purged hourly.

## Conventions specific to this codebase

- `global.__dir` is the project root, set at the top of `app.js`/`db-migration.js`; almost every `require` is absolute via `__dir + "/..."`. Keep that pattern.
- Injected dependencies are conventionally named with a `$` prefix (`$config`, `$event`, ...) precisely because the autoloader matches on the name — renaming a constructor param breaks injection.
- `core/` is the reusable framework; `message-queue/`, `controllers/`, `config/`, `start/` are the RestQ application. Prefer changing the application layer over `core/`.
