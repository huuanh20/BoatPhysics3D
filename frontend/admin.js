import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Water } from "three/examples/jsm/objects/Water.js";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  connectAbly,
  createPlayerId,
  getPresenceMembers,
} from "./ably-realtime.js";

let ablyChannel = null;
let adminWinners = [];
let gamePaused = false;

// UI Elements
const adminPanel = document.getElementById("admin-panel");
const lobbyPlayersPanel = document.getElementById("lobby-players-panel");
const startGameBtn = document.getElementById("start-game-btn");
const resetGameBtn = document.getElementById("reset-game-btn");
const connectedCount = document.getElementById("connected-count");
const lobbyPlayersGrid = document.getElementById("lobby-players-grid");
const liveLeaderboard = document.getElementById("live-leaderboard");
const leaderboardList = document.getElementById("leaderboard-list");
const adminStatusPanel = document.getElementById("admin-status-panel");
const statusPlayersList = document.getElementById("status-players-list");
const podiumScreen = document.getElementById("podium-screen");
const pauseGameBtn = document.getElementById("pause-game-btn");
const adminEventLogPanel = document.getElementById("admin-event-log-panel");
const logEventsList = document.getElementById("log-events-list");
const adminQuestionPanel = document.getElementById("admin-question-panel");

// ═══════════════════════════════════════════════════════════════
// 🔊 WEB AUDIO API: Synthesized Sound Effects (no external URLs)
// Replaces broken mixkit.co URLs that return 403 Forbidden
// ═══════════════════════════════════════════════════════════════
let sfxAudioCtx = null;
function getSfxCtx() {
    if (!sfxAudioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) sfxAudioCtx = new AC();
    }
    if (sfxAudioCtx && sfxAudioCtx.state === 'suspended') sfxAudioCtx.resume();
    return sfxAudioCtx;
}

// Ambient ocean loop (synthesized white noise filtered)
let ambientLoopNode = null;
let ambientGainNode = null;
const sfxAmbient = {
    play: () => {
        const ctx = getSfxCtx(); if (!ctx) return Promise.resolve();
        if (ambientLoopNode) return Promise.resolve();
        // Create looping ocean wash using filtered noise
        const bufLen = ctx.sampleRate * 4;
        const buf = ctx.createBuffer(2, bufLen, ctx.sampleRate);
        for (let ch = 0; ch < 2; ch++) {
            const d = buf.getChannelData(ch);
            for (let i = 0; i < bufLen; i++) {
                // Slowly undulating ocean: amplitude modulated noise
                const env = 0.3 + 0.7 * Math.sin(2 * Math.PI * i / bufLen);
                d[i] = (Math.random() * 2 - 1) * env * 0.5;
            }
        }
        const src = ctx.createBufferSource();
        src.buffer = buf; src.loop = true;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass'; filter.frequency.value = 800;
        ambientGainNode = ctx.createGain();
        ambientGainNode.gain.value = 0.08;
        src.connect(filter); filter.connect(ambientGainNode); ambientGainNode.connect(ctx.destination);
        src.start(); ambientLoopNode = src;
        return Promise.resolve();
    },
    pause: () => {
        if (ambientLoopNode) { try { ambientLoopNode.stop(); } catch(e){} ambientLoopNode = null; }
    },
    catch: () => ({ catch: () => {} })
};

// Ship horn synthesizer
const sfxHorn = {
    play: () => {
        const ctx = getSfxCtx(); if (!ctx) return Promise.resolve();
        const now = ctx.currentTime;
        const tones = [180, 220, 270]; // multi-tone foghorn chord
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.25, now + 0.1);
        gain.gain.setValueAtTime(0.25, now + 0.8);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
        gain.connect(ctx.destination);
        tones.forEach(freq => {
            const osc = ctx.createOscillator();
            osc.type = 'triangle'; osc.frequency.value = freq;
            osc.connect(gain); osc.start(now); osc.stop(now + 1.2);
        });
        return Promise.resolve();
    },
    catch: () => ({ catch: () => {} })
};

// Explosion synthesizer
const sfxExplosion = {
    play: () => {
        const ctx = getSfxCtx(); if (!ctx) return Promise.resolve();
        const now = ctx.currentTime;
        // Low rumble + noise burst
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(80, now);
        osc.frequency.exponentialRampToValueAtTime(20, now + 0.8);
        const oscGain = ctx.createGain();
        oscGain.gain.setValueAtTime(0.4, now);
        oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
        osc.connect(oscGain); oscGain.connect(ctx.destination);
        osc.start(now); osc.stop(now + 1.0);
        // Noise burst
        const bufLen = ctx.sampleRate * 1.2;
        const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < bufLen; i++) d[i] = Math.random() * 2 - 1;
        const noise = ctx.createBufferSource(); noise.buffer = buf;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass'; filter.frequency.setValueAtTime(300, now);
        filter.frequency.exponentialRampToValueAtTime(30, now + 1.0);
        const nGain = ctx.createGain();
        nGain.gain.setValueAtTime(0.3, now);
        nGain.gain.exponentialRampToValueAtTime(0.001, now + 1.1);
        noise.connect(filter); filter.connect(nGain); nGain.connect(ctx.destination);
        noise.start(now); noise.stop(now + 1.2);
        return Promise.resolve();
    },
    catch: () => ({ catch: () => {} })
};

// bgmGameplay is now synthesized via Web Audio API (no HTML audio element needed)
// This replaces the unreliable external OGG from Wikipedia Commons that kept cutting out
let battleAudioCtx = null;
let battleSchedulerId = null;
let battleNodes = [];
let battleIsPlaying = false;

function trackBattleNode(node) {
    battleNodes.push(node);
    node.onended = () => {
        const idx = battleNodes.indexOf(node);
        if (idx !== -1) battleNodes.splice(idx, 1);
    };
}

function playBattleDrum(ctx, dest, time, type = 'kick') {
    if (type === 'kick') {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(120, time);
        osc.frequency.exponentialRampToValueAtTime(35, time + 0.12);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.4, time);
        g.gain.exponentialRampToValueAtTime(0.001, time + 0.35);
        osc.connect(g); g.connect(dest);
        osc.start(time); osc.stop(time + 0.4);
        trackBattleNode(osc);
    } else if (type === 'snare') {
        const bufferSize = ctx.sampleRate * 0.08;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1);
        const noise = ctx.createBufferSource();
        noise.buffer = buffer;
        const filter = ctx.createBiquadFilter();
        filter.type = 'highpass'; filter.frequency.value = 3500;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.18, time);
        g.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
        noise.connect(filter); filter.connect(g); g.connect(dest);
        noise.start(time); noise.stop(time + 0.12);
        trackBattleNode(noise);
    } else if (type === 'hihat') {
        const bufferSize = ctx.sampleRate * 0.04;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1);
        const noise = ctx.createBufferSource();
        noise.buffer = buffer;
        const filter = ctx.createBiquadFilter();
        filter.type = 'highpass'; filter.frequency.value = 8000;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.07, time);
        g.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
        noise.connect(filter); filter.connect(g); g.connect(dest);
        noise.start(time); noise.stop(time + 0.06);
        trackBattleNode(noise);
    }
}

function playBattleNote(ctx, dest, freq, time, duration = 0.3, vol = 0.08, type = 'sawtooth') {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(vol, time + 0.02);
    g.gain.setValueAtTime(vol * 0.7, time + duration * 0.5);
    g.gain.exponentialRampToValueAtTime(0.001, time + duration);
    osc.connect(g); g.connect(dest);
    osc.start(time); osc.stop(time + duration + 0.05);
    trackBattleNode(osc);
}

function startBattleMusic() {
    if (battleIsPlaying) return;
    battleIsPlaying = true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    battleAudioCtx = new AC();
    if (battleAudioCtx.state === 'suspended') battleAudioCtx.resume();
    const ctx = battleAudioCtx;

    const reverb = createReverb(ctx, 1.5, 2.5);
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.ratio.value = 5;
    const masterGain = ctx.createGain();
    masterGain.gain.value = 0.6;

    const dryGain = ctx.createGain();
    dryGain.gain.value = 0.75;
    dryGain.connect(compressor);

    const wetGain = ctx.createGain();
    wetGain.gain.value = 0.2;
    reverb.connect(wetGain);
    wetGain.connect(compressor);

    compressor.connect(masterGain);
    masterGain.connect(ctx.destination);

    // Battle pentatonic melody - urgent, heroic, fast
    const battleMelody = [
        // Phrase 1: Urgent ascending battle cry
        { f: 523, d: 0.2 }, { f: 587, d: 0.2 }, { f: 659, d: 0.15 }, { f: 784, d: 0.15 },
        { f: 880, d: 0.4 }, { f: 784, d: 0.2 }, { f: 659, d: 0.2 }, { f: 0, d: 0.15 },
        // Phrase 2: Driving power descent
        { f: 784, d: 0.15 }, { f: 659, d: 0.15 }, { f: 587, d: 0.2 }, { f: 523, d: 0.2 },
        { f: 440, d: 0.15 }, { f: 523, d: 0.15 }, { f: 587, d: 0.4 }, { f: 0, d: 0.15 },
        // Phrase 3: Rapid battle march
        { f: 440, d: 0.1 }, { f: 523, d: 0.1 }, { f: 587, d: 0.1 }, { f: 659, d: 0.1 },
        { f: 784, d: 0.2 }, { f: 659, d: 0.1 }, { f: 587, d: 0.1 },
        { f: 523, d: 0.2 }, { f: 440, d: 0.2 }, { f: 0, d: 0.2 },
        // Phrase 4: Climactic surge
        { f: 659, d: 0.15 }, { f: 784, d: 0.15 }, { f: 880, d: 0.2 }, { f: 1047, d: 0.4 },
        { f: 880, d: 0.15 }, { f: 784, d: 0.15 }, { f: 659, d: 0.2 },
        { f: 587, d: 0.3 }, { f: 523, d: 0.5 }, { f: 0, d: 0.3 },
    ];

    const BEAT_INTERVAL = 0.214; // ~140 BPM
    let beatCount = 0;
    let melodyIdx = 0;
    let melodyTime = 0;
    let scheduleAhead = 0.1;
    let nextBeatTime = ctx.currentTime + 0.3;

    // Aggressive bass drone
    const bassOsc = ctx.createOscillator();
    bassOsc.type = 'sawtooth';
    bassOsc.frequency.value = 87.31; // F2 - more tense than C2
    const bassFilter = ctx.createBiquadFilter();
    bassFilter.type = 'lowpass';
    bassFilter.frequency.value = 250;
    const bassGain = ctx.createGain();
    bassGain.gain.setValueAtTime(0, ctx.currentTime);
    bassGain.gain.linearRampToValueAtTime(0.08, ctx.currentTime + 2.0);
    bassOsc.connect(bassFilter);
    bassFilter.connect(bassGain);
    bassGain.connect(dryGain);
    bassOsc.start();
    trackBattleNode(bassOsc);

    function battleScheduler() {
        while (nextBeatTime < ctx.currentTime + scheduleAhead) {
            const t = nextBeatTime;

            // Double-time aggressive drums
            if (beatCount % 4 === 0) playBattleDrum(ctx, dryGain, t, 'kick');
            if (beatCount % 4 === 2) playBattleDrum(ctx, dryGain, t, 'kick');
            if (beatCount % 4 === 1) playBattleDrum(ctx, dryGain, t, 'snare');
            if (beatCount % 4 === 3) playBattleDrum(ctx, dryGain, t, 'snare');
            // Constant hi-hat pulse
            playBattleDrum(ctx, dryGain, t, 'hihat');

            // Battle melody
            if (melodyTime <= 0 && battleMelody[melodyIdx]) {
                const note = battleMelody[melodyIdx % battleMelody.length];
                if (note.f > 0) {
                    playBattleNote(ctx, dryGain, note.f, t, note.d * 0.85, 0.09, 'sawtooth');
                    playBattleNote(ctx, reverb, note.f, t, note.d * 0.85, 0.03, 'triangle');
                    // Power octave below for bass weight
                    if (note.f >= 523) {
                        playBattleNote(ctx, dryGain, note.f * 0.5, t, note.d * 0.85, 0.04, 'triangle');
                    }
                }
                melodyTime = note.d;
                melodyIdx++;
                if (melodyIdx >= battleMelody.length) melodyIdx = 0;
            }
            melodyTime -= BEAT_INTERVAL;

            beatCount++;
            nextBeatTime += BEAT_INTERVAL;
        }
        battleSchedulerId = requestAnimationFrame(battleScheduler);
    }
    battleSchedulerId = requestAnimationFrame(battleScheduler);
}

function stopBattleMusic() {
    battleIsPlaying = false;
    if (battleSchedulerId) { cancelAnimationFrame(battleSchedulerId); battleSchedulerId = null; }
    battleNodes.forEach(n => { try { n.stop(); } catch(e){} });
    battleNodes = [];
    if (battleAudioCtx) { try { battleAudioCtx.close(); } catch(e){} battleAudioCtx = null; }
}

let sfxAnthem = null;
function playNationalAnthem() {
    stopBattleMusic();
    stopLobbyMusic();
    sfxAmbient.pause();

    if (!sfxAnthem) {
        sfxAnthem = new Audio('/vietnam_anthem.mp3');
        sfxAnthem.volume = 0.8;
    }
    sfxAnthem.currentTime = 0;
    sfxAnthem.play().catch(e => console.warn("Anthem audio playback deferred until interaction:", e));
}

function stopNationalAnthem() {
    if (sfxAnthem) {
        sfxAnthem.pause();
        sfxAnthem.currentTime = 0;
    }
}

