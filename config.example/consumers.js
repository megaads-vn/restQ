module.exports = {
    // "retryTime" (unit: second): waiting time for the next processing of a request
    retryTime: 5,

    // "maxRetryCount": maximum processing times of a request
    maxRetryCount: 5,

    // "defaultRequestTimeout" (unit: second): default request timeout, we can change the timeout for each consumer by setting "requestTimeout" with that consumer
    // If the timeout is 0, it means it have no timeout!
    defaultRequestTimeout: 5,

    removeMessageAfterDone: true,

    ignoreNotSupportedMessages: true,

    // setting consumers
    consumers: [
        {
            'name': 'logger',
            'origin': 'https://webhook.site/d4bc1dec-de23-463c-8c47-5882f8fb4f30/$1',
            'paths': [
                '/action/([A-Za-z]{2})(.*)([?].*)'
            ],
            'qos': 5,
            'is_callback': 1,
            'postback_url': 'https://webhook.site/d4bc1dec-de23-463c-8c47-5882f8fb4f30/postback',
            'requestTimeout': 5
        }
    ]
};
