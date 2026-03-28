// Preferences toggle ExtendScript functions (Excalibur pf operations)

var MaydayPreferences = (function () {

    // Premiere Pro menu command IDs for preference toggles
    // These IDs are for Premiere Pro 2025/2026 — may vary by version
    var COMMAND_IDS = {
        "Snap playhead in Timeline": 41141,
        "Snap in Timeline": 41141,
        "Snap": 41141,
        "Selection Follows Playhead": 41018,
        "Linked Selection": 41075,
        "Display Color Management": 41232,
        "Show Through Edits": 41162,
        "Show Duplicate Frame Markers": 41163,
        "Composite Preview During Trim": 41188,
        "Show Audio Time Units": 41017
    };

    function toggle(preferenceName) {
        var cmdId = COMMAND_IDS[preferenceName];
        if (cmdId) {
            app.executeCommand(cmdId);
            return { toggled: preferenceName };
        }

        // Fallback: try the name as a direct command ID (number)
        var numId = parseInt(preferenceName, 10);
        if (!isNaN(numId)) {
            app.executeCommand(numId);
            return { toggled: "command:" + numId };
        }

        throw new Error("Unknown preference: " + preferenceName);
    }

    return {
        toggle: toggle
    };
})();
