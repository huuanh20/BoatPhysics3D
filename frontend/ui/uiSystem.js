export class UiSystemManager {
    constructor() {
        this.progressBar = document.getElementById("player-progress-bar");
        this.progressBoat = document.getElementById("player-progress-boat");
    }

    updateProgressBar(progress) {
        const pct = `${Math.round(progress * 100)}%`;
        if (this.progressBar) this.progressBar.style.width = pct;
        if (this.progressBoat) this.progressBoat.style.left = pct;
    }

    showOverlay(element, isVisible) {
        if (!element) return;
        if (isVisible) {
            element.style.opacity = "1";
            element.style.pointerEvents = "auto";
        } else {
            element.style.opacity = "0";
            element.style.pointerEvents = "none";
        }
    }
}
