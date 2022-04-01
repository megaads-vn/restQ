class ConsumerInterface {
    consume(message) {
        throw new Error("ConsumerInterface: function Consume is not implemented!");
    }
}

module.exports = ConsumerInterface;
