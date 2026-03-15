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

    return {
        getProjectInfo: getProjectInfo,
        getSequenceList: getSequenceList,
        getActiveSequenceId: getActiveSequenceId,
        importFile: importFile
    };
})();
