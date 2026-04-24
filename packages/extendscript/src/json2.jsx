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
            // Safe recursive-descent JSON parser (no eval)
            var at = 0;
            var ch = " ";
            var escapee = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

            function error(m) { throw new Error("JSON.parse: " + m + " at position " + at); }

            function next(c) {
                if (c && ch !== c) error("Expected '" + c + "' instead of '" + ch + "'");
                ch = text.charAt(at);
                at += 1;
                return ch;
            }

            function white() {
                while (ch && ch <= " ") next();
            }

            function number() {
                var s = "";
                if (ch === "-") { s = "-"; next("-"); }
                while (ch >= "0" && ch <= "9") { s += ch; next(); }
                if (ch === ".") {
                    s += ".";
                    while (next() && ch >= "0" && ch <= "9") { s += ch; }
                }
                if (ch === "e" || ch === "E") {
                    s += ch; next();
                    if (ch === "-" || ch === "+") { s += ch; next(); }
                    while (ch >= "0" && ch <= "9") { s += ch; next(); }
                }
                var n = +s;
                if (!isFinite(n)) error("Bad number");
                return n;
            }

            function string() {
                var s = "";
                if (ch === '"') {
                    while (next()) {
                        if (ch === '"') { next(); return s; }
                        if (ch === "\\") {
                            next();
                            if (ch === "u") {
                                var uffff = 0;
                                for (var i = 0; i < 4; i += 1) {
                                    var hex = parseInt(next(), 16);
                                    if (!isFinite(hex)) break;
                                    uffff = uffff * 16 + hex;
                                }
                                s += String.fromCharCode(uffff);
                            } else if (typeof escapee[ch] === "string") {
                                s += escapee[ch];
                            } else {
                                break;
                            }
                        } else {
                            s += ch;
                        }
                    }
                }
                error("Bad string");
            }

            function word() {
                switch (ch) {
                    case "t": next("t"); next("r"); next("u"); next("e"); return true;
                    case "f": next("f"); next("a"); next("l"); next("s"); next("e"); return false;
                    case "n": next("n"); next("u"); next("l"); next("l"); return null;
                }
                error("Unexpected '" + ch + "'");
            }

            function array() {
                var arr = [];
                if (ch === "[") {
                    next("[");
                    white();
                    if (ch === "]") { next("]"); return arr; }
                    while (ch) {
                        arr.push(value());
                        white();
                        if (ch === "]") { next("]"); return arr; }
                        next(",");
                        white();
                    }
                }
                error("Bad array");
            }

            function object() {
                var obj = {};
                if (ch === "{") {
                    next("{");
                    white();
                    if (ch === "}") { next("}"); return obj; }
                    while (ch) {
                        var key = string();
                        white();
                        next(":");
                        obj[key] = value();
                        white();
                        if (ch === "}") { next("}"); return obj; }
                        next(",");
                        white();
                    }
                }
                error("Bad object");
            }

            function value() {
                white();
                switch (ch) {
                    case "{": return object();
                    case "[": return array();
                    case '"': return string();
                    case "-": return number();
                    default: return (ch >= "0" && ch <= "9") ? number() : word();
                }
            }

            var result = value();
            white();
            if (ch) error("Unexpected trailing characters");
            return result;
        };
    }
})();
