// Effects capture & application ExtendScript functions

var MaydayEffects = (function () {
    // Intrinsic components on video clips: Motion (0), Opacity (1), Time Remapping (2)
    var INTRINSIC_COUNT_VIDEO = 3;

    function readKeyframes(prop) {
        if (!prop.isTimeVarying()) return null;
        var kfs = [];
        for (var i = 0; i < prop.getKeys().length; i++) {
            var time = prop.getKeys()[i];
            kfs.push({
                time: MaydayUtils.ticksToSeconds(time.ticks),
                value: prop.getValueAtKey(time)
            });
        }
        return kfs;
    }

    function readComponentProperties(component) {
        var props = [];
        for (var p = 0; p < component.properties.numItems; p++) {
            var prop = component.properties[p];
            try {
                var entry = {
                    displayName: prop.displayName,
                    matchName: prop.matchName || "",
                    type: 0,
                    value: null,
                    keyframes: null
                };

                if (prop.displayName === "" || prop.displayName === undefined) continue;

                try {
                    entry.value = prop.getValue();
                    entry.type = typeof entry.value === "number" ? 2 : 1;
                } catch (e) {
                    // Some properties are not readable
                    entry.value = null;
                }

                try {
                    entry.keyframes = readKeyframes(prop);
                } catch (e) {
                    // Not all properties support keyframes
                }

                props.push(entry);
            } catch (e) {
                // Skip unreadable properties
            }
        }
        return props;
    }

    function captureEffects(trackIndex, clipIndex, trackType) {
        var seq = app.project.activeSequence;
        if (!seq) throw new Error("No active sequence");

        var tracks = trackType === "audio" ? seq.audioTracks : seq.videoTracks;
        if (trackIndex >= tracks.numTracks) throw new Error("Track index out of range");

        var track = tracks[trackIndex];
        if (clipIndex >= track.clips.numItems) throw new Error("Clip index out of range");

        var clip = track.clips[clipIndex];
        var effects = [];
        var intrinsicCount = trackType === "audio" ? 0 : INTRINSIC_COUNT_VIDEO;

        for (var c = 0; c < clip.components.numItems; c++) {
            var component = clip.components[c];
            var isIntrinsic = c < intrinsicCount;

            effects.push({
                displayName: component.displayName,
                matchName: component.matchName || "",
                index: c,
                isIntrinsic: isIntrinsic,
                properties: readComponentProperties(component)
            });
        }

        return {
            clipName: clip.name,
            trackType: trackType || "video",
            capturedAt: new Date().toISOString(),
            effects: effects
        };
    }

    function getSelectedClipInfo() {
        var seq = app.project.activeSequence;
        if (!seq) return null;

        // Check video tracks first, then audio
        var trackSets = [
            { tracks: seq.videoTracks, type: "video" },
            { tracks: seq.audioTracks, type: "audio" }
        ];

        for (var s = 0; s < trackSets.length; s++) {
            var trackSet = trackSets[s];
            for (var t = 0; t < trackSet.tracks.numTracks; t++) {
                var track = trackSet.tracks[t];
                for (var c = 0; c < track.clips.numItems; c++) {
                    var clip = track.clips[c];
                    if (clip.isSelected()) {
                        return {
                            trackIndex: t,
                            clipIndex: c,
                            trackType: trackSet.type,
                            clipName: clip.name
                        };
                    }
                }
            }
        }

        return null;
    }

    function captureFromSelected() {
        var info = getSelectedClipInfo();
        if (!info) throw new Error("No clip selected");
        return captureEffects(info.trackIndex, info.clipIndex, info.trackType);
    }

    function findEffectInQE(qeClip, displayName) {
        // QE DOM provides addVideoEffect/removeVideoEffect
        // Search through effects to find by name
        for (var i = 0; i < qeClip.numComponents; i++) {
            var comp = qeClip.getComponentAt(i);
            if (comp.name === displayName) return comp;
        }
        return null;
    }

    function setPropertyValues(component, properties) {
        for (var p = 0; p < properties.length; p++) {
            var propDef = properties[p];
            if (propDef.value === null || propDef.value === undefined) continue;

            for (var cp = 0; cp < component.properties.numItems; cp++) {
                var prop = component.properties[cp];
                if (prop.displayName === propDef.displayName ||
                    (propDef.matchName && prop.matchName === propDef.matchName)) {
                    try {
                        prop.setValue(propDef.value, true);
                    } catch (e) {
                        // Some properties can't be set
                    }
                    break;
                }
            }
        }
    }

    function setKeyframes(component, properties) {
        for (var p = 0; p < properties.length; p++) {
            var propDef = properties[p];
            if (!propDef.keyframes || propDef.keyframes.length === 0) continue;

            for (var cp = 0; cp < component.properties.numItems; cp++) {
                var prop = component.properties[cp];
                if (prop.displayName === propDef.displayName ||
                    (propDef.matchName && prop.matchName === propDef.matchName)) {
                    try {
                        // Enable time-varying
                        prop.setTimeVarying(true);
                        for (var k = 0; k < propDef.keyframes.length; k++) {
                            var kf = propDef.keyframes[k];
                            var timeTicks = MaydayUtils.secondsToTicks(kf.time);
                            prop.addKey(timeTicks);
                            prop.setValueAtKey(timeTicks, kf.value);
                        }
                    } catch (e) {
                        // Not all properties support keyframes
                    }
                    break;
                }
            }
        }
    }

    function applyEffects(trackIndex, clipIndex, trackType, effectsJson) {
        var seq = app.project.activeSequence;
        if (!seq) throw new Error("No active sequence");

        var tracks = trackType === "audio" ? seq.audioTracks : seq.videoTracks;
        if (trackIndex >= tracks.numTracks) throw new Error("Track index out of range");

        var track = tracks[trackIndex];
        if (clipIndex >= track.clips.numItems) throw new Error("Clip index out of range");

        var clip = track.clips[clipIndex];
        var effects = JSON.parse(effectsJson);
        var applied = [];
        var skipped = [];
        var errors = [];

        // Enable QE DOM
        var qeProj = qe.project;
        var qeSeq = qeProj.getActiveSequence(0);

        for (var e = 0; e < effects.length; e++) {
            var effectDef = effects[e];

            try {
                if (effectDef.isIntrinsic) {
                    // Update intrinsic effect properties in-place
                    var found = false;
                    for (var c = 0; c < clip.components.numItems; c++) {
                        var comp = clip.components[c];
                        if (comp.displayName === effectDef.displayName) {
                            setPropertyValues(comp, effectDef.properties);
                            setKeyframes(comp, effectDef.properties);
                            applied.push(effectDef.displayName);
                            found = true;
                            break;
                        }
                    }
                    if (!found) skipped.push(effectDef.displayName);
                } else {
                    // Add non-intrinsic effect via QE DOM
                    var qeTrack = trackType === "audio"
                        ? qeSeq.getAudioTrackAt(trackIndex)
                        : qeSeq.getVideoTrackAt(trackIndex);
                    var qeClip = qeTrack.getItemAt(clipIndex);

                    var addResult = qeClip.addVideoEffect(qe.project.getVideoEffectByName(effectDef.displayName));
                    if (addResult) {
                        // Find the newly added component in scripting DOM and set properties
                        var newComp = null;
                        for (var nc = 0; nc < clip.components.numItems; nc++) {
                            if (clip.components[nc].displayName === effectDef.displayName) {
                                newComp = clip.components[nc];
                            }
                        }
                        if (newComp) {
                            setPropertyValues(newComp, effectDef.properties);
                            setKeyframes(newComp, effectDef.properties);
                        }
                        applied.push(effectDef.displayName);
                    } else {
                        errors.push("Failed to add: " + effectDef.displayName);
                    }
                }
            } catch (ex) {
                errors.push(effectDef.displayName + ": " + String(ex));
            }
        }

        return { applied: applied, skipped: skipped, errors: errors };
    }

    function removeAllEffects(trackIndex, clipIndex, trackType) {
        var seq = app.project.activeSequence;
        if (!seq) throw new Error("No active sequence");

        var tracks = trackType === "audio" ? seq.audioTracks : seq.videoTracks;
        if (trackIndex >= tracks.numTracks) throw new Error("Track index out of range");

        var track = tracks[trackIndex];
        if (clipIndex >= track.clips.numItems) throw new Error("Clip index out of range");

        var clip = track.clips[clipIndex];
        var intrinsicCount = trackType === "audio" ? 0 : INTRINSIC_COUNT_VIDEO;

        // Remove from last to first to avoid index shifting
        for (var c = clip.components.numItems - 1; c >= intrinsicCount; c--) {
            try {
                clip.components[c].remove();
            } catch (e) {
                // Some components may resist removal
            }
        }

        return true;
    }

    function listAvailableEffects() {
        var effects = [];
        try {
            var qeProj = qe.project;
            // QE DOM allows iteration of video effects
            var numEffects = qeProj.numVideoEffects;
            for (var i = 0; i < numEffects; i++) {
                var effect = qeProj.getVideoEffectAt(i);
                if (effect && effect.name) {
                    effects.push(effect.name);
                }
            }
        } catch (e) {
            // QE DOM may not be available
        }
        return effects;
    }

    return {
        captureEffects: captureEffects,
        getSelectedClipInfo: getSelectedClipInfo,
        captureFromSelected: captureFromSelected,
        applyEffects: applyEffects,
        removeAllEffects: removeAllEffects,
        listAvailableEffects: listAvailableEffects
    };
})();
