// Export ExtendScript functions (Excalibur ex operations)

var MaydayExports = (function () {

    function exportFrame(outputPath) {
        var seq = app.project.activeSequence;
        if (!seq) throw new Error("No active sequence");

        // Export current frame as PNG
        var time = seq.getPlayerPosition();
        if (!outputPath) {
            // Default to desktop with timestamp
            var d = new Date();
            var stamp = d.getFullYear() + "" +
                (d.getMonth() + 1 < 10 ? "0" : "") + (d.getMonth() + 1) +
                (d.getDate() < 10 ? "0" : "") + d.getDate() + "_" +
                (d.getHours() < 10 ? "0" : "") + d.getHours() +
                (d.getMinutes() < 10 ? "0" : "") + d.getMinutes() +
                (d.getSeconds() < 10 ? "0" : "") + d.getSeconds();
            outputPath = Folder.desktop.fsName + "/Frame_" + stamp + ".png";
        }
        seq.exportFramePNG(time, outputPath);
        return { path: outputPath };
    }

    function exportFrameJPEG(outputPath) {
        var seq = app.project.activeSequence;
        if (!seq) throw new Error("No active sequence");

        var time = seq.getPlayerPosition();
        if (!outputPath) {
            var d = new Date();
            var stamp = d.getFullYear() + "" +
                (d.getMonth() + 1 < 10 ? "0" : "") + (d.getMonth() + 1) +
                (d.getDate() < 10 ? "0" : "") + d.getDate() + "_" +
                (d.getHours() < 10 ? "0" : "") + d.getHours() +
                (d.getMinutes() < 10 ? "0" : "") + d.getMinutes() +
                (d.getSeconds() < 10 ? "0" : "") + d.getSeconds();
            outputPath = Folder.desktop.fsName + "/Frame_" + stamp + ".jpg";
        }
        seq.exportFrameJPEG(time, outputPath);
        return { path: outputPath };
    }

    function exportMedia(presetPath, outputPath) {
        var seq = app.project.activeSequence;
        if (!seq) throw new Error("No active sequence");

        if (presetPath && outputPath) {
            // Direct encode via Adobe Media Encoder
            var encoder = app.encoder;
            encoder.launchEncoder();
            encoder.encodeSequence(
                seq,
                outputPath,
                presetPath,
                1, // WorkArea: 0=InToOut, 1=EntireSequence
                true // removeOnCompletion
            );
            encoder.startBatch();
            return { queued: true, output: outputPath };
        }

        // No preset/output specified — open export dialog
        // This is done via Premiere's internal command
        app.executeCommand(41056); // File > Export > Media
        return { dialog: true };
    }

    function exportSelectedClips() {
        // Export only selected clips — opens export dialog with selection
        app.executeCommand(41056); // File > Export > Media
        return { dialog: true };
    }

    return {
        exportFrame: exportFrame,
        exportFrameJPEG: exportFrameJPEG,
        exportMedia: exportMedia,
        exportSelectedClips: exportSelectedClips
    };
})();
