/**
 * @author Phuluong
 * Feb 13, 2016
 */
/** Exports **/
module.exports = new Config();
/** Imports **/
var fs = require("fs");
var util = require(__dir + '/core/app/util');
/** Modules **/
function Config() {
    var configContainer = {};
    /**
     * Get config value by key
     * @param {String} key
     * @param {} defaultValue
     * @returns {}
     */
    this.get = function (key, defaultValue, ignoreCache = false) {
        var retval = defaultValue;
        // Normalize the key BEFORE the cache lookup: the cache is written with the
        // slashed key, so looking it up with the dotted key never hit and every call
        // re-required the config file (leaking Modules via require-in-the-middle/children)
        key = key.replaceAll(".", "/");
        if (!ignoreCache && configContainer[key] != null) {
            retval = configContainer[key];
        } else {
            var path = __dir + "/config/" + key;
            var parentPath = path.substring(0, path.lastIndexOf("/"));
            try {
                var property = path.substring(path.lastIndexOf("/") + 1, path.length);
                if (fs.existsSync(path + ".js")) {
                    retval = requireUncached(path);
                } else if (fs.existsSync(parentPath + ".js")) {
                    if ((requireUncached(parentPath))[property] != null) {
                        retval = (requireUncached(parentPath))[property];
                    }
                } else if (key.indexOf("package") == 0) {
                    retval = (requireUncached(__dir + "/package.json"))[property];
                }
                configContainer[key] = retval;
            } catch (exc) {
            }
        }
        if (retval == null) {

        }
        return retval;
    };

    function requireUncached(module) {
        delete require.cache[require.resolve(module)];
        return require(module);
    }
    /**
     * Set config value
     * @param {String} key
     * @param {} value
     */
    this.set = function (key, value) {
        configContainer[key] = value;
    };
}

