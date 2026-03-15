// Utility functions for ExtendScript

var MaydayUtils = (function () {
    function ticksToSeconds(ticks, ticksPerSecond) {
        if (!ticksPerSecond) {
            ticksPerSecond = 254016000000;
        }
        return Number(ticks) / ticksPerSecond;
    }

    function secondsToTicks(seconds, ticksPerSecond) {
        if (!ticksPerSecond) {
            ticksPerSecond = 254016000000;
        }
        return Math.round(seconds * ticksPerSecond);
    }

    function generateId() {
        var chars = "abcdefghijklmnopqrstuvwxyz0123456789";
        var id = "";
        for (var i = 0; i < 12; i++) {
            id += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return id;
    }

    function safeCall(fn) {
        try {
            var result = fn();
            return JSON.stringify({ success: true, data: result });
        } catch (e) {
            return JSON.stringify({ success: false, error: String(e) });
        }
    }

    return {
        ticksToSeconds: ticksToSeconds,
        secondsToTicks: secondsToTicks,
        generateId: generateId,
        safeCall: safeCall
    };
})();