// ═══════════════════════════════════════════════════════════════
// 🎵 WEB AUDIO API: Vietnamese Epic Folk Music Engine
// Nhạc dân tộc hào hùng Việt Nam - không lời
// Features: War drums, pentatonic đàn tranh melody, brass horn
// ═══════════════════════════════════════════════════════════════
let lobbyAudioCtx = null;
let lobbySchedulerId = null;
let lobbyNodes = []; // track active oscillators for cleanup (auto-pruned via onended)
let lobbyIsPlaying = false;

// Helper: track a node and auto-remove when it finishes (prevents memory leak)
function trackNode(node) {
    lobbyNodes.push(node);
    node.onended = () => {
        const idx = lobbyNodes.indexOf(node);
        if (idx !== -1) lobbyNodes.splice(idx, 1);
    };
}

function createReverb(ctx, duration = 2.0, decay = 2.0) {
    const sampleRate = ctx.sampleRate;
    const length = sampleRate * duration;
    const impulse = ctx.createBuffer(2, length, sampleRate);
    for (let ch = 0; ch < 2; ch++) {
        const data = impulse.getChannelData(ch);
        for (let i = 0; i < length; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
        }
    }
    const conv = ctx.createConvolver();
    conv.buffer = impulse;
    return conv;
}

function playDrum(ctx, dest, time, type = 'kick') {
    if (type === 'kick') {
        // Deep war drum (trống trận)
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(150, time);
        osc.frequency.exponentialRampToValueAtTime(40, time + 0.15);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.35, time);
        g.gain.exponentialRampToValueAtTime(0.001, time + 0.4);
        osc.connect(g); g.connect(dest);
        osc.start(time); osc.stop(time + 0.45);
        trackNode(osc);
    } else if (type === 'snare') {
        // Sharp snare / rimshot (thanh la)
        const bufferSize = ctx.sampleRate * 0.12;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1);
        const noise = ctx.createBufferSource();
        noise.buffer = buffer;
        const filter = ctx.createBiquadFilter();
        filter.type = 'highpass'; filter.frequency.value = 3000;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.15, time);
        g.gain.exponentialRampToValueAtTime(0.001, time + 0.12);
        noise.connect(filter); filter.connect(g); g.connect(dest);
        noise.start(time); noise.stop(time + 0.15);
        trackNode(noise);
    } else if (type === 'taiko') {
        // Massive taiko-style war drum
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(80, time);
        osc.frequency.exponentialRampToValueAtTime(30, time + 0.5);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.4, time);
        g.gain.exponentialRampToValueAtTime(0.001, time + 0.8);
        osc.connect(g); g.connect(dest);
        osc.start(time); osc.stop(time + 0.85);
        trackNode(osc);
    }
}

function playNote(ctx, dest, freq, time, duration = 0.5, vol = 0.08, type = 'triangle') {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(vol, time + 0.03);
    g.gain.setValueAtTime(vol * 0.8, time + duration * 0.6);
    g.gain.exponentialRampToValueAtTime(0.001, time + duration);
    osc.connect(g); g.connect(dest);
    osc.start(time); osc.stop(time + duration + 0.05);
    trackNode(osc);
}

function startLobbyMusic() {
    if (lobbyIsPlaying) return;
    lobbyIsPlaying = true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    lobbyAudioCtx = new AC();
    if (lobbyAudioCtx.state === 'suspended') lobbyAudioCtx.resume();
    const ctx = lobbyAudioCtx;

    // Master chain: reverb → compressor → destination
    const reverb = createReverb(ctx, 2.5, 2.0);
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -20;
    compressor.ratio.value = 4;
    const masterGain = ctx.createGain();
    masterGain.gain.value = 0.7;
    
    // Dry path
    const dryGain = ctx.createGain();
    dryGain.gain.value = 0.7;
    dryGain.connect(compressor);
    
    // Wet path (reverb)
    const wetGain = ctx.createGain();
    wetGain.gain.value = 0.3;
    reverb.connect(wetGain);
    wetGain.connect(compressor);
    
    compressor.connect(masterGain);
    masterGain.connect(ctx.destination);

    // Vietnamese pentatonic scale: Hò (C4=262), Xự (D4=294), Xang (E4=330), Xê (G4=392), Cống (A4=440)
    // Heroic melody pattern (inspired by Tiến quân ca / folk melodies)
    const melodySequence = [
        // Phrase 1: Rising heroic call (lên cao hào hùng)
        { f: 392, d: 0.3 }, { f: 440, d: 0.3 }, { f: 523, d: 0.6 }, { f: 587, d: 0.3 },
        { f: 523, d: 0.3 }, { f: 440, d: 0.6 }, { f: 0, d: 0.3 }, // rest
        // Phrase 2: Descending power (hạ xuống uy nghiêm)
        { f: 523, d: 0.3 }, { f: 440, d: 0.3 }, { f: 392, d: 0.6 }, { f: 330, d: 0.3 },
        { f: 294, d: 0.3 }, { f: 262, d: 0.9 }, { f: 0, d: 0.3 },
        // Phrase 3: Battle march (hành quân chiến đấu)
        { f: 262, d: 0.2 }, { f: 330, d: 0.2 }, { f: 392, d: 0.4 }, { f: 523, d: 0.4 },
        { f: 440, d: 0.2 }, { f: 392, d: 0.2 }, { f: 330, d: 0.4 }, { f: 294, d: 0.4 },
        { f: 262, d: 0.2 }, { f: 294, d: 0.2 }, { f: 330, d: 0.8 }, { f: 0, d: 0.4 },
        // Phrase 4: Triumphant climax (cao trào chiến thắng)
        { f: 392, d: 0.2 }, { f: 440, d: 0.2 }, { f: 523, d: 0.3 }, { f: 587, d: 0.3 },
        { f: 659, d: 0.6 }, { f: 587, d: 0.3 }, { f: 523, d: 0.3 },
        { f: 440, d: 0.4 }, { f: 392, d: 0.4 }, { f: 330, d: 0.8 }, { f: 0, d: 0.6 },
    ];

    // Drum pattern per beat (0.3s = 1 beat)
    const BPM_INTERVAL = 0.3; // ~100 BPM heroic march tempo
    let beatCount = 0;
    let melodyIdx = 0;
    let melodyTime = 0;
    let scheduleAhead = 0.1;
    let nextBeatTime = ctx.currentTime + 0.5; // start after 0.5s fade-in

    // Continuous bass drone (đàn nhị style low hum)
    const bassOsc = ctx.createOscillator();
    bassOsc.type = 'sawtooth';
    bassOsc.frequency.value = 65.41; // C2
    const bassFilter = ctx.createBiquadFilter();
    bassFilter.type = 'lowpass';
    bassFilter.frequency.value = 200;
    const bassGain = ctx.createGain();
    bassGain.gain.setValueAtTime(0, ctx.currentTime);
    bassGain.gain.linearRampToValueAtTime(0.06, ctx.currentTime + 3.0);
    bassOsc.connect(bassFilter);
    bassFilter.connect(bassGain);
    bassGain.connect(dryGain);
    bassOsc.start();
    trackNode(bassOsc);

    function scheduler() {
        while (nextBeatTime < ctx.currentTime + scheduleAhead) {
            const t = nextBeatTime;

            // ── DRUMS: War drum pattern ──
            if (beatCount % 8 === 0) playDrum(ctx, dryGain, t, 'taiko'); // big hit every 8 beats
            if (beatCount % 4 === 0) playDrum(ctx, dryGain, t, 'kick');
            if (beatCount % 4 === 2) playDrum(ctx, dryGain, t, 'snare');
            if (beatCount % 2 === 1) { // off-beat hi-hat like thanh la
                playDrum(ctx, dryGain, t, 'snare');
            }

            // ── MELODY: Đàn tranh pentatonic on triangle wave ──
            if (melodyTime <= 0 && melodySequence[melodyIdx]) {
                const note = melodySequence[melodyIdx % melodySequence.length];
                if (note.f > 0) {
                    // Main melody (triangle = đàn tranh timbre)
                    playNote(ctx, dryGain, note.f, t, note.d * 0.9, 0.1, 'triangle');
                    // Reverb send for depth
                    playNote(ctx, reverb, note.f, t, note.d * 0.9, 0.04, 'triangle');
                    // Octave doubling for richness (brass horn feel)
                    if (note.f >= 440) {
                        playNote(ctx, dryGain, note.f * 0.5, t, note.d * 0.9, 0.04, 'sawtooth');
                    }
                }
                melodyTime = note.d;
                melodyIdx++;
                if (melodyIdx >= melodySequence.length) melodyIdx = 0; // loop
            }
            melodyTime -= BPM_INTERVAL;

            beatCount++;
            nextBeatTime += BPM_INTERVAL;
        }
        lobbySchedulerId = requestAnimationFrame(scheduler);
    }
    lobbySchedulerId = requestAnimationFrame(scheduler);
}

function stopLobbyMusic() {
    lobbyIsPlaying = false;
    if (lobbySchedulerId) { cancelAnimationFrame(lobbySchedulerId); lobbySchedulerId = null; }
    lobbyNodes.forEach(n => { try { n.stop(); } catch(e){} });
    lobbyNodes = [];
    if (lobbyAudioCtx) { try { lobbyAudioCtx.close(); } catch(e){} lobbyAudioCtx = null; }
}

// Game State
let activePlayers = {}; // map of sid -> player data (mesh, labelDiv, name, color, progress, rank)
let gameStarted = false;
let gameStartTime = 0;
let startButtonEnabled = false;

const START_Z = 300;
const FINISH_Z = -500;
const TOTAL_DIST = START_Z - FINISH_Z; // 800 units

// Stable Lane Assignment Maps
let laneMap = {}; // Maps sid -> lane index (0-19)
let usedLanes = new Array(100).fill(false);

// 3D Scene Variables
let camera, scene, renderer, controls;
let water, sky, sun;
let boatTemplate = null;
let isRefreshingPresence = false;
let loader = new GLTFLoader();
let activeExplosions = []; // List of animated explosion spheres/particles

// Scenery Global Variables
let sceneryClouds = [];
let scenerySunHalo1 = null;
let scenerySunHalo2 = null;
let sceneryBirds = [];
let sceneryWhale = null;

// --- GATE CONFIGURATION ---
const gateZPositions = [140, -20, -180, -340, -500];
const gateTitles = [
    "CỔNG 1: HIỂU LẦM SỞ HỮU CÁ NHÂN",
    "CỔNG 2: HIỂU LẦM MÔ HÌNH CÀO BẰNG",
    "CỔNG 3: HIỂU LẦM TRIỆT TIÊU DÂN CHỦ",
    "CỔNG 4: HIỂU LẦM KHÔNG TƯỞNG & THẤT BẠI",
    "CỔNG 5: HIỂU LẦM ĐỐI LẬP TUYỆT ĐỐI"
];
const gateSubtitles = [
    "Sự thật: CNXH bảo vệ sở hữu cá nhân và tôn trọng thành quả lao động!",
    "Sự thật: Phân phối theo lao động - làm nhiều hưởng nhiều, làm ít hưởng ít!",
    "Sự thật: Nền dân chủ XHCN thuộc về tuyệt đại đa số nhân dân lao động!",
    "Sự thật: Sự sụp đổ của một mô hình giáo điều không phải là thất bại của lý tưởng!",
    "Sự thật: Kế thừa và phát triển tinh hoa văn minh nhân loại của CNTB!"
];
let activeGates = [];

let sceneryLighthouseBeam = null;
let sceneryBuoys = [];
let sceneryYacht = null;
let sceneryCargoShip = null;
let scenerySharks = [];
let whaleState = {
    leapProgress: 0,
    isLeaping: false,
    cooldown: 4.0, // Leap every 8-10s, initial leap at 4.0s
    startX: -300,
    startZ: -100,
    targetX: -300,
    targetZ: -250,
    splashMesh: null,
    splashActive: false,
    splashScale: 1,
    splashOpacity: 1
};

// Admin Holographic View Variables
let holoGrid = null;
let radarRing = null;
let radarScale = 1.0;
let radarOpacity = 0.5;
let leaderReticle = null;

// Vietnam Flag Canvas Texture Creator
function createVietnamFlagTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 85;
    const ctx = canvas.getContext("2d");
    
    // Red Background
    ctx.fillStyle = "#da251d";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw Yellow Star
    ctx.fillStyle = "#ffff00";
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const spikes = 5;
    const outerRadius = 18;
    const innerRadius = 7;
    
    let rot = Math.PI / 2 * 3;
    let x = cx;
    let y = cy;
    const step = Math.PI / spikes;

    ctx.beginPath();
    ctx.moveTo(cx, cy - outerRadius);
    for (let i = 0; i < spikes; i++) {
        x = cx + Math.cos(rot) * outerRadius;
        y = cy + Math.sin(rot) * outerRadius;
        ctx.lineTo(x, y);
        rot += step;

        x = cx + Math.cos(rot) * innerRadius;
        y = cy + Math.sin(rot) * innerRadius;
        ctx.lineTo(x, y);
        rot += step;
    }
    ctx.lineTo(cx, cy - outerRadius);
    ctx.closePath();
    ctx.fill();
    
    return new THREE.CanvasTexture(canvas);
}

const flagTexture = createVietnamFlagTexture();

