const PriorityQueue = require('@datastructures-js/priority-queue').PriorityQueue;
const config = require(__dir + "/core/app/config");
// Giới hạn số message giữ trong RAM cho mỗi queue, phần còn lại sẽ được nạp lại từ DB khi queue cạn
const MAX_ITEMS = config.get("consumers.maxQueueItems", 50000);
const RELOAD_INTERVAL = config.get("consumers.queueReloadInterval", 60) * 1000;
class ConsumerQueueManager {
    constructor(knex) {
        this.queues = {};
        this.consumers = {};
        this.lastLoadAt = {};
        this.knex = knex;
    }

    init(consumers) {
        this.queues = {};
        this.consumers = {};
        this.lastLoadAt = {};
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
        if (!this.hasQueue(consumer) || this.queues[consumer].size() === 0) {
            // Queue trong RAM đã cạn: có thể còn message tồn trong DB (vượt MAX_ITEMS lúc nạp), nạp lại
            this.reloadQueueIfNeeded(consumer);
            return [];
        }
        const messages = [];
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
        // Nạp theo từng consumer, dùng index (last_consumer, status, retry_count) thay vì quét theo dải id
        for (const consumerName in this.consumers) {
            try {
                await this.loadQueue(consumerName);
            } catch (error) {
                console.log('loadQueue error', consumerName, error.message);
            }
        }
        console.log('done load queues');
    }

    async loadQueue(consumer) {
        this.lastLoadAt[consumer] = Date.now();
        const messages = await this.knex('message')
            .select('id', 'priority', 'delay_to', 'last_consumer', 'retry_count')
            .where('last_consumer', consumer)
            .where('status', 'WAITING')
            .where('retry_count', '<', config.get("consumers.maxRetryCount"))
            .limit(MAX_ITEMS);
        if (messages.length > 0) {
            this.distributeMessage(messages);
        }
        return messages.length;
    }

    reloadQueueIfNeeded(consumer) {
        if (!this.hasConsumer(consumer)) {
            return;
        }
        const last = this.lastLoadAt[consumer] || 0;
        if (Date.now() - last >= RELOAD_INTERVAL) {
            this.lastLoadAt[consumer] = Date.now();
            this.loadQueue(consumer).catch((error) => {
                console.log('loadQueue error', consumer, error.message);
            });
        }
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
