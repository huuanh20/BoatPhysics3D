// Game State Manager Module
export const GAME_STATES = {
    LOBBY: 'lobby',
    WAITING: 'waiting',
    PLAYING: 'playing',
    PAUSED: 'paused',
    GAMEOVER: 'gameover'
};

export class GameStateManager {
    constructor(initialState = GAME_STATES.LOBBY) {
        this.currentState = initialState;
        this.listeners = [];
    }

    getState() {
        return this.currentState;
    }

    setState(newState) {
        if (Object.values(GAME_STATES).includes(newState)) {
            const oldState = this.currentState;
            this.currentState = newState;
            this.notify(newState, oldState);
        } else {
            console.error(`Invalid game state transition: ${newState}`);
        }
    }

    onStateChange(callback) {
        this.listeners.push(callback);
    }

    notify(newState, oldState) {
        this.listeners.forEach(cb => cb(newState, oldState));
    }
}