// Initialize 3D Sea and Camera Controls
function init3D() {
    const container = document.getElementById("canvas-container");
    
    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // Capped at 1.5 for admin view to prevent lag on 4K/Retina monitors
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.8;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap; // Optimized soft shadow mapping to standard shadow mapping
    container.appendChild(renderer.domElement);

    // Scene
    scene = new THREE.Scene();

    // Camera - Top-down centered view
    camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 1, 25000);
    camera.position.set(-100, 250, START_Z);

    // Orbit Controls (Admin can look around!)
    controls = new OrbitControls(camera, renderer.domElement);
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.minDistance = 30.0;
    controls.maxDistance = 2500.0;
    controls.target.set(-100, 10, START_Z);
    controls.update();

    // Ambient/Direct light - Warm sunset theme with stylized high contrast shadow coloring
    const ambientLight = new THREE.AmbientLight(0x4a5d78, 0.35); // Cool blue-grey shadows to match deep ocean sunset
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffb07c, 1.8); // Brighter, warm sunset orange-gold light
    dirLight.position.set(250, 350, -200);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024; // Optimized shadow resolution from 2048 to 1024
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 4000;
    dirLight.shadow.bias = -0.0005;

    const d = 1200;
    dirLight.shadow.camera.left = -d;
    dirLight.shadow.camera.right = d;
    dirLight.shadow.camera.top = d;
    dirLight.shadow.camera.bottom = -d;
    scene.add(dirLight);

    // Water
    const waterGeometry = new THREE.PlaneGeometry(120000, 120000);
    water = new Water(waterGeometry, {
        textureWidth: 512,
        textureHeight: 512,
        waterNormals: new THREE.TextureLoader().load("helpers/waternormals.jpg", (texture) => {
            texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        }),
        sunDirection: new THREE.Vector3(),
        sunColor: 0xffffff,
        waterColor: 0x003e48,
        distortionScale: 1.5,
        fog: false,
    });
    water.rotation.x = -Math.PI / 2;
    water.position.y = 12.0;
    water.receiveShadow = true;
    scene.add(water);

    // Sky & Sun
    sky = new Sky();
    sky.scale.setScalar(120000);
    scene.add(sky);

    // Gorgeous Sunset Atmosphere
    const uniforms = sky.material.uniforms;
    uniforms["turbidity"].value = 10;
    uniforms["rayleigh"].value = 3;
    uniforms["mieCoefficient"].value = 0.005;
    uniforms["mieDirectionalG"].value = 0.8;

    sun = new THREE.Vector3();
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    
    // Setting beautiful tropical sunset/golden-hour vibes
    const elevation = 12; // Lower elevation for cinematic sunset
    const azimuth = 180;
    const phi = THREE.MathUtils.degToRad(90 - elevation);
    const theta = THREE.MathUtils.degToRad(azimuth);
    sun.setFromSphericalCoords(1, phi, theta);
    
    sky.material.uniforms["sunPosition"].value.copy(sun);
    water.material.uniforms["sunDirection"].value.copy(sun).normalize();
    scene.environment = pmremGenerator.fromScene(sky).texture;

    // Create 3D Finish Line Banner across the water
    createFinishArch();

    // Create 21 lane boundaries for 20 lanes
    createRaceLanes();

    // Call Scenery Builder for majestic background graphics
    createWorldScenery(scene);

    // 1. Holographic green coordinate grid
    holoGrid = new THREE.GridHelper(1200, 60, 0x00ffaa, 0x004422);
    holoGrid.position.set(0, 12.1, (START_Z + FINISH_Z) / 2);
    holoGrid.material.transparent = true;
    holoGrid.material.opacity = 0.18;
    scene.add(holoGrid);

    // 2. Tactical Sonar Radar Circle Mesh
    const radarGeom = new THREE.RingGeometry(1, 1.5, 32);
    radarGeom.rotateX(-Math.PI / 2);
    const radarMat = new THREE.MeshBasicMaterial({
        color: 0x00ffaa,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending
    });
    radarRing = new THREE.Mesh(radarGeom, radarMat);
    radarRing.position.set(0, 12.15, START_Z);
    scene.add(radarRing);

    // 3. Glowing Futuristic Leader Reticle
    const reticleGroup = new THREE.Group();
    
    // Outer circle
    const ringGeom = new THREE.RingGeometry(18, 19, 32);
    ringGeom.rotateX(-Math.PI / 2);
    const reticleMat = new THREE.MeshBasicMaterial({
        color: 0x00ffcc,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending
    });
    const outerRing = new THREE.Mesh(ringGeom, reticleMat);
    reticleGroup.add(outerRing);
    
    // 4 corner ticks/brackets
    const tickGeom = new THREE.BoxGeometry(4, 0.2, 1);
    const tickMat = new THREE.MeshBasicMaterial({ color: 0x00ffcc, transparent: true, opacity: 0.8 });
    for (let i = 0; i < 4; i++) {
        const tick = new THREE.Mesh(tickGeom, tickMat);
        const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
        tick.position.set(Math.cos(angle) * 16.5, 0.05, Math.sin(angle) * 16.5);
        tick.rotation.y = -angle;
        reticleGroup.add(tick);
    }
    
    leaderReticle = reticleGroup;
    leaderReticle.position.set(0, 12.18, START_Z);
    leaderReticle.visible = false;
    scene.add(leaderReticle);

    // Pre-load boat template for cloned competitor spawning
    loader.load("helpers/boat/scene.gltf", (gltf) => {
        boatTemplate = gltf.scene;
    });

    // Resize Handler
    window.addEventListener("resize", onWindowResize);
}

function createFinishArch() {
    // Generate a simple stylized glowing finish gate in 3D
    const archGroup = new THREE.Group();
    archGroup.position.set(0, 10, FINISH_Z);

    const postMaterial = new THREE.MeshStandardMaterial({ color: 0x1e272e, metalness: 0.8, roughness: 0.2 });
    const bannerMaterial = new THREE.MeshStandardMaterial({ color: 0x00f2fe, emissive: 0x00f2fe, emissiveIntensity: 0.8 });

    // Left pillar
    const leftPillar = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 60), postMaterial);
    leftPillar.position.set(-250, 20, 0);
    archGroup.add(leftPillar);

    // Right pillar
    const rightPillar = leftPillar.clone();
    rightPillar.position.set(250, 20, 0);
    archGroup.add(rightPillar);

    // Crossbar Banner
    const banner = new THREE.Mesh(new THREE.BoxGeometry(500, 10, 4), bannerMaterial);
    banner.position.set(0, 48, 0);
    archGroup.add(banner);
    
    scene.add(archGroup);
}

// Generate Olympic parallel swimming lane markers
function createRaceLanes() {
    const laneLineGeom = new THREE.BoxGeometry(0.15, 0.1, TOTAL_DIST);
    const laneLineMat = new THREE.MeshBasicMaterial({ color: 0x00f2fe, transparent: true, opacity: 0.15 });

    // 31 dividers for 30 lanes
    for (let k = 0; k <= 30; k++) {
        const buoyX = -240 + k * 16; // Midpoints between lanes
        
        // Draw a thin underwater line to guide the eye
        const line = new THREE.Mesh(laneLineGeom, laneLineMat);
        line.position.set(buoyX, 12.0, (START_Z + FINISH_Z) / 2);
        scene.add(line);
    }
    
    // White Start Line across the water
    const startLineGeom = new THREE.BoxGeometry(480, 0.2, 3);
    const startLineMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
    const startLine = new THREE.Mesh(startLineGeom, startLineMat);
    startLine.position.set(0, 12.1, START_Z);
    scene.add(startLine);
}

// Helper to create 3D Floating Text Sprites using HTML Canvas texture
function createFloatingTextSprite(text, subtitle) {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Premium backing gradient glow
    const grad = ctx.createLinearGradient(0, 0, canvas.width, 0);
    grad.addColorStop(0, "rgba(255, 59, 48, 0)");
    grad.addColorStop(0.3, "rgba(255, 59, 48, 0.85)");
    grad.addColorStop(0.5, "rgba(255, 204, 0, 0.95)");
    grad.addColorStop(0.7, "rgba(255, 59, 48, 0.85)");
    grad.addColorStop(1, "rgba(255, 59, 48, 0)");
    
    ctx.fillStyle = grad;
    ctx.fillRect(50, 30, canvas.width - 100, 110);
    
    // Main Text Glow
    ctx.shadowBlur = 15;
    ctx.shadowColor = "#ffcc00";
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 38px 'Montserrat', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, canvas.width / 2, 85);
    
    // Subtitle text (no shadow to preserve crisp look)
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#ffcc00";
    ctx.font = "italic 26px 'Be Vietnam Pro', sans-serif";
    ctx.fillText(subtitle, canvas.width / 2, 190);
    
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(160, 40, 1);
    return sprite;
}

