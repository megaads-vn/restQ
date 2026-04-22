const PriorityQueue = require('@datastructures-js/priority-queue').PriorityQueue;
const config = require(__dir + "/core/app/config");

class ConsumerQueueManager {
    constructor(knex) {
        this.queues = {};
        this.consumers = {};
        this.knex = knex;
        this.maxItems = config.get("consumers.maxQueueSize", 12000000);
    }

    init(consumers) {
        this.queues = {};
        this.consumers = {};
        if (consumers.length > 0) {
            this.loadConsumers(consumers);
            this.loadQueues();
        }
    }

    setQueue(consumer) {
        this.queues[consumer] = new PriorityQueue((a, b) => {
            if (a.delay_to < b.delay_to) {
                return -1;
            }
            if (a.delay_to > b.delay_to) {
                return 1;
            }
            if (a.priority > b.priority) {
                return -1;
            }
            if (a.priority < b.priority) {
                return 1;
            }
            return a.id < b.id ? -1 : 1;
        });
    }

    getQueue(consumer) {
        return this.queues[consumer];
    }

    setMessage(consumer, message) {
        if (!this.hasQueue(consumer)) {
            this.setQueue(consumer);
        }
        if (this.queues[consumer].size() >= this.maxItems) {
            return false;
        }
        return this.queues[consumer].enqueue(message);
    }

    getMessage(consumer) {
        if (!this.hasQueue(consumer)) {
            return null;
        }
        return this.queues[consumer].dequeue();
    }

    getMessages(consumer, limit) {
        if (!this.hasQueue(consumer)) {
            return [];
        }
        const messages = [];
        for (let i = 0; i < limit; i++) {
            const message = this.queues[consumer].dequeue();
            if (message && message.id) {
                if (message.delay_to > Date.now()) {
                    this.queues[consumer].enqueue(message);
                } else {
                    messages.push(message);
                }
            } else {
                break;
            }
        }
        return messages;
    }

    getTotalQueueSize() {
        let total = 0;
        for (const consumer in this.queues) {
            total += this.queues[consumer].size();
        }
        return total;
    }

    isAllQueuesFull() {
        const consumerNames = Object.keys(this.consumers);
        if (consumerNames.length === 0) return false;
        return consumerNames.every(name => {
            return this.hasQueue(name) && this.queues[name].size() >= this.maxItems;
        });
    }

    hasQueue(consumer) {
        return consumer in this.queues;
    }

    removeQueue(consumer) {
        if (this.hasQueue(consumer)) {
            delete this.queues[consumer];
            return true;
        }
        return false;
    }

    async loadQueues() {
        const [minMaxResult] = await this.knex('message')
            .select(
                this.knex.raw('MIN(id) as minId'),
                this.knex.raw('MAX(id) as maxId')
            )
            .where('status', 'WAITING');

        const { minId, maxId } = minMaxResult;
        if (!minId || !maxId) {
            console.log('done load queues: no waiting messages');
            return;
        }

        const batchSize = 5000;
        for (let currentId = maxId; currentId >= minId; currentId -= batchSize) {
            if (this.isAllQueuesFull()) {
                console.log('done load queues: all queues full at', currentId, '/', minId);
                break;
            }
            const startId = currentId - batchSize + 1;
            const messages = await this.knex('message')
                .select('id', 'priority', 'delay_to', 'last_consumer', 'retry_count')
                .whereBetween('id', [startId, currentId])
                .where('status', 'WAITING')
                .where('retry_count', '<', config.get("consumers.maxRetryCount"));
            if (messages.length > 0) {
                this.distributeMessage(messages);
            }
        }

        const totalSize = this.getTotalQueueSize();
        console.log('done load queues', minId, maxId, '| total items:', totalSize);
    }

    distributeMessage(messages) {
        for (const msg of messages) {
            const consumer = msg.last_consumer;
            if (!consumer || !this.hasConsumer(consumer)) {
                continue;
            }
            if (!this.hasQueue(consumer)) {
                this.setQueue(consumer);
            }
            if (this.queues[consumer].size() >= this.maxItems) {
                continue;
            }
            this.queues[consumer].enqueue({
                id: msg.id,
                priority: msg.priority,
                delay_to: msg.delay_to,
                last_consumer: msg.last_consumer,
                retry_count: msg.retry_count
            });
        }
    }

    loadConsumers(consumers) {
        for (let consumer of consumers) {
            if (consumer.qos > 0) {
                this.consumers[consumer.name] = consumer;
            }
        }
    }

    hasConsumer(consumerName) {
        return consumerName in this.consumers;
    }
}

module.exports = ConsumerQueueManager;
