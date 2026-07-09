module.exports = {
    // "responseTimeout" (unit: second): how long a producer waiting for a synchronous response
    // is kept in memory. After that the producer is answered with 504 and released so the
    // request/response objects can be garbage collected.
    responseTimeout: 600
};
