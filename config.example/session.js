module.exports = {
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
