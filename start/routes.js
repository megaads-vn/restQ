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

    // Vendored dashboard libraries: served locally because the "/*" catch-all
    // route swallows asset URLs before the framework asset handler runs
    $route.get("/js/highcharts.js", function (io) {
        io.header("Content-Type", "application/javascript");
        io.download(__dir + "/assets/js/highcharts.js");
    });
    $route.get("/js/axios.min.js", function (io) {
        io.header("Content-Type", "application/javascript");
        io.download(__dir + "/assets/js/axios.min.js");
    });

    // Exact paths are matched before pattern routes, so this is not shadowed by
    // "/message/(:code)" below. Token-gated: ids are sequential and guessable, unlike
    // the 32-char message code.
    $route.get("/message/data", "MessageController@getData", {
        before: auth
    });
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
    $route.get("/monitor/consumer-data", "MonitorController@getConsumerData", {
        before: auth
    });
    $route.get("/setting/consumers", "SettingController@viewConsumers", {
        before: auth
    });
    $route.post("/setting/consumers", "SettingController@saveConsumers", {
        before: auth
    });
    $route.any("/*", "MessageController@onRequest", {
        before: function (io) {
            io.header("Access-Control-Allow-Origin", "*")
                .header("Access-Control-Allow-Credentials", "true")
                .header("Access-Control-Max-Age", 28800)
                .header("Access-Control-Allow-Methods", "POST, GET, OPTIONS, PUT, DELETE, PATCH")
                .header("Access-Control-Allow-Headers", "Content-Type, X-Auth-Token, Origin, Authorization, X-XSRF-TOKEN, Role-User, Token, auth-email, seller-token, token, x-ab-testing")
        }
    });
    $route.options("/*", function (io) {
        io.header("Access-Control-Allow-Origin", "*")
            .header("Access-Control-Allow-Credentials", "true")
            .header("Access-Control-Max-Age", 28800)
            .header("Access-Control-Allow-Methods", "POST, GET, OPTIONS, PUT, DELETE, PATCH")
            .header("Access-Control-Allow-Headers", "Content-Type, X-Auth-Token, Origin, Authorization, X-XSRF-TOKEN, Role-User, Token, auth-email, seller-token, token, x-ab-testing")
            .echo("POST, GET, OPTIONS, PUT, DELETE, PATCH");
    });
    /** Register socket.io requests **/
    /** Register filters **/
};