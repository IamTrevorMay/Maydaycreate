// Bridge dispatcher — maps function calls from CEP to ExtendScript modules

var MaydayBridge = (function () {
    var modules = {
        "project": MaydayProject,
        "timeline": MaydayTimeline,
        "markers": MaydayMarkers,
        "effects": MaydayEffects,
        "sequence": MaydaySequence,
        "exports": MaydayExports,
        "preferences": MaydayPreferences
    };

    function callScript(moduleAndFn, argsJson) {
        return MaydayUtils.safeCall(function () {
            var parts = moduleAndFn.split(".");
            if (parts.length !== 2) {
                throw new Error("Invalid function format. Expected 'module.function', got: " + moduleAndFn);
            }

            var moduleName = parts[0];
            var fnName = parts[1];

            var mod = modules[moduleName];
            if (!mod) {
                throw new Error("Unknown module: " + moduleName);
            }

            var fn = mod[fnName];
            if (typeof fn !== "function") {
                throw new Error("Unknown function: " + moduleName + "." + fnName);
            }

            var args = [];
            if (argsJson && argsJson !== "" && argsJson !== "[]") {
                try {
                    args = JSON.parse(argsJson);
                } catch (parseErr) {
                    throw new Error("JSON.parse failed for " + moduleAndFn + ": " + String(argsJson).substring(0, 200));
                }
            }

            return fn.apply(null, args);
        });
    }

    return {
        callScript: callScript
    };
})();
