module.exports = {
    // "retryTime" (unit: second): waiting time for the next processing of a request
    retryTime: 5,

    // "maxRetryCount": maximum processing times of a request
    maxRetryCount: 5,

    // "defaultRequestTimeout" (unit: second): default request timeout, we can change the timeout for each consumer by setting "requestTimeout" with that consumer
    // If the timeout is 0, it means it have no timeout!
    defaultRequestTimeout: 5,

    statAvgProcessingTime: false,

    removeMessageAfterProcessing: false,

    ignoreNotSupportedMessages: true,

    ignoreDuplicatedMessages: false,

    waitPostbackCompleted: false,

    // setting consumers
    consumers: [
        {
            'name': 'logger',
            'origin': 'https://webhook.site/d4bc1dec-de23-463c-8c47-5882f8fb4f30/$1',
            'method': 'inherit', //GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD
            'paths': [
                '/action/([A-Za-z]{2})(.*)([?].*)'
            ],
            'qos': 5,
            'is_callback': 1,
            'postback_url': 'https://webhook.site/d4bc1dec-de23-463c-8c47-5882f8fb4f30/postback',
            'postback_include_request_data': true,
            'requestTimeout': 5
        }
    ]
};