// Upgraded 3D Procedural Scenery Generator for ultimate creative scoring
function createWorldScenery(scene) {
    // 1. Physical 3D Sunset Sun with Elegant Rotating Halos
    const sunGroup = new THREE.Group();
    sunGroup.position.set(-1500, 260, -3200);

    const sunCoreGeom = new THREE.SphereGeometry(160, 32, 32);
    const sunCoreMat = new THREE.MeshBasicMaterial({ color: 0xff8c1a, toneMapped: false });
    const sunCore = new THREE.Mesh(sunCoreGeom, sunCoreMat);
    sunGroup.add(sunCore);

    // Dynamic rotating 3D sun rays/halos
    const halo1Geom = new THREE.TorusGeometry(230, 4, 8, 48);
    const halo1Mat = new THREE.MeshBasicMaterial({ color: 0xff6600, transparent: true, opacity: 0.25 });
    scenerySunHalo1 = new THREE.Mesh(halo1Geom, halo1Mat);
    scenerySunHalo1.rotation.x = Math.PI / 6;
    sunGroup.add(scenerySunHalo1);

    const halo2Geom = new THREE.TorusGeometry(290, 2, 8, 48);
    const halo2Mat = new THREE.MeshBasicMaterial({ color: 0xff3300, transparent: true, opacity: 0.15 });
    scenerySunHalo2 = new THREE.Mesh(halo2Geom, halo2Mat);
    scenerySunHalo2.rotation.y = Math.PI / 4;
    sunGroup.add(scenerySunHalo2);

    scene.add(sunGroup);

    // 2. Majestic 3D Volcanic Snow-capped Mountains framing the racing fjord
    function createMountain(x, z, radius, height) {
        const mtGroup = new THREE.Group();
        mtGroup.position.set(x, 12.0, z); // Rising directly out of the water plane at y=12.0

        // Use more segments (radial=8, height=4) to allow jagged procedural displacement
        const baseGeom = new THREE.ConeGeometry(radius, height, 8, 4);
        
        // Procedural vertex displacement for jagged mountain peaks & vertical color gradient
        const posAttr = baseGeom.attributes.position;
        const colors = [];
        for (let i = 0; i < posAttr.count; i++) {
            const vx = posAttr.getX(i);
            const vy = posAttr.getY(i);
            const vz = posAttr.getZ(i);
            
            // Calculate how high the vertex is (from 0 at base to 1 at peak)
            const heightRatio = (vy + height / 2) / height;
            
            // Displace only vertices that are above the base (heightRatio > 0.1)
            if (heightRatio > 0.1) {
                const noiseScale = radius * 0.15 * heightRatio;
                // Add some sinusoidal noise and small random perturbation to make it look jagged and natural
                const dx = (Math.sin(vy * 0.1 + vx * 0.05) * noiseScale * 0.6) + (Math.sin(vx * 0.2 + vz * 0.2) * noiseScale * 0.4);
                const dz = (Math.cos(vy * 0.1 + vz * 0.05) * noiseScale * 0.6) + (Math.cos(vx * 0.2 + vz * 0.2) * noiseScale * 0.4);
                const dy = (Math.sin(vx * 0.1) * noiseScale * 0.3);
                
                posAttr.setX(i, vx + dx);
                posAttr.setZ(i, vz + dz);
                posAttr.setY(i, vy + dy);
            }
            
            // Generate vertical color gradient (deep warm slate/purple-brown at base, transitioning to warmer earth/rock color at peak)
            const r = 0.18 + 0.35 * heightRatio;
            const g = 0.16 + 0.22 * heightRatio;
            const b = 0.22 + 0.12 * heightRatio;
            colors.push(r, g, b);
        }
        baseGeom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        baseGeom.computeVertexNormals();

        // Rocky mountain cone base with vertex colors enabled
        const rockMat = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.85,
            metalness: 0.15,
            flatShading: true
        });

        const baseMesh = new THREE.Mesh(baseGeom, rockMat);
        baseMesh.position.y = height / 2;
        baseMesh.castShadow = true;
        baseMesh.receiveShadow = true;
        mtGroup.add(baseMesh);

        // Snow-capped peak (smaller white cone stacked on top)
        const snowMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            roughness: 0.95,
            flatShading: true
        });
        const snowHeight = height * 0.35;
        const snowRadius = radius * 0.35;
        const snowGeom = new THREE.ConeGeometry(snowRadius, snowHeight, 8, 2);
        
        // Procedurally displace the snow cap similarly so it aligns perfectly with the jagged mountain below
        const snowPosAttr = snowGeom.attributes.position;
        for (let i = 0; i < snowPosAttr.count; i++) {
            const vx = snowPosAttr.getX(i);
            const vy = snowPosAttr.getY(i);
            const vz = snowPosAttr.getZ(i);
            
            // Translate the local coordinates of the snow geometry to match the main mountain's scale/height
            const globalLocalY = vy + (height - snowHeight); 
            const heightRatio = (globalLocalY + height / 2) / height;
            
            if (heightRatio > 0.1) {
                const noiseScale = radius * 0.15 * heightRatio;
                const dx = (Math.sin(globalLocalY * 0.1 + vx * 0.05) * noiseScale * 0.6) + (Math.sin(vx * 0.2 + vz * 0.2) * noiseScale * 0.4);
                const dz = (Math.cos(globalLocalY * 0.1 + vz * 0.05) * noiseScale * 0.6) + (Math.cos(vx * 0.2 + vz * 0.2) * noiseScale * 0.4);
                const dy = (Math.sin(vx * 0.1) * noiseScale * 0.3);
                
                snowPosAttr.setX(i, vx + dx);
                snowPosAttr.setZ(i, vz + dz);
                snowPosAttr.setY(i, vy + dy);
            }
        }
        snowGeom.computeVertexNormals();

        const snowMesh = new THREE.Mesh(snowGeom, snowMat);
        snowMesh.position.y = height - (snowHeight / 2) - 0.1;
        snowMesh.castShadow = true;
        snowMesh.receiveShadow = true;
        mtGroup.add(snowMesh);

        scene.add(mtGroup);
    }

    // Spawn majestic mountain ranges on both sides of the racing lanes
    // Left mountain range (Far background boundary)
    createMountain(-450, 450, 120, 220);
    createMountain(-390, 250, 90, 160);
    createMountain(-430, 50, 110, 190);
    createMountain(-380, -150, 85, 150);
    createMountain(-440, -350, 115, 210);
    createMountain(-400, -580, 95, 170);
    createMountain(-420, -780, 100, 180);

    // Right mountain range (Far background boundary)
    createMountain(450, 400, 115, 210);
    createMountain(395, 200, 80, 140);
    createMountain(440, 0, 105, 180);
    createMountain(385, -200, 90, 160);
    createMountain(450, -450, 125, 230);
    createMountain(410, -680, 85, 155);
    createMountain(430, -880, 100, 190);

    // 3. Gigantic Volumetric 3D Opaque Clouds (Highly Shaded for 3D presence)
    const cloudMat = new THREE.MeshStandardMaterial({
        color: 0xfafafa,
        roughness: 0.8,
        metalness: 0.05,
        flatShading: true
    });
    for (let i = 0; i < 16; i++) {
        const cloudGroup = new THREE.Group();
        const numSpheres = 4 + Math.floor(Math.random() * 3); // More spheres for fluffy look
        for (let s = 0; s < numSpheres; s++) {
            const rad = 14 + Math.random() * 18; // Much bigger!
            const geom = new THREE.SphereGeometry(rad, 7, 7); // facet shading
            const mesh = new THREE.Mesh(geom, cloudMat);
            mesh.position.set(
                s * (rad * 0.55) - (numSpheres * rad * 0.18),
                (Math.random() - 0.5) * 6,
                (Math.random() - 0.5) * 6
            );
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            cloudGroup.add(mesh);
        }
        cloudGroup.position.set(
            Math.random() * 1600 - 800,
            80 + Math.random() * 40, // Lower clouds so they feel closer and more 3D
            Math.random() * 1200 - 600
        );
        scene.add(cloudGroup);
        sceneryClouds.push(cloudGroup);
    }

    // Helper: Create a Shark Fin
    function createSharkFin() {
        const finGroup = new THREE.Group();
        const finGeom = new THREE.ConeGeometry(1.2, 3.5, 4);
        finGeom.rotateX(0.2); // slant backward slightly
        finGeom.scale(0.3, 1.0, 1.2); // flatten it sideways to look like a dorsal fin
        const finMat = new THREE.MeshStandardMaterial({ color: 0x455a64, roughness: 0.8, flatShading: true });
        const finMesh = new THREE.Mesh(finGeom, finMat);
        finMesh.castShadow = true;
        finMesh.receiveShadow = true;
        finGroup.add(finMesh);
        return finGroup;
    }

    /*
    // Load and Clone high-quality 3D Sketchfab Islands
    loader.load("helpers/tropical_island/scene.gltf", (gltf) => {
        console.log("3D Tropical Island loaded successfully!");
        const islandModel = gltf.scene;
        
        // Traverse and remove nested skybox, beach, and rock meshes per user request to keep only the beautiful palm trees
        islandModel.traverse((child) => {
            if (child.name) {
                const nameLower = child.name.toLowerCase();
                if (nameLower.includes("skybox") || nameLower.includes("beach") || nameLower.includes("rock")) {
                    child.visible = false;
                    child.scale.set(0, 0, 0); // Shrink to zero to prevent visual/depth issues
                    return;
                }
            }
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
                if (child.material) {
                    child.material.flatShading = true;
                    child.material.roughness = 0.85;
                }
            }
        });
        
        // Highly visible, majestic 3D islands situated beautifully outside the racing lanes (x offset of +/- 340-360)
        const islandPositions = [
            { x: -350, z: 200, scale: 65.0, rotY: 0 },
            { x: 350, z: 100, scale: 70.0, rotY: Math.PI * 0.4 },
            { x: -360, z: -100, scale: 60.0, rotY: Math.PI * 0.8 },
            { x: 360, z: -300, scale: 75.0, rotY: Math.PI * 1.2 },
            { x: -350, z: -500, scale: 65.0, rotY: Math.PI * 1.6 }
        ];
        
        islandPositions.forEach((pos) => {
            const islandClone = islandModel.clone();
            islandClone.scale.set(pos.scale, pos.scale * 0.8, pos.scale);
            islandClone.position.set(pos.x, 11.5, pos.z); // submerged beach under y=12.0 water
            islandClone.rotation.y = pos.rotY;
            scene.add(islandClone);
        });
    }, (xhr) => {
        console.log("Island model load progress:", (xhr.loaded / xhr.total * 100).toFixed(1) + "%");
    }, (error) => {
        console.error("Critical: Failed to load 3D tropical island model from path:", error);
    });
    */

    // 3. Sunset Lighthouse (Hải đăng cực hạn)
    const lhGroup = new THREE.Group();
    lhGroup.position.set(270, 11.5, -530); // Sit on the 12.0 water level nicely

    // Foundation
    const foundationMat = new THREE.MeshStandardMaterial({ color: 0x546e7a, roughness: 0.8, flatShading: true });
    const foundation = new THREE.Mesh(new THREE.CylinderGeometry(15, 18, 8, 8), foundationMat);
    lhGroup.add(foundation);

    // Tapered Stripe Tower
    const redMat = new THREE.MeshStandardMaterial({ color: 0xd32f2f, roughness: 0.65 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.65 });
    
    // Tower Section 1 (Bottom Red)
    const t1 = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 7.0, 10, 8), redMat);
    t1.position.y = 9.0;
    lhGroup.add(t1);

    // Tower Section 2 (Middle White)
    const t2 = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 5.5, 10, 8), whiteMat);
    t2.position.y = 19.0;
    lhGroup.add(t2);

    // Tower Section 3 (Top Red)
    const t3 = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 4.5, 10, 8), redMat);
    t3.position.y = 29.0;
    lhGroup.add(t3);

    // Balcony Deck
    const balcony = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.2, 1.2, 8), foundationMat);
    balcony.position.y = 34.6;
    lhGroup.add(balcony);

    // Glowing Lantern Room (Yellow core inside transparent glass frame)
    const glassMat = new THREE.MeshStandardMaterial({ color: 0xffeb3b, transparent: true, opacity: 0.35, roughness: 0.1 });
    const lantern = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 5, 8, 1, true), glassMat);
    lantern.position.y = 37.7;
    lhGroup.add(lantern);

    const coreLightGeom = new THREE.SphereGeometry(1.3, 8, 8);
    const coreLightMat = new THREE.MeshBasicMaterial({ color: 0xffeb3b });
    const coreLight = new THREE.Mesh(coreLightGeom, coreLightMat);
    coreLight.position.y = 37.7;
    lhGroup.add(coreLight);

    // Dome cap
    const dome = new THREE.Mesh(new THREE.ConeGeometry(3.0, 4.0, 8), redMat);
    dome.position.y = 42.2;
    lhGroup.add(dome);

    // Sweeping Lighthouse Beam
    sceneryLighthouseBeam = new THREE.Group();
    sceneryLighthouseBeam.position.set(0, 37.7, 0);
    
    // Concentrated search cone pointing horizontally
    const coneGeom = new THREE.CylinderGeometry(0.2, 35, 150, 16, 1, true);
    coneGeom.rotateX(Math.PI / 2); // Point forward along Z
    coneGeom.translate(0, 0, -75); // Pivot at the narrow tip
    const coneMat = new THREE.MeshBasicMaterial({
        color: 0xffea75,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending
    });
    const beamCone = new THREE.Mesh(coneGeom, coneMat);
    sceneryLighthouseBeam.add(beamCone);
    lhGroup.add(sceneryLighthouseBeam);

    lhGroup.scale.set(1.2, 1.2, 1.2);
    lhGroup.position.set(280, 11.5, FINISH_Z - 20); // Align with finish gate
    scene.add(lhGroup);

    // 4. Flapping Seagulls Flock
    const seagullGroup = new THREE.Group();
    const birdBodyGeom = new THREE.BoxGeometry(0.3, 0.3, 1.2);
    const birdBodyMat = new THREE.MeshStandardMaterial({ color: 0xb0bec5, roughness: 0.9, flatShading: true });
    
    for (let k = 0; k < 5; k++) {
        const bird = new THREE.Group();
        
        // Body
        const body = new THREE.Mesh(birdBodyGeom, birdBodyMat);
        bird.add(body);

        // Wings with pivot groups for beautiful flapping rotation
        const wingGeom = new THREE.PlaneGeometry(1.4, 0.45);
        const wingMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });

        const leftWingPivot = new THREE.Group();
        leftWingPivot.position.set(-0.15, 0, 0);
        const lWing = new THREE.Mesh(wingGeom, wingMat);
        lWing.position.set(-0.7, 0, 0);
        leftWingPivot.add(lWing);
        bird.add(leftWingPivot);

        const rightWingPivot = new THREE.Group();
        rightWingPivot.position.set(0.15, 0, 0);
        const rWing = new THREE.Mesh(wingGeom, wingMat);
        rWing.position.set(0.7, 0, 0);
        rightWingPivot.add(rWing);
        bird.add(rightWingPivot);

        // Flying scatter formation
        bird.position.set(
            (k - 2) * 8 + (Math.random() - 0.5) * 3,
            Math.random() * 4,
            -(k * 5)
        );

        seagullGroup.add(bird);
        sceneryBirds.push({
            mesh: bird,
            leftWing: leftWingPivot,
            rightWing: rightWingPivot,
            flapOffset: k * 1.5,
            speed: 0.1 + Math.random() * 0.05
        });
    }
    seagullGroup.position.set(0, 75, START_Z);
    scene.add(seagullGroup);
    // Keep reference of entire flock container in sceneryBirds array
    sceneryBirds.flockGroup = seagullGroup;

    // 5. Leaping Whale
    const whaleGroup = new THREE.Group();
    const whaleBody = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 3.5, 12, 8), foundationMat);
    whaleBody.rotation.x = Math.PI / 2;
    whaleGroup.add(whaleBody);
    
    // Tail fin
    const tailMat = new THREE.MeshStandardMaterial({ color: 0x37474f, roughness: 0.9, flatShading: true });
    const tail = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.3, 2.5), tailMat);
    tail.position.set(0, 0, 6.0);
    whaleGroup.add(tail);
    whaleGroup.position.set(whaleState.startX, 0, whaleState.startZ);
    scene.add(whaleGroup);
    sceneryWhale = whaleGroup;

    // Splash Ring mesh
    const splashGeom = new THREE.RingGeometry(1, 1.2, 16);
    splashGeom.rotateX(-Math.PI / 2);
    const splashMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide
    });
    whaleState.splashMesh = new THREE.Mesh(splashGeom, splashMat);
    whaleState.splashMesh.position.set(whaleState.startX, 12.1, whaleState.startZ);
    scene.add(whaleState.splashMesh);

    // 6. Anchored Elegant Yacht (Moved closer for scenic backdrop)
    const yachtGroup = new THREE.Group();
    yachtGroup.position.set(-270, 11.2, -50);
    yachtGroup.rotation.y = 0.5;

    // Hull
    const hullMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.2 });
    const yachtHull = new THREE.Mesh(new THREE.BoxGeometry(10, 4, 30), hullMat);
    yachtGroup.add(yachtHull);

    // Cabin
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(7, 3.2, 15), hullMat);
    cabin.position.set(0, 3.5, -2.0);
    yachtGroup.add(cabin);

    // Mast
    const mastMat = new THREE.MeshStandardMaterial({ color: 0xe0e0e0, metalness: 0.8, roughness: 0.2 });
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 22), mastMat);
    mast.position.set(0, 11.0, 3.0);
    yachtGroup.add(mast);

    // Sail
    const sailMat = new THREE.MeshBasicMaterial({ color: 0xfafafa, side: THREE.DoubleSide });
    const sail = new THREE.Mesh(new THREE.PlaneGeometry(6, 16), sailMat);
    sail.position.set(0, 11.0, 0);
    sail.rotation.y = Math.PI / 2;
    yachtGroup.add(sail);

    scene.add(yachtGroup);
    sceneryYacht = yachtGroup;

    // Helper: Create a Cargo Ship
    function createCargoShip(x, z, scale = 1.0) {
        const shipGroup = new THREE.Group();
        shipGroup.position.set(x, 11.5, z);
        
        // Hull
        const hullMat = new THREE.MeshStandardMaterial({ color: 0x2c3e50, roughness: 0.5 });
        const bottomRedMat = new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.5 });
        
        const hullMain = new THREE.Mesh(new THREE.BoxGeometry(14 * scale, 5 * scale, 45 * scale), hullMat);
        hullMain.position.y = 2.5 * scale;
        shipGroup.add(hullMain);
        
        const hullBottom = new THREE.Mesh(new THREE.BoxGeometry(14 * scale, 2 * scale, 43 * scale), bottomRedMat);
        hullBottom.position.y = 0.5 * scale;
        shipGroup.add(hullBottom);
        
        // Pointed Bow
        const bowMat = new THREE.MeshStandardMaterial({ color: 0x2c3e50, roughness: 0.5 });
        const bow = new THREE.Mesh(new THREE.ConeGeometry(7 * scale, 7 * scale, 4), bowMat);
        bow.rotation.x = Math.PI / 2;
        bow.rotation.y = Math.PI / 4;
        bow.scale.set(1, 0.7, 1);
        bow.position.set(0, 3.5 * scale, 24 * scale);
        shipGroup.add(bow);
        
        // Superstructure
        const cabinMat = new THREE.MeshStandardMaterial({ color: 0xfafafa, roughness: 0.4 });
        const bridge = new THREE.Mesh(new THREE.BoxGeometry(11 * scale, 8 * scale, 10 * scale), cabinMat);
        bridge.position.set(0, 9 * scale, -15 * scale);
        shipGroup.add(bridge);
        
        // Funnel
        const funnel = new THREE.Mesh(new THREE.CylinderGeometry(1.2 * scale, 1.2 * scale, 6 * scale, 8), bottomRedMat);
        funnel.position.set(0, 15 * scale, -17 * scale);
        shipGroup.add(funnel);
        
        // Colored cargo containers
        const colors = [0x2980b9, 0x27ae60, 0xd35400, 0xf39c12, 0x8e44ad];
        for (let row = 0; row < 2; row++) {
            for (let col = 0; col < 3; col++) {
                for (let h = 0; h < 2; h++) {
                    const cMat = new THREE.MeshStandardMaterial({ 
                        color: colors[(row + col + h) % colors.length], 
                        roughness: 0.6 
                    });
                    const containerBox = new THREE.Mesh(new THREE.BoxGeometry(3.5 * scale, 3 * scale, 8 * scale), cMat);
                    containerBox.position.set(
                        (col - 1) * 4.2 * scale,
                        (5.0 + h * 3.1) * scale,
                        (row * 10 - 2) * scale
                    );
                    shipGroup.add(containerBox);
                }
            }
        }
        
        scene.add(shipGroup);
        return shipGroup;
    }

    // 10. Giant Cargo Ship (Bobbing in waves)
    sceneryCargoShip = createCargoShip(275, -200, 1.4);

    // 7. Floating Buoys along both borders (Bobbing in waves)
    const buoyGeom = new THREE.SphereGeometry(0.8, 6, 6);
    const redBuoyMat = new THREE.MeshStandardMaterial({ color: 0xe74c3c, roughness: 0.3, flatShading: true });
    const whiteBuoyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, flatShading: true });
    
    for (let b = 0; b < 10; b++) {
        const buoyZ = START_Z - (b * (TOTAL_DIST / 9));
        
        // Left buoy
        const lBuoy = new THREE.Mesh(buoyGeom, b % 2 === 0 ? redBuoyMat : whiteBuoyMat);
        lBuoy.position.set(-240, 12.5, buoyZ);
        scene.add(lBuoy);
        sceneryBuoys.push({ mesh: lBuoy, offset: b * 0.7 });

        // Right buoy
        const rBuoy = new THREE.Mesh(buoyGeom, b % 2 === 0 ? whiteBuoyMat : redBuoyMat);
        rBuoy.position.set(240, 12.5, buoyZ);
        scene.add(rBuoy);
        sceneryBuoys.push({ mesh: rBuoy, offset: b * 0.7 + Math.PI });
    }

    // 8. Physical 3D Neon Socialist Gates (Cổng lý luận phá vỡ hiểu lầm)
    const outerGateGeom = new THREE.TorusGeometry(240, 3.0, 8, 64, Math.PI);
    const outerGateMat = new THREE.MeshBasicMaterial({
        color: 0xff3b30,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85
    });

    const innerGateGeom = new THREE.TorusGeometry(235, 1.5, 8, 64, Math.PI);
    const innerGateMat = new THREE.MeshBasicMaterial({
        color: 0xffcc00,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.9
    });

    for (let i = 0; i < gateZPositions.length; i++) {
        const gateGroup = new THREE.Group();
        gateGroup.position.set(0, 12.0, gateZPositions[i]);

        const outerMesh = new THREE.Mesh(outerGateGeom, outerGateMat);
        gateGroup.add(outerMesh);

        const innerMesh = new THREE.Mesh(innerGateGeom, innerGateMat);
        gateGroup.add(innerMesh);

        // Floating labels above gates
        const textSprite = createFloatingTextSprite(gateTitles[i], gateSubtitles[i]);
        textSprite.position.set(0, 65.0, 0);
        gateGroup.add(textSprite);

        scene.add(gateGroup);
        activeGates.push(gateGroup);
    }

    // 9. Swimming Sharks (Procedural Dorsal Fins)
    const numSharks = 3;
    for (let s = 0; s < numSharks; s++) {
        const shark = createSharkFin();
        const startRadius = 35 + Math.random() * 20;
        const centerX = -180 + Math.random() * 360;
        const centerZ = START_Z - (s * (TOTAL_DIST / (numSharks - 1))) + (Math.random() - 0.5) * 100;
        shark.position.set(centerX + startRadius, 11.8, centerZ); // slightly bobbing near water surface
        scene.add(shark);
        scenerySharks.push({
            mesh: shark,
            centerX: centerX,
            centerZ: centerZ,
            radius: startRadius,
            angle: Math.random() * Math.PI * 2,
            speed: 0.008 + Math.random() * 0.008
        });
    }
}

