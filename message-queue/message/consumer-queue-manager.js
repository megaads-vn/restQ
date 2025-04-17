const PriorityQueue = require('@datastructures-js/priority-queue').PriorityQueue;
const config = require(__dir + "/core/app/config");
const MAX_ITEMS = 12000000;
class ConsumerQueueManager {
    constructor(knex) {
        this.queues = {};
        this.consumers = {};
        this.knex = knex;
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
                return -1; // delay_to nhỏ hơn sẽ được ưu tiên lên trước
            }
            if (a.delay_to > b.delay_to) {
                return 1; // delay_to lớn hơn sẽ được sắp xếp sau
            }
            if (a.priority > b.priority) {
                return -1; // priority lớn hơn sẽ được ưu tiên lên trước
            }
            if (a.priority < b.priority) {
                return 1; // priority nhỏ hơn sẽ được sắp xếp sau
            }
            return a.id < b.id ? -1 : 1; // id nhỏ hơn sẽ được ưu tiên lên trước
        });
    }

    getQueue(consumer) {
        return this.queues[consumer];
    }

    setMessage(consumer, message) {
        if (!this.hasQueue(consumer)) {
            this.setQueue(consumer);
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
        console.log('getMessages', consumer, this.queues[consumer].size());
        for (let i = 0; i < limit; i++) {
            const message = this.queues[consumer].dequeue();
            if (message && message.id) {
                if (message.delay_to > Date.now()) {
                    this.setMessage(consumer, message);
                } else {
                    messages.push(message);
                }
            } else {
                break;
            }
        }
        return messages;
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
        // Lấy MinId và MaxId
        const [minMaxResult] = await this.knex('message')
            .select(
                this.knex.raw('MIN(id) as minId'),
                this.knex.raw('MAX(id) as maxId')
            );
    
        const { minId, maxId } = minMaxResult;
        const batchSize = 2000;
        for (let currentId = maxId; currentId >= minId; currentId -= batchSize) {
            const startId = Math.min(currentId - batchSize + 1, minId);
            const messages = await this.knex('message')
                .select('id', 'priority', 'delay_to', 'last_consumer', 'retry_count')
                .whereBetween('id', [startId, currentId])
                .where('status', 'WAITING')
                .where('retry_count', '<', config.get("consumers.maxRetryCount"));
            this.distributeMessage(messages);
        }


        console.log('done load queues', minId, maxId);
    }

    distributeMessage(messages) {
        for (const msg of messages) {
            const consumer = msg.last_consumer;
            if (!consumer
                || !this.hasConsumer(consumer)
                || (this.queues[consumer] && this.queues[consumer].size() > MAX_ITEMS)) {
                continue;
            }
            // Tạo queue nếu chưa tồn tại
            if (!this.hasQueue(consumer)) {
                this.setQueue(consumer);
            }

            // Thêm message vào queue
            this.queues[consumer].enqueue({
                id: msg.id,
                priority: msg.priority,
                delay_to: msg.delay_to,
                last_consumer: msg.last_consumer,
                retry_count: msg.retry_count
            });
        }
    }

    async batch(minId, maxId) {
        // Xử lý từng batch
        for (let currentId = minId; currentId <= maxId; currentId += batchSize) {
            const endId = Math.max(currentId + batchSize - 1, maxId);

            const messages = await this.knex('message')
                .select('id', 'priority', 'delay_to', 'last_consumer', 'retry_count')
                .whereBetween('id', [currentId, endId])
                .where('status', 'WAITING')
                .where('retry_count', '<', config.get("consumers.maxRetryCount"));

            // Phân phối messages vào các queue tương ứng
            this.distributeMessage(messages);
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

module.exports =  ConsumerQueueManager;
