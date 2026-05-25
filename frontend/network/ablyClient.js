// Ably Client Core Wrapper for Realtime Synchronization
export class AblyClientWrapper {
    constructor(apiKey = null) {
        this.apiKey = apiKey;
        this.client = null;
        this.channel = null;
        this.channelName = "boat-race-realtime";
    }

    initialize() {
        if (!this.apiKey) {
            console.warn("No Ably API Key specified. Network layer will run in Local Fallback mode.");
            return false;
        }

        try {
            // Lazy load Ably client if script is present in browser scope
            if (typeof window !== 'undefined' && window.Ably) {
                this.client = new window.Ably.Realtime({ key: this.apiKey });
                this.channel = this.client.channels.get(this.channelName);
                
                this.client.connection.on('connected', () => {
                    console.log("Connected to Ably Broker successfully!");
                });
                
                return true;
            }
        } catch (e) {
            console.error("Ably initialization failed:", e);
        }
        return false;
    }

    getChannel() {
        return this.channel;
    }
}