// Dynamically Attach Flag and Pole to Boat Mesh
function attachVietnamFlag(boat) {
    const flagGroup = new THREE.Group();
    // Position at the back of the boat gltf
    flagGroup.position.set(0, 1.8, -1.8);
    
    // Pole
    const poleGeom = new THREE.CylinderGeometry(0.06, 0.06, 3.8);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xbdc3c7, metalness: 0.9 });
    const pole = new THREE.Mesh(poleGeom, poleMat);
    pole.rotation.x = 0; // Vertical pole
    pole.position.y = 1.6;
    flagGroup.add(pole);
    
    // Flag Fabric
    const flagGeom = new THREE.PlaneGeometry(2.2, 1.45);
    const flagMat = new THREE.MeshBasicMaterial({ 
        map: flagTexture, 
        side: THREE.DoubleSide 
    });
    const flag = new THREE.Mesh(flagGeom, flagMat);
    flag.position.set(0, 2.8, 1.1); // Gắn cờ vào cột cờ tại z = 0 và bay về phía sau (+Z)
    flag.rotation.y = Math.PI / 2; // Facing sideways
    flagGroup.add(flag);
    
    boat.add(flagGroup);
    
    // Reference variables to animate flag waving
    boat.userData.flagMesh = flag;
    boat.userData.flagPole = flagGroup;
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// Render dynamic floating player labels above 3D boats
function updatePlayerLabels() {
    const tempV = new THREE.Vector3();
    Object.keys(activePlayers).forEach(sid => {
        const p = activePlayers[sid];
        if (p.mesh && p.labelDiv) {
            p.mesh.getWorldPosition(tempV);
            tempV.y += 12; // Floating height offset
            tempV.project(camera);
            
            // Behind camera?
            if (tempV.z > 1) {
                p.labelDiv.style.display = 'none';
                return;
            }
            
            const x = (tempV.x * 0.5 + 0.5) * window.innerWidth;
            const y = (tempV.y * -0.5 + 0.5) * window.innerHeight;
            
            p.labelDiv.style.left = `${x}px`;
            p.labelDiv.style.top = `${y}px`;
            p.labelDiv.style.display = 'block';
            
            // Update rank badges in the floating tag
            if (p.rank) {
                p.labelDiv.className = `floating-player-label rank-${p.rank}`;
                p.labelDiv.innerHTML = `<span style="color:#f1c40f;">🏆 Hạng ${p.rank}</span> | ${p.name}`;
            } else {
                p.labelDiv.className = `floating-player-label`;
                p.labelDiv.innerHTML = `${p.name} (${Math.round(p.progress * 100)}%)`;
            }
        }
    });
}

// 3D Animation & Rendering Loop
function animate() {
    try {
        requestAnimationFrame(animate);

        const time = performance.now() * 0.001;

        // Animate Water
        if (water && water.material && water.material.uniforms) {
            water.material.uniforms["time"].value += 1.0 / 60.0;
        }

        // Animate connected boats
        Object.keys(activePlayers).forEach(sid => {
            const p = activePlayers[sid];
            if (p.mesh) {
                // Target Z position based on game progress
                const targetZPos =
                    p.targetZ !== undefined
                        ? p.targetZ
                        : START_Z - (p.progress * TOTAL_DIST);
                const targetX = p.targetX !== undefined ? p.targetX : p.laneX;

                 p.mesh.position.z += (targetZPos - p.mesh.position.z) * 0.15; // Increased from 0.12 to 0.15 to smooth out lower network tick rate transitions
                 p.mesh.position.x += (targetX - p.mesh.position.x) * 0.15;
                
                // Boat bobbing physics
                const bobOffset = Math.sin(time * 2.0 + p.heaveOffset) * 0.22;
                const pitchOffset = Math.sin(time * 1.4 + p.heaveOffset) * 0.015;
                const rollOffset = Math.cos(time * 1.0 + p.heaveOffset) * 0.025;
                
                p.mesh.position.y = 24.0 + bobOffset;
                p.mesh.rotation.x = pitchOffset;
                p.mesh.rotation.z = rollOffset;
                
                // Lá cờ của đối thủ đứng yên uy nghiêm
            }
        });

        // Animate Active Explosion effects
        animateExplosions();

        // --- ANIMATE WORLD SCENERY ELEMENTS (A+ Grade Creative Scenery) ---
        
        // A. Lighthouse beam & Sun Halos rotation sweep
        if (sceneryLighthouseBeam) sceneryLighthouseBeam.rotation.y += 0.012;
        if (scenerySunHalo1) scenerySunHalo1.rotation.z += 0.003;
        if (scenerySunHalo2) scenerySunHalo2.rotation.z -= 0.002;

        // B. Cloud drifting automatically
        sceneryClouds.forEach(cloud => {
            cloud.position.z -= 0.08;
            if (cloud.position.z < -600) cloud.position.z = 400;
        });

        // C. Flock of birds flapping & flying around the path
        if (sceneryBirds.flockGroup) {
            const flockSpeed = time * 0.15;
            sceneryBirds.flockGroup.position.x = Math.sin(flockSpeed) * 120;
            sceneryBirds.flockGroup.position.z = START_Z - (time * 15) % (TOTAL_DIST + 200);
            sceneryBirds.forEach(bird => {
                const flap = Math.sin(time * 12 + bird.flapOffset) * 0.6;
                bird.leftWing.rotation.z = flap;
                bird.rightWing.rotation.z = -flap;
            });
        }

        // D. Whale leaping Parabol in front of the leading boat
        if (sceneryWhale) {
            whaleState.cooldown -= 1.0 / 60.0;
            
            // Center leap on the leading boat or start line
            let leader = null;
            let maxP = -1;
            Object.keys(activePlayers).forEach(sid => {
                if (activePlayers[sid].progress > maxP) {
                    maxP = activePlayers[sid].progress;
                    leader = activePlayers[sid];
                }
            });
            const leaderZ = (leader && leader.mesh) ? leader.mesh.position.z : START_Z;

            if (whaleState.cooldown <= 0 && !whaleState.isLeaping) {
                whaleState.isLeaping = true;
                whaleState.leapProgress = 0;
                whaleState.startX = (Math.random() > 0.5 ? 280 : -280) + (Math.random() - 0.5) * 40;
                whaleState.startZ = leaderZ - 150;
                whaleState.targetX = whaleState.startX + (Math.random() - 0.5) * 50;
                whaleState.targetZ = whaleState.startZ - 100;
                sceneryWhale.position.set(whaleState.startX, 0, whaleState.startZ);
                if (whaleState.splashMesh) {
                    whaleState.splashMesh.position.set(whaleState.startX, 12.1, whaleState.startZ);
                    whaleState.splashMesh.material.opacity = 0.8;
                    whaleState.splashMesh.scale.set(1, 1, 1);
                    whaleState.splashActive = true;
                }
            }

            if (whaleState.isLeaping) {
                whaleState.leapProgress += 0.012; // Leap duration ~1.4s
                const p = whaleState.leapProgress;
                if (p >= 1) {
                    whaleState.isLeaping = false;
                    whaleState.cooldown = 8.0 + Math.random() * 6.0; // Next leap after 8-14s
                    sceneryWhale.position.y = -50; // Hide underwater
                } else {
                    // Parabola trajectory
                    sceneryWhale.position.x = whaleState.startX + (whaleState.targetX - whaleState.startX) * p;
                    sceneryWhale.position.z = whaleState.startZ + (whaleState.targetZ - whaleState.startZ) * p;
                    sceneryWhale.position.y = 12.8 + Math.max(0, Math.sin(p * Math.PI) * 22.0);
                    
                    // Leaping rotation tilt
                    sceneryWhale.rotation.x = Math.PI / 2 + (0.5 - p) * Math.PI * 0.7;
                    sceneryWhale.rotation.y = Math.atan2(whaleState.targetX - whaleState.startX, whaleState.targetZ - whaleState.startZ) + Math.PI;
                    
                    // Splash trigger at entry/exit points
                    if ((p > 0.1 && p < 0.15) || (p > 0.85 && p < 0.9)) {
                        if (whaleState.splashMesh) {
                            whaleState.splashMesh.position.set(sceneryWhale.position.x, 12.1, sceneryWhale.position.z);
                            whaleState.splashMesh.material.opacity = 0.9;
                            whaleState.splashMesh.scale.set(1, 1, 1);
                            whaleState.splashActive = true;
                        }
                    }
                }
            }
        }

        // Splash ring fade update
        if (whaleState.splashMesh && whaleState.splashActive) {
            whaleState.splashMesh.scale.addScalar(0.18);
            whaleState.splashMesh.material.opacity -= 0.025;
            if (whaleState.splashMesh.material.opacity <= 0) {
                whaleState.splashActive = false;
            }
        }

        // E. Yacht bobbing gently
        if (sceneryYacht) {
            sceneryYacht.rotation.z = Math.sin(time * 0.7) * 0.015;
            sceneryYacht.rotation.x = Math.cos(time * 0.5) * 0.01;
            sceneryYacht.position.y = 11.2 + Math.sin(time * 0.8) * 0.1;
        }

        // F. Phao phân làn nhấp nhô
        sceneryBuoys.forEach(buoy => {
            buoy.mesh.position.y = 12.5 + Math.sin(time * 1.5 + buoy.offset) * 0.15;
        });

        // G. Cổng Neon bobbing nhẹ nhàng
        activeGates.forEach((gateGroup, idx) => {
            gateGroup.position.y = Math.sin(time * 1.5 + idx) * 0.8;
        });

        // H. Swimming Sharks (Procedural Fins) bobbing and moving in circles
        scenerySharks.forEach(shark => {
            shark.angle += shark.speed;
            shark.mesh.position.x = shark.centerX + Math.cos(shark.angle) * shark.radius;
            shark.mesh.position.z = shark.centerZ + Math.sin(shark.angle) * shark.radius;
            shark.mesh.rotation.y = -shark.angle + Math.PI; // point in swimming direction
            shark.mesh.position.y = 11.8 + Math.sin(time * 3.0 + shark.angle) * 0.1; // gentle bobbing
        });

        // I. Cargo Ship bobbing gently
        if (sceneryCargoShip) {
            sceneryCargoShip.rotation.z = Math.sin(time * 0.5) * 0.008;
            sceneryCargoShip.rotation.x = Math.cos(time * 0.4) * 0.005;
            sceneryCargoShip.position.y = 11.5 + Math.sin(time * 0.6) * 0.08;
        }

        // J. Holographic Sonar Radar Ring centered on leading boat
        if (radarRing) {
            let leader = null;
            let maxP = -1;
            Object.keys(activePlayers).forEach(sid => {
                if (activePlayers[sid].progress > maxP) {
                    maxP = activePlayers[sid].progress;
                    leader = activePlayers[sid];
                }
            });
            const centerPos = (leader && leader.mesh) ? leader.mesh.position : new THREE.Vector3(0, 12.15, START_Z);
            radarRing.position.set(centerPos.x, 12.15, centerPos.z);

            radarScale += 2.0;
            radarOpacity -= 0.0085;
            if (radarOpacity <= 0) {
                radarScale = 1.0;
                radarOpacity = 0.55;
            }
            radarRing.scale.set(radarScale, 1, radarScale);
            radarRing.material.opacity = radarOpacity;
        }

        // K. Futuristic Tracking Reticle locking onto leading boat
        if (leaderReticle) {
            let leader = null;
            let maxP = -1;
            Object.keys(activePlayers).forEach(sid => {
                if (activePlayers[sid].progress > maxP) {
                    maxP = activePlayers[sid].progress;
                    leader = activePlayers[sid];
                }
            });
            
            if (leader && leader.mesh && gameStarted) {
                leaderReticle.visible = true;
                const targetPos = leader.mesh.position;
                leaderReticle.position.lerp(new THREE.Vector3(targetPos.x, 12.18, targetPos.z), 0.15);
                leaderReticle.rotation.y += 0.015;
            } else {
                leaderReticle.visible = false;
            }
        }

        // Cinematic Auto-cam (Slowly panning or tracking the first place boat when started)
        if (gameStarted) {
            trackRaceCamera();
        }

        if (controls) {
            controls.update();
        }
        if (renderer && scene && camera) {
            renderer.render(scene, camera);
        }
        updatePlayerLabels();
    } catch (e) {
        console.error("Error in animation loop. Stopping 3D.", e);
        apply2DFallback();
    }
}

