// Sequence-level ExtendScript functions (Excalibur sq operations)

var MaydaySequence = (function () {

    function razorAtPlayhead() {
        var seq = app.project.activeSequence;
        if (!seq) throw new Error("No active sequence");

        var qeSeq = qe.project.getActiveSequence(0);
        if (!qeSeq) throw new Error("No active QE sequence");
        var pos = seq.getPlayerPosition();
        qeSeq.razor(pos.ticks);
        return true;
    }

    function setInPoint() {
        var seq = app.project.activeSequence;
        if (!seq) throw new Error("No active sequence");
        var pos = seq.getPlayerPosition();
        seq.setInPoint(pos.ticks);
        return true;
    }

    function setOutPoint() {
        var seq = app.project.activeSequence;
        if (!seq) throw new Error("No active sequence");
        var pos = seq.getPlayerPosition();
        seq.setOutPoint(pos.ticks);
        return true;
    }

    function clearInOut() {
        // Use Premiere's menu command to properly clear in/out points
        app.executeCommand(41065);
        return true;
    }

    function goToInPoint() {
        var seq = app.project.activeSequence;
        if (!seq) throw new Error("No active sequence");
        var inTime = seq.getInPointAsTime();
        seq.setPlayerPosition(inTime.ticks);
        return true;
    }

    function goToOutPoint() {
        var seq = app.project.activeSequence;
        if (!seq) throw new Error("No active sequence");
        var outTime = seq.getOutPointAsTime();
        seq.setPlayerPosition(outTime.ticks);
        return true;
    }

    function liftSelection() {
        // seq.lift() does not exist — use Premiere menu command
        app.executeCommand(41088);
        return true;
    }

    function extractSelection() {
        // seq.extract() does not exist — use Premiere menu command
        app.executeCommand(41089);
        return true;
    }

    function nestSelection() {
        // Nest selected clips in-place via Premiere menu command
        // (seq.createSubsequenceFromSelection creates a separate sequence, not a nest)
        app.executeCommand(41066);
        return true;
    }

    function duplicateAndIncrement() {
        var seq = app.project.activeSequence;
        if (!seq) throw new Error("No active sequence");

        var cloneResult = seq.clone();
        if (!cloneResult) throw new Error("Failed to clone sequence");

        // Rename with increment
        var baseName = seq.name;
        var match = baseName.match(/^(.*?)(\d+)$/);
        var newName;
        if (match) {
            var num = parseInt(match[2], 10) + 1;
            var padded = String(num);
            while (padded.length < match[2].length) padded = "0" + padded;
            newName = match[1] + padded;
        } else {
            newName = baseName + " 2";
        }

        // Find the clone and rename it (search from end — most recently added)
        var items = app.project.rootItem.children;
        for (var i = items.numItems - 1; i >= 0; i--) {
            var item = items[i];
            if (item.name === baseName && item.type === 1) {
                item.name = newName;
                break;
            }
        }

        return { original: baseName, duplicate: newName };
    }

    function openSequenceByName(name) {
        var project = app.project;
        for (var i = 0; i < project.sequences.numSequences; i++) {
            var seq = project.sequences[i];
            if (seq.name === name) {
                project.openSequence(seq.sequenceID);
                return true;
            }
        }
        throw new Error("Sequence not found: " + name);
    }

    function addMarkerAtPlayhead(name, color) {
        var seq = app.project.activeSequence;
        if (!seq) throw new Error("No active sequence");
        var pos = MaydayUtils.ticksToSeconds(seq.getPlayerPosition().ticks);
        var marker = seq.markers.createMarker(pos);
        if (name) marker.name = name;
        if (color !== undefined) marker.setColorByIndex(color);
        return true;
    }

    function renderInToOut() {
        var seq = app.project.activeSequence;
        if (!seq) throw new Error("No active sequence");
        seq.renderAll();
        return true;
    }

    function zoomToSequence() {
        var qeSeq = qe.project.getActiveSequence(0);
        if (!qeSeq) throw new Error("No active sequence");
        qeSeq.setZoomValue("0");
        return true;
    }

    function selectAll() {
        var seq = app.project.activeSequence;
        if (!seq) throw new Error("No active sequence");
        var i, t, c;
        for (i = 0; i < seq.videoTracks.numTracks; i++) {
            t = seq.videoTracks[i];
            for (c = 0; c < t.clips.numItems; c++) {
                t.clips[c].setSelected(true, true);
            }
        }
        for (i = 0; i < seq.audioTracks.numTracks; i++) {
            t = seq.audioTracks[i];
            for (c = 0; c < t.clips.numItems; c++) {
                t.clips[c].setSelected(true, true);
            }
        }
        return true;
    }

    function deselectAll() {
        var seq = app.project.activeSequence;
        if (!seq) throw new Error("No active sequence");
        var i, t, c;
        for (i = 0; i < seq.videoTracks.numTracks; i++) {
            t = seq.videoTracks[i];
            for (c = 0; c < t.clips.numItems; c++) {
                t.clips[c].setSelected(false, true);
            }
        }
        for (i = 0; i < seq.audioTracks.numTracks; i++) {
            t = seq.audioTracks[i];
            for (c = 0; c < t.clips.numItems; c++) {
                t.clips[c].setSelected(false, true);
            }
        }
        return true;
    }

    function undo() {
        // app.project.undo() does not exist — use Premiere menu command
        app.executeCommand(41000);
        return true;
    }

    function executeCommand(commandId) {
        app.executeCommand(commandId);
        return true;
    }

    return {
        razorAtPlayhead: razorAtPlayhead,
        setInPoint: setInPoint,
        setOutPoint: setOutPoint,
        clearInOut: clearInOut,
        goToInPoint: goToInPoint,
        goToOutPoint: goToOutPoint,
        liftSelection: liftSelection,
        extractSelection: extractSelection,
        nestSelection: nestSelection,
        duplicateAndIncrement: duplicateAndIncrement,
        openSequenceByName: openSequenceByName,
        addMarkerAtPlayhead: addMarkerAtPlayhead,
        renderInToOut: renderInToOut,
        zoomToSequence: zoomToSequence,
        selectAll: selectAll,
        deselectAll: deselectAll,
        undo: undo,
        executeCommand: executeCommand
    };
})();
