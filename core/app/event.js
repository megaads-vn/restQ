/**
 * @author Phuluong
 * Feb 12, 2016
 */

/** Exports **/
module.exports = new Event();
/** Imports **/
var autoLoader = require(__dir + "/core/loader/auto-loader");
/** Modules **/
function Event() {
    var listenerContainer = {};
    /**
     * Subscribe a event
     * @param {String} event Supporting widcard
     * @param {String|function} listener
     */
    this.listen = function (event, listener) {
        if (listenerContainer[event] == null) {
            listenerContainer[event] = [];
        }
        var isExisted = false;
        for (var i = 0; i < listenerContainer[event].length; i++) {
            if (listenerContainer[event][i] === listener) {
                isExisted = true;
                break;
            }            
        }
        if (!isExisted) {
            listenerContainer[event].push(listener);
        }
    };
    /**
     * Unsubscribe a event
     * @param {String} event Supporting widcard
     * @param {String|function} listener
     * @returns {Boolean}
     */
    this.unlisten = function (event, listener) {
        var retval = false;
        var listeners = listenerContainer[event];
        if (listeners != null) {
            for (let index = 0; index < listeners.length; index++) {
                const listenerItem = listeners[index];
                if (listenerItem === listener) {
                    listeners.splice(index, 1);
                    retval = true;
                    break;
                }
            }
        }        
        return retval;
    };
    /**
     * Publish a event
     * @param {String} event
     * @param {object} params
     */
    this.fire = function (event, params) {
        for (var eventListener in listenerContainer) {
            if (event.matchWildcard(eventListener)) {
                var listeners = listenerContainer[eventListener];
                listeners.forEach(function (listener) {
                    if (typeof listener === "string") {
                        listener = autoLoader.getAction(listener);
                    }
                    if (listener != null) {
                        // Call the listener
                        var result = listener(event, params);
                        // Stop the propagation of the event if the listener returns false result
                        if (!result) {
                            return;
                        }
                    }
                });
            }
        }
    };
}

