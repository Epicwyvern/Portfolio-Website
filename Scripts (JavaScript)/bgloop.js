(function back_loop () {
    var vidElem = document.getElementById('back');
    vidElem.addEventListener("timeupdate", function () {
        if (vidElem.currentTime >= 9.7) {
            vidElem.currentTime = 4.4;
            vidElem.play();
        }
    }, false);
})();