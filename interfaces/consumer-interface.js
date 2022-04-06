class ConsumerInterface {
    consume(message, io) {
        throw new Error("ConsumerInterface: function Consume is not implemented!");
    }
}

module.exports = ConsumerInterface;
