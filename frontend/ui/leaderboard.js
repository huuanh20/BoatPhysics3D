export class LeaderboardRenderer {
    constructor() {
        this.leaderboardList = document.getElementById("leaderboard-list");
    }

    render(playersList) {
        if (!this.leaderboardList) return;
        
        // Clear and rebuild dynamically
        this.leaderboardList.innerHTML = "";
        
        playersList.forEach((p, idx) => {
            const row = document.createElement("div");
            row.className = "leader-row";
            row.style.borderLeft = `4px solid ${p.color}`;
            const pct = Math.round((p.progress || 0) * 100);
            
            row.innerHTML = `
                <div class="leader-meta">
                    <div class="leader-name">
                        <span class="player-rank-num">${idx + 1}.</span>
                        <span class="player-boat-icon" style="color: ${p.color};">⛵</span>
                        <span class="player-name-text">${p.name}</span>
                    </div>
                    <div class="leader-percent">${pct}%</div>
                </div>
                <div class="leader-progress-track">
                    <div class="leader-progress-bar" style="width: ${pct}%; background: ${p.color}; box-shadow: 0 0 8px ${p.color};"></div>
                </div>
            `;
            this.leaderboardList.appendChild(row);
        });
    }
}
