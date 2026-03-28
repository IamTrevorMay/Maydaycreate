// Export ExtendScript functions (Excalibur ex operations)

var MaydayExports = (function () {

    function makeTimestamp() {
        var d = new Date();
        return d.getFullYear() + "" +
            (d.getMonth() + 1 < 10 ? "0" : "") + (d.getMonth() + 1) +
            (d.getDate() < 10 ? "0" : "") + d.getDate() + "_" +
            (d.getHours() < 10 ? "0" : "") + d.getHours() +
            (d.getMinutes() < 10 ? "0" : "") + d.getMinutes() +
            (d.getSeconds() < 10 ? "0" : "") + d.getSeconds();
    }

    function exportFrame(outputPath) {
        var seq = app.project.activeSequence;
        if (!seq) throw new Error("No active sequence");

        var time = seq.getPlayerPosition();
        if (!outputPath) {
            outputPath = Folder.desktop.fsName + "/Frame_" + makeTimestamp() + ".png";
        }
        seq.exportFramePNG(time, outputPath);
        return { path: outputPath };
    }

    function exportMedia(presetPath, outputPath) {
        var seq = app.project.activeSequence;
        if (!seq) throw new Error("No active sequence");

        if (presetPath && outputPath) {
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
        app.executeCommand(41056);
        return { dialog: true };
    }

    function exportSelectedClips() {
        app.executeCommand(41056);
        return { dialog: true };
    }

    return {
        exportFrame: exportFrame,
        exportMedia: exportMedia,
        exportSelectedClips: exportSelectedClips
    };
})();
