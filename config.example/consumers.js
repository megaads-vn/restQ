module.exports = {
    retryTime: 5, // 5s
    retryCount: 5,
    timeout: 5, // 5s
    consumers: [
        {
            'name': 'success-consumer',
            'origin': 'http://localhost:2306/success',
            'paths': [
                '/success/([a-z]{3,10})'
            ],
            'qos': 5
        },
        {
            'name': 'error-consumer',
            'origin': 'http://localhost:2306/error',
            'paths': [
                '/error/([a-z]{3,10})'
            ],
            'qos': 5
        }
    ]
};
