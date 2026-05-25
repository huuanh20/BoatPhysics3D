// Low-latency Web Audio API Sound Synthesizer
let audioCtx = null;

function getAudioCtx() {
    if (!audioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
            audioCtx = new AudioContext();
        }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    return audioCtx;
}

export const sfxSynthesizer = {
    play: (type) => {
        try {
            const ctx = getAudioCtx();
            if (!ctx) return;
            const now = ctx.currentTime;
            
            if (type === 'correct') {
                // Happy high-pitched synthesized sound
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(523.25, now); // C5
                osc.frequency.exponentialRampToValueAtTime(1046.50, now + 0.15); // C6
                gain.gain.setValueAtTime(0.18, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
                osc.connect(gain); gain.connect(ctx.destination);
                osc.start(now); osc.stop(now + 0.26);
            } else if (type === 'wrong') {
                // Sad buzzer synthesized sound
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(220.00, now); // A3
                osc.frequency.setValueAtTime(110.00, now + 0.08); // A2
                gain.gain.setValueAtTime(0.2, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
                osc.connect(gain); gain.connect(ctx.destination);
                osc.start(now); osc.stop(now + 0.36);
            } else if (type === 'explosion') {
                // Synthesized crash sound
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(80, now);
                osc.frequency.exponentialRampToValueAtTime(10, now + 0.5);
                gain.gain.setValueAtTime(0.35, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.6);
                osc.connect(gain); gain.connect(ctx.destination);
                osc.start(now); osc.stop(now + 0.65);
            } else if (type === 'gate_chord') {
                // Synthesized majestic gate crossing sound
                const freqs = [329.63, 392.00, 523.25, 659.25]; // E4, G4, C5, E5
                freqs.forEach((f, idx) => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(f, now + idx * 0.04);
                    gain.gain.setValueAtTime(0.08, now + idx * 0.04);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
                    osc.connect(gain); gain.connect(ctx.destination);
                    osc.start(now + idx * 0.04); osc.stop(now + 0.85);
                });
            }
        } catch (err) {
            console.warn("Real-time sound synthesizer failed:", err);
        }
    },
    
    triggerScreenShake: (duration = 800) => {
        document.body.classList.add("screen-shake");
        setTimeout(() => {
            document.body.classList.remove("screen-shake");
        }, duration);
    }
};