// Cinematic camera tracking leading boat from the side (horizontal race follow)
function trackRaceCamera() {
    // Find leader
    let leader = null;
    let maxProgress = -1;
    
    Object.keys(activePlayers).forEach(sid => {
        const p = activePlayers[sid];
        if (p.progress > maxProgress) {
            maxProgress = p.progress;
            leader = p;
        }
    });
    
    if (leader && leader.mesh) {
        const leaderPos = new THREE.Vector3();
        leader.mesh.getWorldPosition(leaderPos);
        
        // Slide OrbitControls target to track leader (top-down centered)
        controls.target.lerp(new THREE.Vector3(-100, 10, leaderPos.z), 0.04);
        
        // Camera follows directly above (top-down)
        camera.position.z += (leaderPos.z - camera.position.z) * 0.04;
    }
}

// Explosion VFX Animation
function trigger3DExplosion(x, y, z) {
    // 1. Expanding shockwave sphere mesh
    const expGeom = new THREE.SphereGeometry(1, 32, 32);
    const expMat = new THREE.MeshBasicMaterial({
        color: 0xff3300,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending
    });
    const expSphere = new THREE.Mesh(expGeom, expMat);
    expSphere.position.set(x, y, z);
    scene.add(expSphere);
    
    // 2. Rising particle sparks
    const sparkCount = 80;
    const sparkGeom = new THREE.BufferGeometry();
    const positions = [];
    const velocities = [];
    
    for (let i = 0; i < sparkCount; i++) {
        positions.push(x, y, z);
        // Random velocity sphere distribution
        velocities.push(
            (Math.random() - 0.5) * 15,
            Math.random() * 20 + 5,
            (Math.random() - 0.5) * 15
        );
    }
    
    sparkGeom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    
    const sparkMat = new THREE.PointsMaterial({
        color: 0xffaa00,
        size: 2.0,
        transparent: true,
        opacity: 1.0,
        blending: THREE.AdditiveBlending
    });
    
    const sparkPoints = new THREE.Points(sparkGeom, sparkMat);
    scene.add(sparkPoints);
    
    // Add to animation queue
    activeExplosions.push({
        sphere: expSphere,
        sparks: sparkPoints,
        velocities: velocities,
        age: 0,
        maxAge: 45 // frames count
    });
}

function animateExplosions() {
    for (let i = activeExplosions.length - 1; i >= 0; i--) {
        const exp = activeExplosions[i];
        exp.age++;
        
        if (exp.age >= exp.maxAge) {
            scene.remove(exp.sphere);
            scene.remove(exp.sparks);
            activeExplosions.splice(i, 1);
            continue;
        }
        
        const ratio = exp.age / exp.maxAge;
        
        // Expand sphere
        exp.sphere.scale.setScalar(ratio * 30);
        exp.sphere.material.opacity = 1.0 - ratio;
        
        // Apply particles velocities
        const positions = exp.sparks.geometry.attributes.position.array;
        for (let j = 0; j < positions.length / 3; j++) {
            positions[j*3] += exp.velocities[j*3] * 0.03; // vx
            positions[j*3+1] += exp.velocities[j*3+1] * 0.03; // vy
            positions[j*3+2] += exp.velocities[j*3+2] * 0.03; // vz
            
            // Gravity downward pull
            exp.velocities[j*3+1] -= 0.35;
        }
        exp.sparks.geometry.attributes.position.needsUpdate = true;
        exp.sparks.material.opacity = 1.0 - ratio;
    }
}

// Play background music once admin interacts
document.body.addEventListener("click", () => {
    sfxAmbient.play().catch(() => {});
    // startLobbyMusic(); // Đã tắt theo yêu cầu
}, { once: true });

function updateLobbyUI(players) {
    connectedCount.innerText = players.length;
    lobbyPlayersGrid.innerHTML = "";

    if (players.length === 0) {
        lobbyPlayersGrid.innerHTML = `<div class="no-players">Đang đợi các thuyền trưởng tham gia...</div>`;
        startGameBtn.disabled = true;
        startButtonEnabled = false;
        return;
    }

    players.forEach((p) => {
        const badge = document.createElement("div");
        badge.className = "player-lobby-badge";
        badge.style.borderLeft = `3px solid ${p.color}`;
        badge.innerHTML = `
            <span class="player-color-dot" style="background: ${p.color}; box-shadow: 0 0 8px ${p.color};"></span>
            <span>${p.name}</span>
        `;
        lobbyPlayersGrid.appendChild(badge);
    });

    sync3DPlayers(players);
    startGameBtn.disabled = false;
    startButtonEnabled = true;
}

async function refreshAdminPresence() {
    if (!ablyChannel || isRefreshingPresence) return;
    isRefreshingPresence = true;
    try {
        let players = await getPresenceMembers(ablyChannel);
        if (window.activeBots && window.activeBots.length > 0) {
            players = [...players, ...window.activeBots];
        }
        if (!gameStarted) {
            updateLobbyUI(players);
        } else {
            sync3DPlayers(players);
            updateLiveLeaderboard();
        }
    } catch (e) {
        console.warn("admin presence sync failed:", e);
    } finally {
        setTimeout(() => {
            isRefreshingPresence = false;
        }, 1000);
    }
}

function setupAdminAbly(channel) {
    channel.presence.subscribe(() => {
        refreshAdminPresence();
    });

    channel.subscribe("pos", (msg) => {
        const data = msg.data;
        if (!data?.id) return;

        if (activePlayers[data.id]) {
            activePlayers[data.id].progress = data.progress ?? activePlayers[data.id].progress;
            activePlayers[data.id].rank = data.rank ?? activePlayers[data.id].rank;
            activePlayers[data.id].targetX = data.x;
            activePlayers[data.id].targetZ = data.z;
            updateLiveLeaderboard();
            trackWinnerFromPos(data);
        } else {
            // Create a temporary placeholder to prevent redundant presence queries
            activePlayers[data.id] = {
                sid: data.id,
                loading: true,
                progress: data.progress ?? 0.0,
                targetZ: START_Z - ((data.progress ?? 0.0) * TOTAL_DIST),
                laneX: -232 // placeholder lane
            };
            refreshAdminPresence();
        }
    });

    channel.subscribe("answer", (msg) => {
        const data = msg.data;
        if (!data?.id) return;

        if (activePlayers[data.id]) {
            let statusText = "Chưa Trả Lời";
            let statusClass = "status-waiting";

            if (data.type === "boost") {
                statusText = "Đã Dùng Phản Lực";
                statusClass = "status-correct";
                addEventLog(`${data.name} đã dùng Phản Lực! (+15m)`);
            } else if (data.isCorrect) {
                statusText = "Đã Trả Lời Đúng";
                statusClass = "status-correct";
                addEventLog(`${data.name} trả lời đúng! (+10m)`);
            } else {
                statusText = "Đã Trả Lời Sai";
                statusClass = "status-wrong";
                addEventLog(`${data.name} trả lời sai!`);
            }

            activePlayers[data.id].answerStatus = {
                text: statusText,
                className: statusClass
            };

            updateLiveLeaderboard();

            if (activePlayers[data.id].statusTimeout) {
                clearTimeout(activePlayers[data.id].statusTimeout);
            }

            activePlayers[data.id].statusTimeout = setTimeout(() => {
                if (activePlayers[data.id]) {
                    activePlayers[data.id].answerStatus = {
                        text: "Đang Chờ",
                        className: "status-waiting"
                    };
                    updateLiveLeaderboard();
                }
            }, 3500);
        }
    });

    channel.subscribe("current-question", (msg) => {
        const data = msg.data;
        if (!data || !gameStarted) return;
        if (adminQuestionPanel) {
            adminQuestionPanel.classList.add("active");
            
            const badge = document.getElementById("admin-question-badge");
            if (badge) badge.innerText = `CÂU HỎI ${data.questionNum}`;
            
            const playerLabel = document.getElementById("admin-question-player");
            if (playerLabel) {
                playerLabel.innerText = `LƯỢT ĐUA CỦA: ${data.playerName}`;
                playerLabel.style.color = data.color || "#00f2fe";
            }
            
            const questionText = document.getElementById("admin-question-text");
            if (questionText) questionText.innerText = data.question_text;
            
            const container = document.getElementById("admin-options-container");
            if (container) {
                container.innerHTML = "";
                const keys = ["A", "B", "C", "D"];
                data.options.forEach((opt, idx) => {
                    const row = document.createElement("div");
                    row.className = "admin-option-row";
                    row.setAttribute("data-index", idx);
                    row.innerHTML = `
                        <span class="admin-option-key">${keys[idx]}</span>
                        <span class="admin-option-text">${opt}</span>
                    `;
                    container.appendChild(row);
                });
            }
        }
    });
}

function addEventLog(text) {
    if (!logEventsList) return;
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const timeStr = `${hours}:${minutes}`;

    const item = document.createElement("div");
    item.className = "event-log-item";
    item.innerHTML = `<span style="color: rgba(255,255,255,0.6); font-weight: 500; margin-right: 8px;">${timeStr}</span> - <span style="color: rgba(255,255,255,0.85);">${text}</span>`;

    logEventsList.appendChild(item);
    logEventsList.scrollTop = logEventsList.scrollHeight;
}

function trackWinnerFromPos(data) {
    if ((data.progress ?? 0) < 1) return;
    if (adminWinners.find((w) => w.sid === data.id)) return;

    const p = activePlayers[data.id];
    const raceTime = gameStartTime > 0 ? (Date.now() - gameStartTime) / 1000 : 30.0;
    adminWinners.push({
        sid: data.id,
        name: p?.name || "Player",
        color: p?.color || "#fff",
        rank: adminWinners.length + 1,
        race_time: raceTime,
    });

    if (activePlayers[data.id]) {
        activePlayers[data.id].rank = adminWinners.length;
    }

    const totalPlayersCount = Object.keys(activePlayers).length;
    const targetLimit = Math.max(1, Math.min(3, totalPlayersCount));
    if (adminWinners.length >= targetLimit) {
        endGameAsAdmin();
    }
}

