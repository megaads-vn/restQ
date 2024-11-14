const axios = require('axios');
const PQueue = require('p-queue').default;

const getRandomChars = (length = 2) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
};

const url = 'http://localhost:2307/action?locale='; // Replace with your API endpoint
const totalRequests = 10000;
const concurrency = 500;

let completedRequests = 0;

const sendRequest = () => {
    return axios.get(url + getRandomChars())
        .then(response => {
            completedRequests++;
            console.log(`Completed requests: ${completedRequests}`);
        })
        .catch(error => {
            console.error(`Request failed: ${error.message}`);
        });
};

const queue = new PQueue({ concurrency });

for (let i = 0; i < totalRequests; i++) {
    queue.add(sendRequest);
}

queue.onIdle().then(() => {
    console.log('All requests have been sent');
});
