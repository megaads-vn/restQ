module.exports = function ($route, $logger, $config) {
    var auth = function (io) {
        const authToken = $config.get("auth.token");
        console.log("auth.token", authToken);
        console.log("io.inputs.token", io.inputs.token);
        if (authToken != null &&
            (io.inputs.token == null || io.inputs.token !== authToken)
        ) {
            io.json({
                "status": "error",
                "message": "Invalid token"
            });
            return false;
        }
    }

    /** Register HTTP requests **/
    $route.get("/", "HomeController@welcome");
    $route.get("/robots.txt", "HomeController@robots");
    $route.get("/favicon.ico", "HomeController@welcome");
    $route.get("/message/(:code)", "MessageController@get");
    $route.delete("/message/done", "MessageController@removeDoneMessages");
    $route.get("/monitor", "MonitorController@index", {
        before: auth
    });
    $route.post("/monitor/start", "MonitorController@start", {
        before: auth
    });
    $route.post("/monitor/pause", "MonitorController@pause", {
        before: auth
    });
    $route.post("/monitor/reload", "MonitorController@reload", {
        before: auth
    });
    $route.any("/*", "MessageController@onRequest", {
        before: function (io) {
            io.header("Access-Control-Allow-Origin", "*")
                .header("Access-Control-Allow-Credentials", "true")
                .header("Access-Control-Max-Age", 28800)
                .header("Access-Control-Allow-Methods", "POST, GET, OPTIONS, PUT, DELETE, PATCH")
                .header("Access-Control-Allow-Headers", "Content-Type, X-Auth-Token, Origin, Authorization, X-XSRF-TOKEN, Role-User, Token, auth-email, seller-token, token")
        }
    });
    $route.options("/*", function (io) {
        io.header("Access-Control-Allow-Origin", "*")
            .header("Access-Control-Allow-Credentials", "true")
            .header("Access-Control-Max-Age", 28800)
            .header("Access-Control-Allow-Methods", "POST, GET, OPTIONS, PUT, DELETE, PATCH")
            .header("Access-Control-Allow-Headers", "Content-Type, X-Auth-Token, Origin, Authorization, X-XSRF-TOKEN, Role-User, Token, auth-email, seller-token, token")
            .echo("POST, GET, OPTIONS, PUT, DELETE, PATCH");
    });
    /** Register socket.io requests **/
    /** Register filters **/
};