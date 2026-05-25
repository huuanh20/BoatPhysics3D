import { GAME_CONFIG } from '../core/config.js';

export class PlayerSyncSystem {
    constructor(channel, clientId) {
        this.channel = channel;
        this.clientId = clientId;
        this.lastPublishedZ = -9999;
        this.lastPublishedProgress = -1;
        this.lastPosPublish = 0;
    }

    shouldPublish(currentZ, currentProgress) {
        const now = performance.now();
        if (now - this.lastPosPublish < GAME_CONFIG.PUBLISH_INTERVAL_MS) return false;
        
        const zDiff = Math.abs(currentZ - this.lastPublishedZ);
        const progDiff = Math.abs(currentProgress - this.lastPublishedProgress);
        
        // Return true if moved significantly or progress changed
        return zDiff > 0.5 || progDiff > 0.01;
    }

    publishState(currentZ, currentProgress, score, color, name) {
        if (!this.channel) return;
        
        const payload = {
            clientId: this.clientId,
            name: name,
            z: currentZ,
            progress: currentProgress,
            score: score,
            color: color,
            timestamp: Date.now()
        };

        this.channel.publish("position", payload);
        this.lastPublishedZ = currentZ;
        this.lastPublishedProgress = currentProgress;
        this.lastPosPublish = performance.now();
    }
}
