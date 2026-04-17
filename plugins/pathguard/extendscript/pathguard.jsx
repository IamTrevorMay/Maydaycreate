// PathGuard ExtendScript module
// Runs inside Premiere Pro's scripting context (ES3)
// Loaded via $.evalFile() from the CEP panel at startup

var MaydayPathGuard = (function () {

    /**
     * Walk the project tree recursively and return all media items.
     * Each item includes nodeId, name, file path, and media type.
     *
     * @returns {string} JSON array of project items
     */
    function scanProject() {
        var project = app.project;
        if (!project) {
            return JSON.stringify({ error: "No project open" });
        }

        var items = [];
        var rootItem = project.rootItem;

        function walkItem(item) {
            // Skip the root item itself
            for (var i = 0; i < item.children.numItems; i++) {
                var child = item.children[i];

                if (child.type === ProjectItemType.BIN) {
                    // Recurse into bins (folders)
                    walkItem(child);
                } else if (child.type === ProjectItemType.CLIP || child.type === ProjectItemType.FILE) {
                    // Get the file path from the media source
                    var filePath = "";
                    var mediaType = "unknown";

                    try {
                        if (child.getMediaPath) {
                            filePath = child.getMediaPath();
                        }
                    } catch (e) {
                        // getMediaPath() can throw for offline media
                    }

                    // Determine media type from the project item
                    try {
                        if (child.isSequence && child.isSequence()) {
                            mediaType = "sequence";
                        } else if (filePath) {
                            var ext = filePath.replace(/^.*\./, "").toLowerCase();
                            if (/^(mp4|mov|avi|mkv|mxf|prproj)$/.test(ext)) {
                                mediaType = "video";
                            } else if (/^(wav|mp3|aac|aiff|flac|m4a)$/.test(ext)) {
                                mediaType = "audio";
                            } else if (/^(jpg|jpeg|png|tiff|tif|psd|ai|bmp|gif|svg)$/.test(ext)) {
                                mediaType = "image";
                            } else if (/^(mogrt|prfpset)$/.test(ext)) {
                                mediaType = "graphics";
                            }
                        }
                    } catch (e) {
                        // Type detection is best-effort
                    }

                    // Only include items with actual file paths (skip sequences, generated media)
                    if (filePath && mediaType !== "sequence") {
                        items.push({
                            nodeId: child.nodeId,
                            name: child.name,
                            filePath: filePath,
                            mediaType: mediaType
                        });
                    }
                }
            }
        }

        walkItem(rootItem);

        return JSON.stringify({
            projectPath: project.path,
            projectName: project.name,
            items: items,
            scannedAt: new Date().getTime()
        });
    }

    /**
     * Change a project item's media path to point at a symlink.
     * This is the critical operation — it tells Premiere to look at
     * the symlink path instead of the original file.
     *
     * @param {string} nodeId — the ProjectItem.nodeId to relink
     * @param {string} newPath — the symlink path to point to
     * @param {boolean} doRefresh — whether to call refreshMedia() after
     * @returns {string} JSON result
     */
    function changeMediaPath(nodeId, newPath, doRefresh) {
        var project = app.project;
        if (!project) {
            return JSON.stringify({ success: false, error: "No project open" });
        }

        // Find the project item by nodeId
        var item = findItemByNodeId(project.rootItem, nodeId);
        if (!item) {
            return JSON.stringify({ success: false, error: "Item not found: " + nodeId });
        }

        try {
            var result = item.changeMediaPath(newPath, false);
            // changeMediaPath returns true/false in some API versions,
            // undefined in others. We check for explicit false.
            if (result === false) {
                return JSON.stringify({ success: false, error: "changeMediaPath returned false" });
            }

            if (doRefresh) {
                try {
                    item.refreshMedia();
                } catch (refreshErr) {
                    // refreshMedia() may not exist in all Premiere versions
                    // Non-fatal — log but don't fail
                    return JSON.stringify({
                        success: true,
                        refreshed: false,
                        warning: "refreshMedia() failed: " + refreshErr.message
                    });
                }
            }

            return JSON.stringify({ success: true, refreshed: !!doRefresh });
        } catch (e) {
            return JSON.stringify({ success: false, error: e.message });
        }
    }

    /**
     * Get the current media path for a project item by nodeId.
     *
     * @param {string} nodeId
     * @returns {string} JSON with the current path
     */
    function getMediaPath(nodeId) {
        var project = app.project;
        if (!project) {
            return JSON.stringify({ error: "No project open" });
        }

        var item = findItemByNodeId(project.rootItem, nodeId);
        if (!item) {
            return JSON.stringify({ error: "Item not found: " + nodeId });
        }

        try {
            var path = item.getMediaPath ? item.getMediaPath() : "";
            return JSON.stringify({ nodeId: nodeId, filePath: path });
        } catch (e) {
            return JSON.stringify({ error: e.message });
        }
    }

    // --- Helpers ---

    /**
     * Recursively find a ProjectItem by its nodeId.
     */
    function findItemByNodeId(root, nodeId) {
        for (var i = 0; i < root.children.numItems; i++) {
            var child = root.children[i];
            if (child.nodeId === nodeId) return child;
            if (child.type === ProjectItemType.BIN) {
                var found = findItemByNodeId(child, nodeId);
                if (found) return found;
            }
        }
        return null;
    }

    return {
        scanProject: scanProject,
        changeMediaPath: changeMediaPath,
        getMediaPath: getMediaPath
    };

})();
