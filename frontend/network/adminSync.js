export class AdminSyncSystem {
    constructor(channel, onPlayerUpdatedCallback) {
        this.channel = channel;
        this.onPlayerUpdated = onPlayerUpdatedCallback;
    }

    startListening() {
        if (!this.channel) return;
        
        this.channel.subscribe("position", (message) => {
            const data = message.data;
            if (this.onPlayerUpdated) {
                this.onPlayerUpdated(data);
            }
        });
    }

    stopListening() {
        if (this.channel) {
            this.channel.unsubscribe("position");
        }
    }
}
