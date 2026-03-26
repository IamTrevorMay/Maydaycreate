// Timeline/Sequence ExtendScript functions

var MaydayTimeline = (function () {
    function getActiveSequence() {
        var seq = app.project.activeSequence;
        if (!seq) return null;

        var tps = seq.timebase;
        return {
            id: MaydayUtils.generateId(),
            name: seq.name,
            sequenceId: seq.sequenceID,
            frameSizeHorizontal: seq.frameSizeHorizontal,
            frameSizeVertical: seq.frameSizeVertical,
            frameRate: Number(tps),
            duration: MaydayUtils.ticksToSeconds(seq.end),
            inPoint: MaydayUtils.ticksToSeconds(seq.getInPointAsTime().ticks),
            outPoint: MaydayUtils.ticksToSeconds(seq.getOutPointAsTime().ticks),
            zeroPoint: MaydayUtils.ticksToSeconds(seq.zeroPoint),
            videoTracks: getTracksInfo(seq.videoTracks, "video"),
            audioTracks: getTracksInfo(seq.audioTracks, "audio")
        };
    }

    function getTracksInfo(tracks, trackType) {
        var result = [];
        for (var i = 0; i < tracks.numTracks; i++) {
            var track = tracks[i];
            result.push({
                index: i,
                name: track.name,
                type: trackType,
                muted: track.isMuted(),
                locked: track.isLocked(),
                clips: getClipsFromTrack(track, i, trackType)
            });
        }
        return result;
    }

    function getClipsFromTrack(track, trackIndex, trackType) {
        var clips = [];
        for (var j = 0; j < track.clips.numItems; j++) {
            var clip = track.clips[j];
            clips.push({
                id: MaydayUtils.generateId(),
                name: clip.name,
                mediaPath: clip.projectItem ? clip.projectItem.getMediaPath() : "",
                trackIndex: trackIndex,
                trackType: trackType,
                start: MaydayUtils.ticksToSeconds(clip.start.ticks),
                end: MaydayUtils.ticksToSeconds(clip.end.ticks),
                duration: MaydayUtils.ticksToSeconds(clip.duration.ticks),
                inPoint: MaydayUtils.ticksToSeconds(clip.inPoint.ticks),
                outPoint: MaydayUtils.ticksToSeconds(clip.outPoint.ticks),
                speed: clip.getSpeed(),
                enabled: clip.enabled
            });
        }
        return clips;
    }

    function getClips(trackIndex, trackType) {
        var seq = app.project.activeSequence;
        if (!seq) return [];

        var tracks = trackType === "audio" ? seq.audioTracks : seq.videoTracks;
        if (trackIndex !== undefined && trackIndex !== null) {
            if (trackIndex < tracks.numTracks) {
                return getClipsFromTrack(tracks[trackIndex], trackIndex, trackType || "video");
            }
            return [];
        }

        var allClips = [];
        for (var i = 0; i < tracks.numTracks; i++) {
            var trackClips = getClipsFromTrack(tracks[i], i, trackType || "video");
            for (var j = 0; j < trackClips.length; j++) {
                allClips.push(trackClips[j]);
            }
        }
        return allClips;
    }

    function removeClip(trackIndex, clipIndex, trackType) {
        var seq = app.project.activeSequence;
        if (!seq) return false;

        var tracks = trackType === "audio" ? seq.audioTracks : seq.videoTracks;
        if (trackIndex >= tracks.numTracks) return false;

        var track = tracks[trackIndex];
        if (clipIndex >= track.clips.numItems) return false;

        track.clips[clipIndex].remove(true, true);
        return true;
    }

    function setClipInOutPoints(trackIndex, clipIndex, trackType, inPoint, outPoint) {
        var seq = app.project.activeSequence;
        if (!seq) return false;

        var tracks = trackType === "audio" ? seq.audioTracks : seq.videoTracks;
        if (trackIndex >= tracks.numTracks) return false;

        var track = tracks[trackIndex];
        if (clipIndex >= track.clips.numItems) return false;

        var clip = track.clips[clipIndex];
        clip.inPoint = new Time();
        clip.inPoint.ticks = MaydayUtils.secondsToTicks(inPoint);
        clip.outPoint = new Time();
        clip.outPoint.ticks = MaydayUtils.secondsToTicks(outPoint);
        return true;
    }

    function splitClip(trackIndex, clipIndex, trackType, splitTimeSeconds) {
        var seq = app.project.activeSequence;
        if (!seq) return false;

        var tracks = trackType === "audio" ? seq.audioTracks : seq.videoTracks;
        if (trackIndex >= tracks.numTracks) return false;

        var track = tracks[trackIndex];
        if (clipIndex >= track.clips.numItems) return false;

        var clip = track.clips[clipIndex];
        var splitTicks = MaydayUtils.secondsToTicks(splitTimeSeconds);

        // Validate split point is within clip boundaries
        var clipStartTicks = Number(clip.start.ticks);
        var clipEndTicks = Number(clip.end.ticks);
        if (splitTicks <= clipStartTicks || splitTicks >= clipEndTicks) return false;

        // Store original values before trimming
        var originalInPointTicks = Number(clip.inPoint.ticks);
        var originalOutPointTicks = Number(clip.outPoint.ticks);
        var projectItem = clip.projectItem;
        if (!projectItem) return false;

        // Calculate the media in-point offset for the right half
        var offsetTicks = splitTicks - clipStartTicks;
        var rightInPointTicks = originalInPointTicks + offsetTicks;

        // Trim original clip's out point to the split time (left half)
        clip.outPoint = new Time();
        clip.outPoint.ticks = originalInPointTicks + offsetTicks;

        // Insert the same project item at the split point (right half)
        track.insertClip(projectItem, splitTicks.toString());

        // Find the newly inserted clip (should be at clipIndex + 1)
        var newClipIndex = clipIndex + 1;
        if (newClipIndex < track.clips.numItems) {
            var newClip = track.clips[newClipIndex];
            newClip.inPoint = new Time();
            newClip.inPoint.ticks = rightInPointTicks;
            newClip.outPoint = new Time();
            newClip.outPoint.ticks = originalOutPointTicks;
        }

        return true;
    }

    function insertClip(trackIndex, trackType, projectItemPath, timeInSeconds) {
        var seq = app.project.activeSequence;
        if (!seq) return false;

        var tracks = trackType === "audio" ? seq.audioTracks : seq.videoTracks;
        if (trackIndex >= tracks.numTracks) return false;

        var projectItem = findProjectItemByPath(app.project.rootItem, projectItemPath);
        if (!projectItem) return false;

        var track = tracks[trackIndex];
        var ticks = MaydayUtils.secondsToTicks(timeInSeconds);
        track.insertClip(projectItem, ticks.toString());
        return true;
    }

    function overwriteClip(trackIndex, trackType, projectItemPath, timeInSeconds) {
        var seq = app.project.activeSequence;
        if (!seq) return false;

        var tracks = trackType === "audio" ? seq.audioTracks : seq.videoTracks;
        if (trackIndex >= tracks.numTracks) return false;

        var projectItem = findProjectItemByPath(app.project.rootItem, projectItemPath);
        if (!projectItem) return false;

        var track = tracks[trackIndex];
        var ticks = MaydayUtils.secondsToTicks(timeInSeconds);
        track.overwriteClip(projectItem, ticks.toString());
        return true;
    }

    function rippleDelete(trackIndex, clipIndex, trackType) {
        var seq = app.project.activeSequence;
        if (!seq) return false;

        var tracks = trackType === "audio" ? seq.audioTracks : seq.videoTracks;
        if (trackIndex >= tracks.numTracks) return false;

        var track = tracks[trackIndex];
        if (clipIndex >= track.clips.numItems) return false;

        // remove(inRipple=true, inAlignToVideo=true)
        track.clips[clipIndex].remove(true, true);
        return true;
    }

    function liftClip(trackIndex, clipIndex, trackType) {
        var seq = app.project.activeSequence;
        if (!seq) return false;

        var tracks = trackType === "audio" ? seq.audioTracks : seq.videoTracks;
        if (trackIndex >= tracks.numTracks) return false;

        var track = tracks[trackIndex];
        if (clipIndex >= track.clips.numItems) return false;

        // remove(inRipple=false, inAlignToVideo=true) — leaves gap
        track.clips[clipIndex].remove(false, true);
        return true;
    }

    function setClipEnabled(trackIndex, clipIndex, trackType, enabled) {
        var seq = app.project.activeSequence;
        if (!seq) return false;

        var tracks = trackType === "audio" ? seq.audioTracks : seq.videoTracks;
        if (trackIndex >= tracks.numTracks) return false;

        var track = tracks[trackIndex];
        if (clipIndex >= track.clips.numItems) return false;

        track.clips[clipIndex].enabled = enabled;
        return true;
    }

    function getProjectBinItems() {
        var items = [];
        collectProjectItems(app.project.rootItem, "", items);
        return items;
    }

    function findProjectItemByPath(rootItem, mediaPath) {
        for (var i = 0; i < rootItem.children.numItems; i++) {
            var child = rootItem.children[i];
            if (child.type === 2) {
                // Bin — recurse
                var found = findProjectItemByPath(child, mediaPath);
                if (found) return found;
            } else if (child.type === 1) {
                // Clip
                try {
                    if (child.getMediaPath() === mediaPath) return child;
                } catch (e) { /* skip items without media */ }
            }
        }
        return null;
    }

    function collectProjectItems(rootItem, parentPath, results) {
        for (var i = 0; i < rootItem.children.numItems; i++) {
            var child = rootItem.children[i];
            var itemPath = parentPath ? parentPath + "/" + child.name : child.name;
            if (child.type === 2) {
                // Bin
                results.push({ name: child.name, path: itemPath, type: "bin", mediaPath: "" });
                collectProjectItems(child, itemPath, results);
            } else if (child.type === 1) {
                // Clip
                var mediaPath = "";
                try { mediaPath = child.getMediaPath(); } catch (e) {}
                results.push({ name: child.name, path: itemPath, type: "clip", mediaPath: mediaPath });
            }
        }
    }

    function getPlayheadPosition() {
        var seq = app.project.activeSequence;
        if (!seq) return 0;
        return MaydayUtils.ticksToSeconds(seq.getPlayerPosition().ticks);
    }

    function setPlayheadPosition(seconds) {
        var seq = app.project.activeSequence;
        if (!seq) return false;
        seq.setPlayerPosition(MaydayUtils.secondsToTicks(seconds).toString());
        return true;
    }

    function duplicateSequence() {
        var seq = app.project.activeSequence;
        if (!seq) return null;

        // Clone the active sequence via the project API
        var cloneResult = seq.clone();
        if (!cloneResult) return null;

        // The cloned sequence becomes the last item in the project root
        // Rename it to include " — Backup"
        var items = app.project.rootItem.children;
        for (var i = items.numItems - 1; i >= 0; i--) {
            var item = items[i];
            if (item.type === 1 && item.name === seq.name) {
                // This is the clone (same name, just added)
                item.name = seq.name + " \u2014 Backup";
                break;
            }
        }

        // Open the backup so user can see it, then switch back to original
        app.project.openSequence(cloneResult.sequenceID || seq.sequenceID);

        return {
            originalName: seq.name,
            backupName: seq.name + " \u2014 Backup"
        };
    }

    function nestSelection() {
        var seq = app.project.activeSequence;
        if (!seq) return false;

        // Premiere's built-in nest command for the current selection
        try {
            var result = seq.createSubsequenceFromSelection();
            return result ? true : false;
        } catch (e) {
            return false;
        }
    }

    return {
        getActiveSequence: getActiveSequence,
        getClips: getClips,
        removeClip: removeClip,
        setClipInOutPoints: setClipInOutPoints,
        getPlayheadPosition: getPlayheadPosition,
        setPlayheadPosition: setPlayheadPosition,
        splitClip: splitClip,
        insertClip: insertClip,
        overwriteClip: overwriteClip,
        rippleDelete: rippleDelete,
        liftClip: liftClip,
        setClipEnabled: setClipEnabled,
        getProjectBinItems: getProjectBinItems,
        duplicateSequence: duplicateSequence,
        nestSelection: nestSelection
    };
})();
