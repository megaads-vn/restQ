module.exports = function ($route, $logger) {
    /** Register HTTP requests **/
    $route.get("/", "HomeController@welcome");
    $route.any("/*", "MessageController@onRequest");
    /** Register socket.io requests **/
    /** Register filters **/
};
