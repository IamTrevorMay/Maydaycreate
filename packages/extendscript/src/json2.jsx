// JSON2 polyfill for ExtendScript (ES3)
// Minimal JSON.parse/stringify for Premiere Pro scripting
if (typeof JSON === "undefined") {
    JSON = {};
}

(function () {
    "use strict";

    if (typeof JSON.stringify !== "function") {
        JSON.stringify = function (value) {
            if (value === null) return "null";
            if (value === undefined) return undefined;
            var type = typeof value;
            if (type === "number") {
                return isFinite(value) ? String(value) : "null";
            }
            if (type === "boolean") return String(value);
            if (type === "string") {
                return '"' + value.replace(/[\\\"\x00-\x1f]/g, function (ch) {
                    var map = { '"': '\\"', '\\': '\\\\', '\b': '\\b', '\f': '\\f', '\n': '\\n', '\r': '\\r', '\t': '\\t' };
                    return map[ch] || '\\u' + ('0000' + ch.charCodeAt(0).toString(16)).slice(-4);
                }) + '"';
            }
            if (value instanceof Array) {
                var arrResult = [];
                for (var i = 0; i < value.length; i++) {
                    arrResult.push(JSON.stringify(value[i]) || "null");
                }
                return "[" + arrResult.join(",") + "]";
            }
            if (type === "object") {
                var objResult = [];
                for (var key in value) {
                    if (value.hasOwnProperty(key)) {
                        var v = JSON.stringify(value[key]);
                        if (v !== undefined) {
                            objResult.push('"' + key + '":' + v);
                        }
                    }
                }
                return "{" + objResult.join(",") + "}";
            }
            return undefined;
        };
    }

    if (typeof JSON.parse !== "function") {
        JSON.parse = function (text) {
            return eval("(" + text + ")");
        };
    }
})();
