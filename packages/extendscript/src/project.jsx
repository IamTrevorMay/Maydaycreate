// Project-level ExtendScript functions

var MaydayProject = (function () {
    function getProjectInfo() {
        var project = app.project;
        if (!project) return null;

        return {
            name: project.name,
            path: project.path,
            sequences: getSequenceList()
        };
    }

    function getSequenceList() {
        var project = app.project;
        var sequences = [];
        for (var i = 0; i < project.sequences.numSequences; i++) {
            var seq = project.sequences[i];
            sequences.push({
                id: MaydayUtils.generateId(),
                name: seq.name,
                sequenceId: seq.sequenceID
            });
        }
        return sequences;
    }

    function getActiveSequenceId() {
        var seq = app.project.activeSequence;
        if (!seq) return null;
        return seq.sequenceID;
    }

    function importFile(filePath) {
        var success = app.project.importFiles([filePath]);
        return success;
    }

    function incrementAndSave() {
        var project = app.project;
        if (!project) throw new Error("No project open");

        var currentPath = project.path;
        if (!currentPath) throw new Error("Project has no path (never saved)");

        // Parse current filename and increment
        var file = new File(currentPath);
        var folder = file.parent;
        var name = file.displayName.replace(/\.[^.]+$/, ""); // strip extension
        var ext = file.displayName.match(/\.[^.]+$/);
        ext = ext ? ext[0] : ".prproj";

        // Find trailing number and increment
        var match = name.match(/^(.*?)(\d+)$/);
        var newName;
        if (match) {
            var num = parseInt(match[2], 10) + 1;
            var padded = String(num);
            while (padded.length < match[2].length) padded = "0" + padded;
            newName = match[1] + padded;
        } else {
            newName = name + " 2";
        }

        var newPath = folder.fsName + "/" + newName + ext;
        project.saveAs(newPath);
        return { saved: newPath };
    }

    function executeScript(scriptPath) {
        // Execute an external ExtendScript file
        var file = new File(scriptPath);
        if (!file.exists) throw new Error("Script not found: " + scriptPath);
        $.evalFile(file);
        return true;
    }

    return {
        getProjectInfo: getProjectInfo,
        getSequenceList: getSequenceList,
        getActiveSequenceId: getActiveSequenceId,
        importFile: importFile,
        incrementAndSave: incrementAndSave,
        executeScript: executeScript
    };
})();
