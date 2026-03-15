// Marker ExtendScript functions

var MaydayMarkers = (function () {
    var COLOR_MAP = {
        "green": 0,
        "red": 1,
        "purple": 2,
        "orange": 3,
        "yellow": 4,
        "white": 5,
        "blue": 6,
        "cyan": 7
    };

    var COLOR_REVERSE = ["green", "red", "purple", "orange", "yellow", "white", "blue", "cyan"];

    function getMarkers() {
        var seq = app.project.activeSequence;
        if (!seq) return [];

        var markers = seq.markers;
        var result = [];
        var marker = markers.getFirstMarker();

        while (marker) {
            result.push({
                id: MaydayUtils.generateId(),
                name: marker.name,
                start: MaydayUtils.ticksToSeconds(marker.start.ticks),
                end: MaydayUtils.ticksToSeconds(marker.end.ticks),
                type: marker.type,
                color: COLOR_REVERSE[marker.getColorByIndex()] || "green",
                comment: marker.comments || ""
            });
            marker = markers.getNextMarker(marker);
        }

        return result;
    }

    function addMarker(timeInSeconds, name, color, comment) {
        var seq = app.project.activeSequence;
        if (!seq) return false;

        var markers = seq.markers;
        var newMarker = markers.createMarker(timeInSeconds);
        newMarker.name = name || "Marker";

        if (color && COLOR_MAP[color] !== undefined) {
            newMarker.setColorByIndex(COLOR_MAP[color]);
        }

        if (comment) {
            newMarker.comments = comment;
        }

        return true;
    }

    function removeAllMarkers() {
        var seq = app.project.activeSequence;
        if (!seq) return false;

        var markers = seq.markers;
        while (markers.numMarkers > 0) {
            var marker = markers.getFirstMarker();
            markers.deleteMarker(marker);
        }
        return true;
    }

    return {
        getMarkers: getMarkers,
        addMarker: addMarker,
        removeAllMarkers: removeAllMarkers
    };
})();