async function endGameAsAdmin() {
    gameStarted = false;
    const players = await getPresenceMembers(ablyChannel);

    // Save each winner's score to backend SQLite DB
    for (const w of adminWinners) {
        try {
            await fetch("/api/leaderboard", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    name: w.name,
                    color: w.color,
                    rank: w.rank,
                    score: w.rank === 1 ? 15 : (w.rank === 2 ? 10 : 5),
                    race_time: w.race_time
                })
            });
        } catch (e) {
            console.error("Lỗi khi lưu bảng xếp hạng:", e);
        }
    }

    ablyChannel.publish("admin", {
        type: "game_over",
        t: Date.now(),
        winners: adminWinners,
        players,
    });

    onGameOver({ winners: adminWinners, players });
}

function publishAdmin(type) {
    if (!ablyChannel) return;
    ablyChannel.publish("admin", { type, t: Date.now() });
}

function paintBoat(boatGroup, colorHex) {
    if (!boatGroup) return;
    const color = new THREE.Color(colorHex);
    boatGroup.traverse((child) => {
        if (child.isMesh) {
            // Xóa vertex colors để không bị đè
            if (child.geometry && child.geometry.attributes.color) {
                child.geometry.deleteAttribute('color');
            }
            
            // Sơn TẤT CẢ mesh trong thuyền bằng màu chọn
            const paintMat = (mat) => {
                if (mat.name && mat.name.includes("_painted")) {
                    mat.color.copy(color);
                    mat.needsUpdate = true;
                    return mat;
                }
                return new THREE.MeshStandardMaterial({
                    color: color,
                    normalMap: mat.normalMap,
                    roughness: 0.3,
                    metalness: 0.2,
                    name: (mat.name || 'hull') + '_painted',
                    vertexColors: false
                });
            };

            if (Array.isArray(child.material)) {
                child.material = child.material.map(m => paintMat(m));
            } else if (child.material) {
                child.material = paintMat(child.material);
            }
        }
    });
}

function sync3DPlayers(playersList) {
    // 1. Remove old labels/meshes if disconnected
    const currentSids = playersList.map(p => p.sid);
    Object.keys(activePlayers).forEach(sid => {
        if (!currentSids.includes(sid)) {
            // Remove floating div safely
            if (activePlayers[sid].labelDiv) {
                const label = activePlayers[sid].labelDiv;
                if (document.body.contains(label)) {
                    document.body.removeChild(label);
                }
            }
            // Remove mesh
            if (activePlayers[sid].mesh && scene) {
                scene.remove(activePlayers[sid].mesh);
            }
            // Release assigned lane index
            if (laneMap[sid] !== undefined) {
                const laneIdx = laneMap[sid];
                usedLanes[laneIdx] = false;
                delete laneMap[sid];
            }
            delete activePlayers[sid];
        }
    });

    // 2. Assign stable lane index for all current players
    playersList.forEach(p => {
        if (laneMap[p.sid] === undefined) {
            let freeLane = 0;
            for (let i = 0; i < 100; i++) {
                if (!usedLanes[i]) {
                    freeLane = i;
                    break;
                }
            }
            laneMap[p.sid] = freeLane;
            usedLanes[freeLane] = true;
        }
    });

    // 3. Add or update players in scene
    playersList.forEach((p) => {
        const laneIndex = laneMap[p.sid];
        const laneX = -232 + laneIndex * 16; // Stable lane coordinates
        const startZPos = START_Z - ((p.progress || 0.0) * TOTAL_DIST);

        if (!activePlayers[p.sid] || activePlayers[p.sid].loading) {
            // Create floating HTML tag immediately if it doesn't exist yet
            let label = activePlayers[p.sid] ? activePlayers[p.sid].labelDiv : null;
            if (!label) {
                label = document.createElement("div");
                label.className = "floating-player-label";
                label.innerHTML = `${p.name} (${Math.round((p.progress || 0.0) * 100)}%)`;
                document.body.appendChild(label);
            }

            const existing = activePlayers[p.sid];
            activePlayers[p.sid] = {
                sid: p.sid,
                name: p.name,
                color: p.color,
                progress: existing ? existing.progress : (p.progress || 0.0),
                rank: p.rank || null,
                mesh: null,
                labelDiv: label,
                heaveOffset: Math.random() * Math.PI, // staggered waves wave phases
                targetZ: existing ? existing.targetZ : startZPos,
                laneX: laneX
            };

            const setupCompetitorBoat = (boat) => {
                boat.scale.set(2.5, 2.5, 2.5);
                const currentZ = START_Z - (activePlayers[p.sid].progress * TOTAL_DIST);
                boat.position.set(laneX, 24.0, currentZ);
                boat.rotation.y = Math.PI * 0.5; // Face towards -Z (France)
                
                boat.traverse((child) => {
                    if (child.isMesh) {
                        child.castShadow = false; // Tối ưu hóa tối đa: Toàn bộ thuyền trong màn hình Admin không đổ bóng (chỉ nhận bóng) để giữ 60 FPS ổn định khi theo dõi 30+ người chơi
                        child.receiveShadow = true;
                    }
                });
                
                scene.add(boat);

                // Paint Hull custom color
                paintBoat(boat, p.color);

                // Attach flying Vietnam flag to the stern
                attachVietnamFlag(boat);

                if (activePlayers[p.sid]) {
                    activePlayers[p.sid].mesh = boat;
                } else {
                    scene.remove(boat);
                }
            };

            // Instantiate dynamic boat model
            if (scene) {
                if (boatTemplate) {
                    setupCompetitorBoat(boatTemplate.clone());
                } else {
                    loader.load("helpers/boat/scene.gltf", (gltf) => {
                        if (!boatTemplate) boatTemplate = gltf.scene;
                        setupCompetitorBoat(boatTemplate.clone());
                    });
                }
            }
        } else {
            // Already exists, keep lane offsets but update names and stats
            activePlayers[p.sid].name = p.name;
            // Update color in real-time if player customized their boat in the lobby
            if (activePlayers[p.sid].mesh && activePlayers[p.sid].color !== p.color) {
                paintBoat(activePlayers[p.sid].mesh, p.color);
            }
            activePlayers[p.sid].color = p.color;
            activePlayers[p.sid].progress = p.progress || 0.0;
            activePlayers[p.sid].rank = p.rank || null;
            activePlayers[p.sid].laneX = laneX;
            activePlayers[p.sid].targetZ = startZPos;
        }
    });
}

startGameBtn.addEventListener("click", () => {
    if (!startButtonEnabled) return;
    adminWinners = [];
    gameStarted = true;
    gamePaused = false;
    publishAdmin("start");
    onGameStarted();
});

if (resetGameBtn) {
    resetGameBtn.addEventListener("click", () => {
        if (
            confirm(
                "Bạn có chắc chắn muốn buộc reset toàn bộ trạng thái trò chơi về Phòng chờ không? Các người chơi đã tham gia sẽ được giữ lại nhưng điểm số sẽ được reset về 0."
            )
        ) {
            adminWinners = [];
            gameStarted = false;
            gamePaused = false;
            publishAdmin("reset");
            onGameReset();
        }
    });
}

if (pauseGameBtn) {
    pauseGameBtn.addEventListener("click", () => {
        if (!gameStarted) return;
        gamePaused = !gamePaused;
        publishAdmin(gamePaused ? "pause" : "resume");
        onPauseStatus({ paused: gamePaused });
    });
}

function onPauseStatus(data) {
    if (pauseGameBtn) {
        if (data.paused) {
            pauseGameBtn.innerText = "TIẾP TỤC";
            pauseGameBtn.classList.add("paused");
        } else {
            pauseGameBtn.innerText = "TẠM DỪNG";
            pauseGameBtn.classList.remove("paused");
        }
    }
}

function onGameReset() {
    if (typeof stopStressTest === "function") {
        stopStressTest();
    }
    gameStarted = false;
    gameStartTime = 0;
    adminPanel.classList.add("active");
    if (lobbyPlayersPanel) {
        lobbyPlayersPanel.classList.add("active");
    }
    liveLeaderboard.classList.remove("active");
    if (adminStatusPanel) {
        adminStatusPanel.classList.remove("active");
    }
    podiumScreen.classList.remove("active");
    
    if (adminQuestionPanel) {
        adminQuestionPanel.classList.remove("active");
        const titleEl = document.getElementById("admin-question-text");
        if (titleEl) titleEl.innerText = "Đang đợi thuyền trưởng mở câu hỏi...";
        const container = document.getElementById("admin-options-container");
        if (container) container.innerHTML = "";
    }
    
    if (adminEventLogPanel) {
        adminEventLogPanel.classList.remove("active");
    }
    if (logEventsList) {
        logEventsList.innerHTML = "";
    }
    Object.keys(activePlayers).forEach(sid => {
        if (activePlayers[sid].statusTimeout) {
            clearTimeout(activePlayers[sid].statusTimeout);
            delete activePlayers[sid].statusTimeout;
        }
        delete activePlayers[sid].answerStatus;
    });
    
    // Switch background music from gameplay back to lobby
    stopNationalAnthem();
    stopBattleMusic();
    // startLobbyMusic(); // Đã tắt theo yêu cầu
    sfxAmbient.play().catch(() => {});
    
    if (pauseGameBtn) {
        pauseGameBtn.style.display = "none";
        pauseGameBtn.innerText = "TẠM DỪNG";
        pauseGameBtn.classList.remove("paused");
    }
    
    // Reset camera back to cinematic isometric 3D perspective
    if (controls && camera) {
        controls.target.set(-100, 10, START_Z);
        camera.position.set(-100, 250, START_Z);
    }
    
    // Reset all active players' stats and re-align/restore 3D meshes
    Object.keys(activePlayers).forEach(sid => {
        const p = activePlayers[sid];
        p.progress = 0.0;
        p.rank = null;
        if (p.mesh && scene) {
            // Restore position to start line using correct stable lane coordinate
            p.mesh.position.set(p.laneX, 24.0, START_Z);
            p.mesh.rotation.set(0, Math.PI * 0.5, 0); // Face towards -Z (France)
            p.mesh.scale.set(2.5, 2.5, 2.5); // Restore full scale in case it was capped/sinked
            
            // Re-add to the scene if it was capsized/sinked/removed
            if (!scene.children.includes(p.mesh)) {
                scene.add(p.mesh);
            }
        }
        if (p.labelDiv) {
            p.labelDiv.style.display = 'block';
            p.labelDiv.className = `floating-player-label`;
            p.labelDiv.innerHTML = `${p.name} (0%)`;
            if (!document.body.contains(p.labelDiv)) {
                document.body.appendChild(p.labelDiv);
            }
        }
    });
    
    updateLiveLeaderboard();
    refreshAdminPresence();
    
    if (botUpdateInterval) {
        clearInterval(botUpdateInterval);
        botUpdateInterval = null;
    }
    
    const simulate30Btn = document.getElementById("simulate-30-btn");
    if (simulate30Btn) {
        simulate30Btn.disabled = false;
        simulate30Btn.innerText = "MÔ PHỎNG 30 NGƯỜI CHƠI (TEST LOAD)";
        simulate30Btn.style.opacity = "1";
    }
}

function onGameStarted() {
    gameStartTime = Date.now();
    if (adminQuestionPanel) {
        adminQuestionPanel.classList.add("active");
    }
    
    // Kích hoạt di chuyển cho Bots giả lập nếu có
    if (window.activeBots && window.activeBots.length > 0) {
        if (botUpdateInterval) clearInterval(botUpdateInterval);
        botUpdateInterval = setInterval(() => {
            if (!gameStarted || gamePaused) return;
            
            let allFinished = true;
            window.activeBots.forEach(bot => {
                if (bot.progress < 1.0) {
                    allFinished = false;
                    // Tiến trình tăng dần ngẫu nhiên
                    bot.progress = Math.min(1.0, bot.progress + 0.001 + Math.random() * 0.003);
                    
                    const laneIndex = laneMap[bot.sid] || 0;
                    const laneX = -232 + laneIndex * 16;
                    const z = START_Z - (bot.progress * TOTAL_DIST);
                    
                    // 1. Cập nhật trực tiếp trạng thái của bot cục bộ trên máy Admin để Admin render ngay lập tức mượt mà không bị phụ thuộc vào trễ mạng hay trễ echo Ably
                    if (activePlayers[bot.sid]) {
                        activePlayers[bot.sid].progress = bot.progress;
                        activePlayers[bot.sid].targetX = laneX;
                        activePlayers[bot.sid].targetZ = z;
                        trackWinnerFromPos({ id: bot.sid, progress: bot.progress });
                    }
                    
                    // 2. Gửi qua Ably cho Client
                    if (ablyChannel) {
                        ablyChannel.publish("pos", {
                            id: bot.sid,
                            name: bot.name,
                            color: bot.color,
                            progress: bot.progress,
                            x: laneX,
                            z: z
                        });
                    }
                }
            });
            
            // Cập nhật Live Leaderboard thời gian thực trên màn hình Admin
            updateLiveLeaderboard();
            
            if (allFinished) {
                clearInterval(botUpdateInterval);
                botUpdateInterval = null;
            }
        }, 120);
    }
    adminPanel.classList.remove("active");
    if (lobbyPlayersPanel) {
        lobbyPlayersPanel.classList.remove("active");
    }
    liveLeaderboard.classList.add("active");
    if (adminStatusPanel) {
        adminStatusPanel.classList.add("active");
    }

    if (adminEventLogPanel) {
        adminEventLogPanel.classList.add("active");
    }
    if (logEventsList) {
        logEventsList.innerHTML = "";
    }
    Object.keys(activePlayers).forEach(sid => {
        if (activePlayers[sid].statusTimeout) {
            clearTimeout(activePlayers[sid].statusTimeout);
            delete activePlayers[sid].statusTimeout;
        }
        activePlayers[sid].answerStatus = { text: "Chưa Trả Lời", className: "status-waiting" };
    });

    if (pauseGameBtn) {
        pauseGameBtn.style.display = "block";
        pauseGameBtn.innerText = "TẠM DỪNG";
        pauseGameBtn.classList.remove("paused");
    }

    sfxHorn.play().catch(() => {});
    
    // Switch background music from lobby to gameplay (fully synthesized - no external URLs)
    stopLobbyMusic();
    sfxAmbient.pause();
    startBattleMusic();

    if (controls && camera) {
        controls.target.set(-100, 10, START_Z);
        camera.position.set(-100, 250, START_Z);
    }
    refreshAdminPresence();
}

