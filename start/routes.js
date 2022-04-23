module.exports = function ($route, $logger) {
    /** Register HTTP requests **/    
    $route.get("/", "HomeController@welcome");
    $route.any("/*", "MessageController@onRequest", {
        before: function (io) {
            io.header("Access-Control-Allow-Origin", "*")
                .header("Access-Control-Allow-Credentials", "true")
                .header("Access-Control-Max-Age", 28800)
                .header("Access-Control-Allow-Methods", "POST, GET, OPTIONS, PUT, DELETE, PATCH")
                .header("Access-Control-Allow-Headers", "Content-Type, X-Auth-Token, Origin, Authorization, X-XSRF-TOKEN, Role-User, Token")
        }
    });
    $route.options("/*", function (io) {
        io.header("Access-Control-Allow-Origin", "*")
            .header("Access-Control-Allow-Credentials", "true")
            .header("Access-Control-Max-Age", 28800)
            .header("Access-Control-Allow-Methods", "POST, GET, OPTIONS, PUT, DELETE, PATCH")
            .header("Access-Control-Allow-Headers", "Content-Type, X-Auth-Token, Origin, Authorization, X-XSRF-TOKEN, Role-User, Token")
            .echo("POST, GET, OPTIONS, PUT, DELETE, PATCH");
    });
    /** Register socket.io requests **/
    /** Register filters **/
};
