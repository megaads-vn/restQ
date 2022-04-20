module.exports = {
    // "retryTime" (unit: second): waiting time for the next processing of a request
    retryTime: 5,

    // "maxRetryCount": maximum processing times of a request
    maxRetryCount: 5,

    // "defaultRequestTimeout" (unit: second): default request timeout, we can change the timeout for each consumer by setting "requestTimeout" with that consumer
    // If the timeout is 0, it means it have no timeout!
    defaultRequestTimeout: 5,

    // setting consumers
    consumers: [
        {
            'name': 'error-consumer',
            'origin': 'http://localhost:2306/error',
            'paths': [
                '/error/([a-z]{3,10})'
            ],
            'qos': 5,
            'is_callback': 0,
            'postback_url': '',
            'requestTimeout': 5
        }
    ]
};