function updateLiveLeaderboard() {
    // Sort players by progress descending
    const sorted = Object.values(activePlayers).sort((a, b) => b.progress - a.progress);
    
    if (statusPlayersList) {
        statusPlayersList.innerHTML = "";
        sorted.forEach((p, idx) => {
            const row = document.createElement("div");
            row.className = "gameplay-player-row";
            row.style.borderLeft = `3px solid ${p.color}`;
            
            const status = p.answerStatus || { text: "Chưa Trả Lời", className: "status-waiting" };
            
            row.innerHTML = `
                <div class="player-info-left">
                    <span class="player-rank-num">${idx + 1}.</span>
                    <span class="player-boat-icon" style="color: ${p.color};">⛵</span>
                    <span class="player-name-text">${p.name}</span>
                </div>
                <div class="status-badge ${status.className}">${status.text}</div>
            `;
            statusPlayersList.appendChild(row);
        });
    }

    if (leaderboardList) {
        leaderboardList.innerHTML = "";
        sorted.forEach((p, idx) => {
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
            leaderboardList.appendChild(row);
        });
    }
}

function onGameOver(data) {
    gameStarted = false;
    liveLeaderboard.classList.remove("active");
    if (adminStatusPanel) {
        adminStatusPanel.classList.remove("active");
    }
    if (lobbyPlayersPanel) {
        lobbyPlayersPanel.classList.remove("active");
    }
    podiumScreen.classList.add("active");
    
    if (adminQuestionPanel) {
        adminQuestionPanel.classList.remove("active");
    }
    
    if (adminEventLogPanel) {
        adminEventLogPanel.classList.remove("active");
    }
    Object.keys(activePlayers).forEach(sid => {
        if (activePlayers[sid].statusTimeout) {
            clearTimeout(activePlayers[sid].statusTimeout);
            delete activePlayers[sid].statusTimeout;
        }
    });

    if (pauseGameBtn) {
        pauseGameBtn.style.display = "none";
    }

    // Stop background music
    stopLobbyMusic();
    stopBattleMusic();

    // Play horn and launch continuous confetti
    sfxHorn.play().catch(() => {});
    sfxExplosion.play().catch(() => {});
    triggerAdminConfetti();
    playNationalAnthem();

    // Retrieve winner lists
    const top3 = data.winners; // rank 1, 2, 3
    
    // Render Podium Winner Details
    for (let r = 1; r <= 3; r++) {
        const winner = top3.find(w => w.rank === r);
        const avatarBox = document.getElementById(`podium-avatar-${r}`);
        if (winner) {
            avatarBox.innerHTML = `
                <div class="podium-boat-avatar" style="background-color: ${winner.color}">⛵</div>
                <div class="podium-name">${winner.name}</div>
            `;
        } else {
            avatarBox.innerHTML = `
                <div class="podium-boat-avatar" style="background-color: #333; color:#666;">❌</div>
                <div class="podium-name">Không có</div>
            `;
        }
    }

    // Explode all loser boats
    const winnerSids = top3.map(w => w.sid);
    
    Object.keys(activePlayers).forEach(sid => {
        const p = activePlayers[sid];
        if (!winnerSids.includes(sid)) {
            // Blow it up!
            if (p.mesh) {
                const pos = new THREE.Vector3();
                p.mesh.getWorldPosition(pos);
                trigger3DExplosion(pos.x, pos.y, pos.z);
                
                // Animate wreck sinking
                let t = 0;
                const sinkInterval = setInterval(() => {
                    t += 0.05;
                    if (p.mesh.scale.x > 0.05) {
                        p.mesh.scale.set(2.5 - t, 2.5 - t, 2.5 - t);
                        p.mesh.position.y -= 0.12;
                        p.mesh.rotation.z += 0.05; // capsizing tilt
                    } else {
                        scene.remove(p.mesh);
                        if (p.labelDiv && document.body.contains(p.labelDiv)) {
                            document.body.removeChild(p.labelDiv);
                        }
                        clearInterval(sinkInterval);
                    }
                }, 30);
            }
        }
    });
}

function triggerAdminConfetti() {
    const end = Date.now() + (8 * 1000);

    (function frame() {
        confetti({
            particleCount: 5,
            angle: 60,
            spread: 55,
            origin: { x: 0 }
        });
        confetti({
            particleCount: 5,
            angle: 120,
            spread: 55,
            origin: { x: 1 }
        });

        if (Date.now() < end) {
            requestAnimationFrame(frame);
        }
    }());
}

async function initAdminAbly() {
    try {
        const clientId = createPlayerId().replace("player", "admin");
        const { channel } = await connectAbly({
            clientId,
            name: "Admin",
            color: "#ffffff",
            role: "admin",
        });
        ablyChannel = channel;
        setupAdminAbly(channel);
        await refreshAdminPresence();
    } catch (err) {
        console.error("Admin Ably connect failed:", err);
    }
}

try {
    if (!isWebGLAvailable()) {
        throw new Error("WebGL is not supported in this browser/device.");
    }
    init3D();
    animate();
} catch (e) {
    console.error("3D Graphics Initialization Failed. Applying 2D Fallback.", e);
    apply2DFallback();
}
initAdminAbly();

function isWebGLAvailable() {
    try {
        const canvas = document.createElement('canvas');
        return !!(window.WebGLRenderingContext && (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
    } catch (e) {
        return false;
    }
}

function apply2DFallback() {
    const container = document.getElementById("canvas-container");
    if (container) {
        container.innerHTML = ""; // Remove any glitched/white canvas
        container.classList.add("sea-fallback");
        
        // Dynamically inject beautiful cyber-ocean fallback styles
        let style = document.getElementById("fallback-style");
        if (!style) {
            style = document.createElement("style");
            style.id = "fallback-style";
            style.innerHTML = `
                .sea-fallback {
                    background: radial-gradient(circle at 50% 50%, #0d1e36 0%, #050b14 100%) !important;
                    position: absolute;
                    width: 100%;
                    height: 100%;
                    overflow: hidden;
                }
                .sea-fallback::before {
                    content: '';
                    position: absolute;
                    width: 200%;
                    height: 200%;
                    top: -50%;
                    left: -50%;
                    background-image: 
                        linear-gradient(rgba(0, 242, 254, 0.05) 1px, transparent 1px),
                        linear-gradient(90deg, rgba(0, 242, 254, 0.05) 1px, transparent 1px);
                    background-size: 40px 40px;
                    transform: rotate(15deg);
                    animation: grid-drift 30s linear infinite;
                    pointer-events: none;
                }
                .sea-fallback::after {
                    content: '';
                    position: absolute;
                    width: 100%;
                    height: 100%;
                    top: 0;
                    left: 0;
                    background: radial-gradient(circle at 50% 50%, transparent 30%, rgba(0,0,0,0.6) 80%);
                    pointer-events: none;
                }
                @keyframes grid-drift {
                    from { transform: rotate(15deg) translateY(0); }
                    to { transform: rotate(15deg) translateY(40px); }
                }
            `;
            document.head.appendChild(style);
        }
    }
}

// ==========================================================================
// Hall of Fame (Bảng Vàng Lịch Sử) Admin Logic
// ==========================================================================
const openHofBtn = document.getElementById("open-hof-btn");
const closeHofBtn = document.getElementById("close-hof-btn");
const hofModal = document.getElementById("hall-of-fame-modal");
const hofList = document.getElementById("hall-of-fame-list");

if (openHofBtn) {
    openHofBtn.addEventListener("click", () => {
        openHallOfFame();
    });
}

if (closeHofBtn) {
    closeHofBtn.addEventListener("click", () => {
        closeHallOfFame();
    });
}

if (hofModal) {
    hofModal.addEventListener("click", (e) => {
        if (e.target === hofModal) {
            closeHallOfFame();
        }
    });
}

function openHallOfFame() {
    if (hofModal) {
        hofModal.classList.add("active");
        fetchHallOfFameData();
    }
}

function closeHallOfFame() {
    if (hofModal) {
        hofModal.classList.remove("active");
    }
}

function fetchHallOfFameData() {
    if (!hofList) return;
    hofList.innerHTML = '<tr><td colspan="5" class="text-center">Đang tải dữ liệu xếp hạng...</td></tr>';
    
    fetch("/api/leaderboard")
        .then(response => response.json())
        .then(data => {
            if (data.success && data.leaderboard) {
                renderHallOfFame(data.leaderboard);
            } else {
                hofList.innerHTML = '<tr><td colspan="5" class="text-center" style="color: #e74c3c;">Lỗi tải bảng xếp hạng!</td></tr>';
            }
        })
        .catch(err => {
            console.error("Error fetching leaderboard:", err);
            hofList.innerHTML = '<tr><td colspan="5" class="text-center" style="color: #e74c3c;">Không thể kết nối đến máy chủ!</td></tr>';
        });
}

function renderHallOfFame(leaderboard) {
    if (leaderboard.length === 0) {
        hofList.innerHTML = '<tr><td colspan="5" class="text-center" style="color: #8da2c4;">Chưa có kỷ lục nào được ghi nhận.</td></tr>';
        return;
    }
    
    hofList.innerHTML = "";
    leaderboard.forEach((r, idx) => {
        const tr = document.createElement("tr");
        
        let rankClass = "";
        let rankDecor = r.rank;
        if (r.rank === 1) {
            rankClass = "hof-rank-1";
            rankDecor = "🥇 Vàng";
        } else if (r.rank === 2) {
            rankClass = "hof-rank-2";
            rankDecor = "🥈 Bạc";
        } else if (r.rank === 3) {
            rankClass = "hof-rank-3";
            rankDecor = "🥉 Đồng";
        }
        
        const minutes = Math.floor(r.race_time / 60);
        const seconds = (r.race_time % 60).toFixed(2);
        const timeStr = `${minutes > 0 ? minutes + "m " : ""}${seconds}s`;
        
        const dateObj = new Date(r.created_at);
        const dateStr = dateObj.toLocaleDateString("vi-VN", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit"
        });
        
        tr.innerHTML = `
            <td class="${rankClass}">${rankDecor}</td>
            <td>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: ${r.color}; box-shadow: 0 0 6px ${r.color};"></span>
                    <strong>${r.name}</strong>
                </div>
            </td>
            <td>${r.score}/15</td>
            <td style="color: #00f2fe; font-family: monospace; font-weight: bold;">${timeStr}</td>
            <td style="color: #8da2c4; font-size: 0.8rem;">${dateStr}</td>
        `;
        hofList.appendChild(tr);
    });
}

// ==========================================================================
// STRESS TEST 50 BOTS SYSTEM
// ==========================================================================
window.activeBots = [];
let botUpdateInterval = null;

const stressTestBtn = document.getElementById("stress-test-btn");
const stopStressTestBtn = document.getElementById("stop-stress-test-btn");

function generateBots(count) {
    const bots = [];
    const colors = [
        "#ff3838", "#ff9f1a", "#fff200", "#32ff7e", "#7efff5", 
        "#18dcff", "#7d5fff", "#c56cf0", "#ffb8b8", "#ffaf40", 
        "#fffa65", "#3ae374", "#17c0eb", "#7158e2", "#cd84f1",
        "#ff4d4d", "#ffaf40", "#ffcd3c", "#2bcbba", "#45aaf2"
    ];
    for (let i = 0; i < count; i++) {
        bots.push({
            id: `bot_${i + 1}`,
            sid: `bot_${i + 1}`,
            name: `Thuyền Trưởng ${i + 1}`,
            color: colors[i % colors.length],
            progress: 0.0,
            rank: null
        });
    }
    return bots;
}

if (stressTestBtn) {
    stressTestBtn.addEventListener("click", () => {
        if (window.activeBots && window.activeBots.length > 0) return;
        
        window.activeBots = generateBots(50);
        
        // Cập nhật hiển thị nút
        stressTestBtn.style.display = "none";
        if (stopStressTestBtn) stopStressTestBtn.style.display = "block";
        
        // Gửi sự kiện qua Ably để đồng bộ với Client
        if (ablyChannel) {
            ablyChannel.publish("admin", {
                type: "stress_test_start",
                bots: window.activeBots
            });
        }
        
        // Refresh UI
        refreshAdminPresence();
        addEventLog("🧪 Đã kích hoạt 50 Bots giả lập Stress Test!");
    });
}

if (stopStressTestBtn) {
    stopStressTestBtn.addEventListener("click", () => {
        stopStressTest();
    });
}

function stopStressTest() {
    if (botUpdateInterval) {
        clearInterval(botUpdateInterval);
        botUpdateInterval = null;
    }
    window.activeBots = [];
    
    if (stressTestBtn) stressTestBtn.style.display = "block";
    if (stopStressTestBtn) stopStressTestBtn.style.display = "none";
    
    if (ablyChannel) {
        ablyChannel.publish("admin", {
            type: "stress_test_stop"
        });
    }
    
    refreshAdminPresence();
    addEventLog("⏹️ Đã tắt 50 Bots giả lập.");
}

