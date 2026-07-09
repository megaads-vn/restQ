module.exports = {
    /** Create an in-memory session for every HTTP request. Leave disabled for API-only usage:
     * clients that don't send cookies create a new session per request and leak memory. **/
    enableHttpSession: false,
    /** Prefix for session keys. **/
    prefix: "restQ",
    /** Session timeout: in minutes **/
    timeout: 30,
    /** Default session driver: file, memory **/
    driver: "memory",
    /** Session driver storage path **/
    driverPath: "/libs/session-drivers",
    /** Session storage path **/
    storage: __dir + "/storage/sessions"
};
