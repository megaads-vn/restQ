const PriorityQueue = require('@datastructures-js/priority-queue').PriorityQueue;
const config = require(__dir + "/core/app/config");
const knex = require('knex')(config.get("database"));

class ConsumerQueueManager {
    constructor() {
        this.queues = {};
    }

    init() {
        this.queues = {};
        
        this.loadQueues();
    }

    setQueue(consumer) {
        this.queues[consumer] = new PriorityQueue((a, b) => {
            if (a.delay_to > b.delay_to) {
                return -1;
            }
            if (a.priority < b.priority) {
                return 1;
            }
            return a.id < b.id ? 1 : -1;
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
        const [minMaxResult] = await knex('message')
            .select(
                knex.raw('MIN(id) as minId'),
                knex.raw('MAX(id) as maxId')
            );
    
        const { minId, maxId } = minMaxResult;
        const batchSize = 1000;
        
        // Xử lý từng batch
        for (let currentId = minId; currentId <= maxId; currentId += batchSize) {
            const endId = Math.min(currentId + batchSize - 1, maxId);
            
            const messages = await knex('message')
                .select('id', 'priority', 'delay_to', 'last_consumer', 'retry_count')
                .whereBetween('id', [currentId, endId])
                .where('status', 'WAITING')
                .where('retry_count', '<', config.get("consumers.maxRetryCount"));

            // Phân phối messages vào các queue tương ứng
            for (const msg of messages) {
                if (!msg.last_consumer) {
                    continue;   
                }
                const consumer = msg.last_consumer;
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
    }
}

module.exports =  ConsumerQueueManager;
