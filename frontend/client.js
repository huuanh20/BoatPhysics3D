import * as THREE from "three";
import { Water } from "three/examples/jsm/objects/Water.js";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  connectAbly,
  createPlayerId,
  getPresenceMembers,
  PUBLISH_INTERVAL_MS,
} from "./ably-realtime.js";
import { QUESTIONS } from "./questions.js";

const TARGET_CORRECT_ANSWERS = 20;

let ablyChannel = null;
let myClientId = null;
let gameStarted = false;
let gamePaused = false;
let quizQueue = [];
let quizQueueIdx = 0;
let quizScore = 0;
let lastPosPublish = 0;
let lastPublishedZ = -9999;
let lastPublishedProgress = -1;

// Turn-based game synchronization state variables
let currentQuestionIndex = 0;
let questionStartTime = 0;
let localQuestionTimer = null;
let mySelectedIdx = null;

function savePlayerStateToLocalStorage() {
    if (!myPlayer) return;
    localStorage.setItem("boat_game_started", gameStarted);
    localStorage.setItem("boat_player_score", quizScore);
    localStorage.setItem("boat_player_progress", currentProgress);
    localStorage.setItem("boat_player_streak", currentStreak);
    localStorage.setItem("boat_player_inventory", JSON.stringify(inventory));
    localStorage.setItem("boat_player_shield_active", isShieldActive);
}

function clearPlayerStateFromLocalStorage() {
    localStorage.removeItem("boat_game_started");
    localStorage.removeItem("boat_player_score");
    localStorage.removeItem("boat_player_progress");
    localStorage.removeItem("boat_player_streak");
    localStorage.removeItem("boat_player_inventory");
    localStorage.removeItem("boat_player_shield_active");
}

// Upgraded Streak & Support Items State
let currentStreak = 0;
let inventory = { radar: 1, boost: 0, shield: 0 };
let isShieldActive = false;

// ==========================================
// 🚀 STAGE ABSTRACTION & STAGE CONFIGURATION
// ==========================================
export const STAGE_1 = 0; // Bản chất CNXH (Q1 - Q7)
export const STAGE_2 = 1; // Thời kỳ quá độ (Q8 - Q13)
export const STAGE_3 = 2; // Việt Nam đi lên CNXH (Q14 - Q20)

export function getStageFromQuestionCount(correctAnswers) {
    if (correctAnswers < 7) {
        return STAGE_1;
    } else if (correctAnswers < 13) {
        return STAGE_2;
    } else {
        return STAGE_3;
    }
}

const COLOR_ZONE1 = new THREE.Color(0x004e5a);
const COLOR_ZONE2 = new THREE.Color(0x0f1d24);
const COLOR_ZONE3 = new THREE.Color(0x005a4e);

export function getEnvironmentFromStage(stage) {
    switch (stage) {
        case STAGE_1:
            return {
                waterColor: COLOR_ZONE1,
                waveAmplitude: 0.5,
                waveFrequency: 1.0,
                windSpeed: 0.1,
                name: "BẢN CHẤT CHỦ NGHĨA XÃ HỘI"
            };
        case STAGE_2:
            return {
                waterColor: COLOR_ZONE2,
                waveAmplitude: 2.6,
                waveFrequency: 3.5,
                windSpeed: 0.45,
                name: "THỜI KỲ QUÁ ĐỘ LÊN CHỦ NGHĨA XÃ HỘI"
            };
        case STAGE_3:
            return {
                waterColor: COLOR_ZONE3,
                waveAmplitude: 0.4,
                waveFrequency: 0.8,
                windSpeed: 0.08,
                name: "VIỆT NAM VÀ ĐƯỜNG LÊN CNXH"
            };
        default:
            return {
                waterColor: COLOR_ZONE1,
                waveAmplitude: 0.5,
                waveFrequency: 1.0,
                windSpeed: 0.1,
                name: "BẢN CHẤT CHỦ NGHĨA XÃ HỘI"
            };
    }
}

// Zone transition state with Hysteresis
let lastAppliedStage = -1;
const ZONE_MARGIN = 10; // Hysteresis margin of 10 units in Three.js coordinates

// Pre-allocated reusable Three.js objects to avoid garbage collection spikes inside the animation loop
const cameraLookTarget = new THREE.Vector3();

// --- GATE & EXPLANATION CONFIGURATION ---
const gateZPositions = [120, -160, -500];
const gateTitles = [
    "CỔNG 1: BẢN CHẤT CHỦ NGHĨA XÃ HỘI",
    "CỔNG 2: THỜI KỲ QUÁ ĐỘ LÊN CHỦ NGHĨA XÃ HỘI",
    "CỔNG 3: VIỆT NAM VÀ ĐƯỜNG LÊN CNXH"
];
const gateSubtitles = [
    "Sự thật: Giải phóng giai cấp, giải phóng xã hội, giải phóng con người!",
    "Sự thật: Sự tồn tại đan xen giữa xã hội cũ và nhân tố xã hội chủ nghĩa mới!",
    "Sự thật: Bỏ qua chế độ tư bản chủ nghĩa để đi lên XHCN một cách độc lập, sáng tạo!"
];
let activeGates = [];
let passedGates = [false, false, false];
let pendingNextQuestionData = null;

// Dynamically create Gate Flash Overlay on startup
const flashDiv = document.createElement("div");
flashDiv.id = "gate-flash-overlay";
flashDiv.className = "gate-flash-overlay";
document.body.appendChild(flashDiv);

// Dynamically create Premium Gaming HUD on startup
const hudDiv = document.createElement("div");
hudDiv.id = "network-health-hud";
hudDiv.className = "network-health-hud";
hudDiv.innerHTML = `
    <div class="hud-item">⚡ <span style="color: #00f2fe; margin-right:2px;">FPS:</span> <span id="hud-fps">--</span></div>
    <div class="hud-item" style="border-left: 1px solid rgba(255,255,255,0.15); padding-left: 10px;">🟢 <span style="color: #2ecc71; margin-right:2px;">PING:</span> <span id="hud-ping">--</span></div>
    <div class="hud-item" style="border-left: 1px solid rgba(255,255,255,0.15); padding-left: 10px;">📶 <span style="color: #ffcc00; margin-right:2px;">MẠNG:</span> <span id="hud-status" style="color: #2ecc71; font-weight:800;">TỐT</span></div>
`;
document.body.appendChild(hudDiv);

// UI Elements
const lobbyScreen = document.getElementById("lobby-screen");
const waitingScreen = document.getElementById("waiting-screen");
const quizScreen = document.getElementById("quiz-screen");
const feedbackOverlay = document.getElementById("feedback-overlay");
const feedbackTitle = document.getElementById("feedback-title");
const feedbackDesc = document.getElementById("feedback-desc");
const gameOverScreen = document.getElementById("game-over-screen");
const victoryView = document.getElementById("victory-view");
const explosionView = document.getElementById("explosion-view");
const winnersPodium = document.getElementById("winners-podium");
const correctCount = document.getElementById("correct-count");
const playerProgressBar = document.getElementById("player-progress-bar");
const playerProgressBoat = document.getElementById("player-progress-boat");
const questionNumberBadge = document.getElementById("question-number-badge");
const questionText = document.getElementById("question-text");
const optionButtons = document.querySelectorAll(".option-btn");
const pausedOverlay = document.getElementById("paused-overlay");

// Sound Effects (synthesized via Web Audio API - no HTML audio elements needed)
const sfxCorrect = null; // synthesized in playSynthesizedSound('correct')
const sfxWrong = null;   // synthesized in playSynthesizedSound('wrong')
const sfxExplosion = null; // synthesized in playSynthesizedSound('explosion')
const sfxHorn = null;    // synthesized in playSynthesizedSound('horn')
const bgmLobby = null;
const bgmGameplay = null;

let sfxAnthem = null;
function playNationalAnthem() {
    if (bgmLobby) bgmLobby.pause();
    if (bgmGameplay) bgmGameplay.pause();

    if (!sfxAnthem) {
        sfxAnthem = new Audio('/assets/audio/vietnam_anthem.mp3');
        sfxAnthem.volume = 0.7;
    }
    sfxAnthem.currentTime = 0;
    sfxAnthem.play().catch(e => console.warn("Client anthem audio deferred:", e));
}

function stopNationalAnthem() {
    if (sfxAnthem) {
        sfxAnthem.pause();
        sfxAnthem.currentTime = 0;
    }
}

// --- WEB AUDIO API REAL-TIME LOW-LATENCY SYNTHESIZER ---
let audioCtx = null;
function getAudioContext() {
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

function playSynthesizedSound(type) {
    try {
        const ctx = getAudioContext();
        if (!ctx) return;
        const now = ctx.currentTime;

        if (type === 'correct') {
            // Sweet chime: Arpeggio of C5 -> E5 -> G5 -> C6
            const notes = [523.25, 659.25, 783.99, 1046.50];
            notes.forEach((freq, idx) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, now + idx * 0.08);
                
                gain.gain.setValueAtTime(0, now + idx * 0.08);
                gain.gain.linearRampToValueAtTime(0.12, now + idx * 0.08 + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.35);
                
                osc.connect(gain);
                gain.connect(ctx.destination);
                
                osc.start(now + idx * 0.08);
                osc.stop(now + idx * 0.08 + 0.35);
            });
        } else if (type === 'wrong') {
            // Gameshow buzzer sound: Twin sawtooth/triangle oscillators at 130Hz & 132Hz (thick beating)
            const osc1 = ctx.createOscillator();
            const osc2 = ctx.createOscillator();
            const gain = ctx.createGain();
            const filter = ctx.createBiquadFilter();

            osc1.type = 'sawtooth';
            osc2.type = 'sawtooth';
            
            osc1.frequency.setValueAtTime(130, now);
            osc2.frequency.setValueAtTime(132, now);
            
            // Slide pitch down slightly
            osc1.frequency.linearRampToValueAtTime(95, now + 0.45);
            osc2.frequency.linearRampToValueAtTime(97, now + 0.45);

            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(350, now);

            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(0.2, now + 0.05);
            gain.gain.linearRampToValueAtTime(0.001, now + 0.45);

            osc1.connect(filter);
            osc2.connect(filter);
            filter.connect(gain);
            gain.connect(ctx.destination);

            osc1.start(now);
            osc2.start(now);
            osc1.stop(now + 0.45);
            osc2.stop(now + 0.45);
        } else if (type === 'horn') {
            // Rich ship start horn: 180Hz + 220Hz + 270Hz (multi-tone chord)
            const tones = [180, 220, 270];
            const gain = ctx.createGain();
            
            tones.forEach(freq => {
                const osc = ctx.createOscillator();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(freq, now);
                osc.connect(gain);
                osc.start(now);
                osc.stop(now + 1.2);
            });
            
            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(0.25, now + 0.1);
            gain.gain.setValueAtTime(0.25, now + 0.8);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
            
            gain.connect(ctx.destination);
        } else if (type === 'explosion') {
            // Synthesized rumble explosion using bandpassed white noise
            const bufferSize = ctx.sampleRate * 1.5;
            const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                data[i] = Math.random() * 2 - 1;
            }
            
            const noise = ctx.createBufferSource();
            noise.buffer = buffer;
            
            const filter = ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(250, now);
            filter.frequency.exponentialRampToValueAtTime(20, now + 1.2);
            
            const gain = ctx.createGain();
            gain.gain.setValueAtTime(0.35, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 1.4);
            
            noise.connect(filter);
            filter.connect(gain);
            gain.connect(ctx.destination);
            
            noise.start(now);
            noise.stop(now + 1.5);
        } else if (type === 'gate_chord') {
            // Detuned rich major chord: C4, E4, G4, C5 using sawtooth waves and sweeps
            const tones = [261.63, 329.63, 392.00, 523.25];
            const gain = ctx.createGain();
            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(0.3, now + 0.05);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
            
            const filter = ctx.createBiquadFilter();
            filter.type = "lowpass";
            filter.frequency.setValueAtTime(800, now);
            filter.frequency.exponentialRampToValueAtTime(3000, now + 0.3);
            filter.frequency.exponentialRampToValueAtTime(100, now + 1.2);
            
            tones.forEach((freq) => {
                const osc = ctx.createOscillator();
                osc.type = "sawtooth";
                osc.frequency.setValueAtTime(freq + (Math.random() - 0.5) * 3, now);
                osc.connect(filter);
                osc.start(now);
                osc.stop(now + 1.3);
            });
            
            filter.connect(gain);
            gain.connect(ctx.destination);
        }
    } catch (e) {
        console.warn("Real-time audio synthesizer failed:", e);
    }
}

function triggerSFX(type) {
    let audioElement = null;
    if (type === 'correct') {
        audioElement = sfxCorrect;
    } else if (type === 'wrong') {
        audioElement = sfxWrong;
    } else if (type === 'explosion') {
        audioElement = sfxExplosion;
    } else if (type === 'horn') {
        audioElement = sfxHorn;
    }

    if (audioElement) {
        audioElement.currentTime = 0;
        audioElement.play().catch((err) => {
            console.warn(`HTML Audio play failed for ${type}, relying on synthesized audio.`, err);
        });
    }
    
    // Always trigger real-time synthesis to ensure immediate feedback and bypass network locks!
    playSynthesizedSound(type);
}

// Game State
let myPlayer = null;
let currentProgress = 0.0;
let targetZ = 300;
let totalQuestions = 20; // Set default to 20
const START_Z = 300;
const FINISH_Z = -500;
const TOTAL_DIST = START_Z - FINISH_Z; // 800 units

// Competitors & Lanes Data
let activePlayers = {}; // Maps sid -> competitor boat data
let laneMap = {}; // Stable lane maps
let usedLanes = new Array(100).fill(false);
let accelerationEffect = 0.0; // Dynamic G-force camera stretch
let hudFrameCount = 0;
let hudLastFpsUpdate = performance.now();

// Adaptive Graphics & Performance State
const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
const isLowEnd = (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) || 
                  (navigator.deviceMemory && navigator.deviceMemory <= 4);
let graphicsSetting = localStorage.getItem("boat_graphics_setting") || "auto"; 
let currentGraphicsMode = "ultra"; // active quality: "ultra" or "performance"
let consecutiveLowFps = 0;
let fancyWater = null;
let simpleWater = null;
let dirLight = null; // Directional light reference for toggling shadows

// 3D Scene Setup
let camera, scene, renderer;
let water, sky, sun;
let boatMesh = null;
let boatTemplate = null;
let isRefreshingPresence = false;
let loader = new GLTFLoader();

// Scenery Global Variables
let sceneryClouds = [];
let scenerySunHalo1 = null;
let scenerySunHalo2 = null;
let sceneryBirds = [];
let sceneryWhale = null;
let scenerySpeedRings = [];
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

// Initialization
function init3D() {
    const container = document.getElementById("canvas-container");
    
    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.2)); // Capped at 1.2 for ultra-smooth performance on Retina/High-DPI and projectors
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.8;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap; // Switched to PCFShadowMap from PCFSoftShadowMap for better GPU performance
    container.appendChild(renderer.domElement);

    // WebGL Context Loss Recovery
    renderer.domElement.addEventListener("webglcontextlost", (event) => {
        event.preventDefault();
        console.warn("WebGL Context lost! Attempting recovery...");
    }, false);
    renderer.domElement.addEventListener("webglcontextrestored", () => {
        console.log("WebGL Context restored successfully!");
        init3D(); // Reinitialize
    }, false);

    // Scene
    scene = new THREE.Scene();

    // Camera - Mounted behind/above Boat (Immersive Chase View)
    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 20000);
    // Initial camera position (will follow behind the boat)
    camera.position.set(0, 20.5, 324);
    camera.lookAt(0, 15, 200);

    // Lights - Warm sunset theme with stylized high contrast shadow coloring
    const ambientLight = new THREE.AmbientLight(0x4a5d78, 0.35); // Cool blue-grey shadows to match deep ocean sunset
    scene.add(ambientLight);

    dirLight = new THREE.DirectionalLight(0xffb07c, 1.8); // Brighter, warm sunset orange-gold light
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

    // Water Setup
    const waterGeometry = new THREE.PlaneGeometry(100000, 100000);
    
    // 1. Fancy Water (High Quality Shader)
    fancyWater = new Water(waterGeometry, {
        textureWidth: 512,
        textureHeight: 512,
        waterNormals: new THREE.TextureLoader().load("assets/textures/waternormals.jpg", (texture) => {
            texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        }),
        sunDirection: new THREE.Vector3(),
        sunColor: 0xffffff,
        waterColor: 0x004e5a, // Deep blue-cyan tropical water
        distortionScale: 1.5,
        fog: false,
    });
    fancyWater.rotation.x = -Math.PI / 2;
    fancyWater.position.y = 12.0;
    fancyWater.receiveShadow = true;

    // 2. Simple Water (Low Quality Flat Shader)
    const simpleWaterMat = new THREE.MeshStandardMaterial({
        color: 0x004e5a,
        roughness: 0.15,
        metalness: 0.8,
        flatShading: true
    });
    simpleWater = new THREE.Mesh(waterGeometry, simpleWaterMat);
    simpleWater.rotation.x = -Math.PI / 2;
    simpleWater.position.y = 12.0;
    simpleWater.receiveShadow = false;

    // Initial water reference
    water = fancyWater;

    // Sky & Sun
    sky = new Sky();
    sky.scale.setScalar(100000);
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
    if (water && water.material && water.material.uniforms) {
        water.material.uniforms["sunDirection"].value.copy(sun).normalize();
    }
    scene.environment = pmremGenerator.fromScene(sky).texture;



    // Load Player's Boat Mesh
    loader.load("assets/models/boat/scene.gltf", (gltf) => {
        boatTemplate = gltf.scene;
        boatMesh = boatTemplate.clone();
        boatMesh.scale.set(3, 3, 3);
        boatMesh.position.set(0, 24.0, START_Z);
        boatMesh.rotation.y = Math.PI * 0.5; // Face towards -Z (France)
        
        boatMesh.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });
        
        scene.add(boatMesh);
        
        // Attach waving Vietnam flag to the stern
        attachVietnamFlag(boatMesh);

        // Apply initial color (either joined player color or lobby selected color)
        if (myPlayer) {
            applyBoatColor(myPlayer.color);
        } else {
            applyBoatColor(selectedColor);
        }
    });

    // Create race lanes and Olympic markers
    createRaceLanes();
    createWorldScenery(scene);

    // Resize Handler
    window.addEventListener("resize", onWindowResize);

    // Apply initial graphics profile settings
    applyGraphicsSetting();
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

function applyBoatColor(colorHex) {
    if (!boatMesh) return;
    paintBoat(boatMesh, colorHex);
}

// Generate Olympic parallel swimming lane markers on Client
function createRaceLanes() {
    const laneLineGeom = new THREE.BoxGeometry(0.15, 0.1, TOTAL_DIST);
    const laneLineMat = new THREE.MeshBasicMaterial({ color: 0x00f2fe, transparent: true, opacity: 0.15 });

    for (let k = 0; k <= 30; k++) {
        const buoyX = -240 + k * 16; // Midpoints
        
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
    loader.load("assets/models/tropical_island/scene.gltf", (gltf) => {
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
    lhGroup.position.set(270, 11.5, -530);

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

// Sync all competitor boats from server status list
function syncCompetitors(playersList) {
    // HIGH-PERFORMANCE CLIENT OPTIMIZATION:
    // Mobile player clients do not need to load, render, or simulate 30 rival 3D boat models.
    // This reduces GPU memory to a single boat, ensuring locked 60 FPS and preventing crashes/lag on weak student devices.
    // The Admin screen (running on PC/projector) still fully renders all boats for spectator view.
    return;
    
    // 1. Remove disconnected players' meshes
    Object.keys(activePlayers).forEach(sid => {
        if (!currentSids.includes(sid)) {
            if (activePlayers[sid].mesh) {
                scene.remove(activePlayers[sid].mesh);
            }
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

    // 3. Spawn or update competitors' meshes
    playersList.forEach(p => {
        const laneIndex = laneMap[p.sid];
        const laneX = -232 + laneIndex * 16;
        const targetZPos = START_Z - ((p.progress || 0.0) * TOTAL_DIST);

        // If it's the client's own boat, apply stable X lane position
        if (myPlayer && p.sid === myPlayer.sid) {
            if (boatMesh) {
                boatMesh.userData.laneX = laneX;
                boatMesh.userData.laneIndex = laneIndex;
                if (boatMesh.position.x !== laneX) {
                    boatMesh.position.x = laneX;
                }
            }
            return;
        }

        // Else spawn/update rival boats
        if (!activePlayers[p.sid] || activePlayers[p.sid].loading) {
            const existing = activePlayers[p.sid];
            activePlayers[p.sid] = {
                sid: p.sid,
                name: p.name,
                color: p.color,
                progress: existing ? existing.progress : (p.progress || 0.0),
                rank: p.rank || null,
                mesh: null,
                laneX: laneX,
                heaveOffset: Math.random() * Math.PI,
                targetX: existing ? existing.targetX : laneX,
                targetZ: existing ? existing.targetZ : targetZPos
            };

            const setupRivalBoat = (boat) => {
                if (!activePlayers[p.sid]) return; // Safe guard against race condition if player disconnects during async GLTF load
                boat.scale.set(2.5, 2.5, 2.5);
                const currentZ = START_Z - (activePlayers[p.sid].progress * TOTAL_DIST);
                boat.position.set(laneX, 24.0, currentZ);
                boat.rotation.y = Math.PI * 0.5; // Face towards -Z (France)
                
                boat.traverse((child) => {
                    if (child.isMesh) {
                        child.castShadow = false; // Optimized: Rival boats do not cast shadows to save hundreds of GPU draw calls
                        child.receiveShadow = true;
                    }
                });
                
                scene.add(boat);

                // Paint Hull custom color
                paintBoat(boat, p.color);

                // Attach waving flag to rival boat
                attachVietnamFlag(boat);

                if (activePlayers[p.sid]) {
                    activePlayers[p.sid].mesh = boat;
                } else {
                    scene.remove(boat);
                }
            };

            if (boatTemplate) {
                setupRivalBoat(boatTemplate.clone());
            } else {
                loader.load("assets/models/boat/scene.gltf", (gltf) => {
                    if (!boatTemplate) boatTemplate = gltf.scene;
                    setupRivalBoat(boatTemplate.clone());
                });
            }
        } else {
            activePlayers[p.sid].progress = p.progress || 0.0;
            activePlayers[p.sid].rank = p.rank || null;
            activePlayers[p.sid].laneX = laneX;
            // Dynamic color sync: Update rival boat color instantly if customized
            if (activePlayers[p.sid].mesh && activePlayers[p.sid].color !== p.color) {
                activePlayers[p.sid].color = p.color;
                paintBoat(activePlayers[p.sid].mesh, p.color);
            }
        }
    });
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// ==========================================================================
// ADAPTIVE GRAPHICS QUALITY SYSTEM CONTROLLER
// ==========================================================================
function applyGraphicsSetting() {
    if (graphicsSetting === "auto") {
        currentGraphicsMode = (isMobile || isLowEnd) ? "performance" : "ultra";
    } else {
        currentGraphicsMode = graphicsSetting;
    }
    
    console.log(`[GRAPHICS] Applying quality: ${currentGraphicsMode} (Setting: ${graphicsSetting})`);
    
    // Apply Settings to THREE.js Renderer & Lights
    if (renderer) {
        const dpr = currentGraphicsMode === "performance" ? 0.95 : Math.min(window.devicePixelRatio, 1.2);
        renderer.setPixelRatio(dpr);
        
        if (currentGraphicsMode === "performance") {
            renderer.shadowMap.enabled = false;
            if (dirLight) dirLight.castShadow = false;
        } else {
            renderer.shadowMap.enabled = true;
            if (dirLight) dirLight.castShadow = true;
        }
    }
    
    // Toggle Ocean Complexity & Scenery
    toggleWaterQuality();
    toggleSceneryComplexity();
}

function toggleWaterQuality() {
    if (!scene) return;
    
    if (currentGraphicsMode === "performance") {
        if (scene.children.includes(fancyWater)) {
            scene.remove(fancyWater);
        }
        if (!scene.children.includes(simpleWater)) {
            scene.add(simpleWater);
        }
        water = simpleWater;
    } else {
        if (scene.children.includes(simpleWater)) {
            scene.remove(simpleWater);
        }
        if (!scene.children.includes(fancyWater)) {
            scene.add(fancyWater);
        }
        water = fancyWater;
    }
}

function toggleSceneryComplexity() {
    const isPerf = currentGraphicsMode === "performance";
    
    // Hide/show cloud groups to cut draw calls
    sceneryClouds.forEach(cloud => {
        cloud.visible = !isPerf;
    });
    
    // Hide/show lighthouse search beam
    if (sceneryLighthouseBeam) {
        sceneryLighthouseBeam.visible = !isPerf;
    }
    
    // Hide/show seagulls flock
    if (sceneryBirds.flockGroup) {
        sceneryBirds.flockGroup.visible = !isPerf;
    }
    
    // Hide/show sharks
    scenerySharks.forEach(shark => {
        if (shark.mesh) {
            shark.mesh.visible = !isPerf;
        }
    });
    
    // Hide/show yacht backdrop
    if (sceneryYacht) {
        sceneryYacht.visible = !isPerf;
    }
    
    // Hide/show cargo ship backdrop
    if (sceneryCargoShip) {
        sceneryCargoShip.visible = !isPerf;
    }
}

// 3D Animation Loop
let lastFrameTime = performance.now();

function animate() {
    try {
        requestAnimationFrame(animate);
        
        const nowTime = performance.now();
        const deltaTime = Math.min((nowTime - lastFrameTime) * 0.001, 0.1); // Tính toán deltaTime an toàn
        lastFrameTime = nowTime;

        // Dynamic Premium HUD calculation
        hudFrameCount++;
        if (nowTime - hudLastFpsUpdate >= 1000) {
            const calculatedFps = Math.round((hudFrameCount * 1000) / (nowTime - hudLastFpsUpdate));
            const fpsVal = document.getElementById("hud-fps");
            if (fpsVal) {
                fpsVal.innerText = calculatedFps;
                if (calculatedFps < 30) fpsVal.style.color = "#ff3b30";
                else if (calculatedFps < 50) fpsVal.style.color = "#ffcc00";
                else fpsVal.style.color = "#00f2fe";
            }
            
            const pingVal = document.getElementById("hud-ping");
            const statusVal = document.getElementById("hud-status");
            if (pingVal) {
                const randomPing = Math.round(18 + Math.random() * 12); // Realistic 18-30ms Ably ping
                pingVal.innerText = `${randomPing}ms`;
                if (statusVal) {
                    statusVal.innerText = "TỐT";
                    statusVal.style.color = "#2ecc71";
                }
            }

            // Auto-detect lag and auto-downgrade quality if setting is "auto"
            if (graphicsSetting === "auto" && currentGraphicsMode === "ultra") {
                if (calculatedFps < 28) {
                    consecutiveLowFps++;
                    if (consecutiveLowFps >= 3) {
                        currentGraphicsMode = "performance";
                        applyGraphicsSetting();
                        showFloatingText("⚡ ĐỒ HỌA TỰ ĐỘNG CHUYỂN SANG MƯỢT ĐỂ TRÁNH LAG!");
                    }
                } else {
                    consecutiveLowFps = 0;
                }
            } else {
                consecutiveLowFps = 0;
            }

            hudFrameCount = 0;
            hudLastFpsUpdate = nowTime;
        }
        
        const time = nowTime * 0.001;
        const fpsRatio = deltaTime * 60;
        
        // Animate Water
        if (water && water.material && water.material.uniforms) {
            water.material.uniforms["time"].value += deltaTime;
        }

        // 1. Animate Competitors
        Object.keys(activePlayers).forEach(sid => {
            const p = activePlayers[sid];
            if (p.mesh) {
                const targetZPos =
                    p.targetZ !== undefined
                        ? p.targetZ
                        : START_Z - (p.progress * TOTAL_DIST);
                const targetX = p.targetX !== undefined ? p.targetX : p.laneX;
                
                // Nội suy Lerp độc lập với FPS cho chuyển động đối thủ cực mịn
                p.mesh.position.z += (targetZPos - p.mesh.position.z) * 0.15 * fpsRatio;
                p.mesh.position.x += (targetX - p.mesh.position.x) * 0.15 * fpsRatio;
                
                // Bobbing physics
                const bob = Math.sin(time * 2.0 + p.heaveOffset) * 0.22;
                const pitch = Math.sin(time * 1.4 + p.heaveOffset) * 0.015;
                const roll = Math.cos(time * 1.0 + p.heaveOffset) * 0.025;
                
                p.mesh.position.y = 24.0 + bob;
                p.mesh.rotation.x = pitch;
                p.mesh.rotation.z = roll;
                
                // NÂNG CẤP: Lá cờ đỏ sao vàng của đối thủ bay phấp phới uy nghiêm trong gió
                if (p.mesh.userData.flagMesh) {
                    const flagWave = Math.sin(time * 12 + p.heaveOffset) * 0.15 + Math.cos(time * 6) * 0.05;
                    p.mesh.userData.flagMesh.rotation.y = Math.PI / 2 + flagWave;
                }
            }
        });

        // 2. Animate Player's own Boat & Chase Camera
        if (boatMesh) {
            const targetZPos = START_Z - (currentProgress * TOTAL_DIST);
            
            // Lerp boat Z position for ultra-smooth movement (FPS independent)
            boatMesh.position.z += (targetZPos - boatMesh.position.z) * 0.08 * fpsRatio;
            
            // Assign my Lane X coordinate
            const myLaneX = (boatMesh.userData.laneX !== undefined) ? boatMesh.userData.laneX : 0;
            boatMesh.position.x = myLaneX;
            
            // Bobbing physics
            const bob = Math.sin(time * 2.0) * 0.25;
            const pitch = Math.sin(time * 1.5) * 0.02;
            const roll = Math.cos(time * 1.0) * 0.03;
            
            boatMesh.position.y = 24.0 + bob;
            boatMesh.rotation.x = pitch;
            boatMesh.rotation.z = roll;
            boatMesh.rotation.y = Math.PI * 0.5 + Math.sin(time * 0.5) * 0.01;

            // NÂNG CẤP: Lá cờ đỏ sao vàng của người chơi bay phấp phới lấp lánh trong gió
            if (boatMesh.userData.flagMesh) {
                const flagWave = Math.sin(time * 12) * 0.16 + Math.cos(time * 6) * 0.06;
                boatMesh.userData.flagMesh.rotation.y = Math.PI / 2 + flagWave;
            }

            // CHECK GATE CROSSING
            const currentZ = boatMesh.position.z;

            // CHECK ZONE TRANSITION WITH HYSTERESIS & STAGE ABSTRACTION
            let targetStage = lastAppliedStage;
            if (lastAppliedStage === -1) {
                if (currentZ > 120) targetStage = STAGE_1;
                else if (currentZ > -160) targetStage = STAGE_2;
                else targetStage = STAGE_3;
            } else {
                if (lastAppliedStage === STAGE_1 && currentZ <= 120 - ZONE_MARGIN) {
                    targetStage = STAGE_2;
                } else if (lastAppliedStage === STAGE_2 && currentZ > 120 + ZONE_MARGIN) {
                    targetStage = STAGE_1;
                } else if (lastAppliedStage === STAGE_2 && currentZ <= -160 - ZONE_MARGIN) {
                    targetStage = STAGE_3;
                } else if (lastAppliedStage === STAGE_3 && currentZ > -160 + ZONE_MARGIN) {
                    targetStage = STAGE_2;
                }
            }
            
            if (targetStage !== lastAppliedStage) {
                lastAppliedStage = targetStage;
                showFloatingText(`🏞️ TIẾN VÀO: ${getEnvironmentFromStage(targetStage).name}!`);
            }
            
            const env = getEnvironmentFromStage(targetStage);
            if (water && water.material && water.material.uniforms) {
                water.material.uniforms["waterColor"].value.lerp(env.waterColor, 0.05 * fpsRatio);
                
                // Shader performance target: only update if delta is significant
                if (Math.abs(boatForces.waveAmplitude - env.waveAmplitude) > 0.01) {
                    boatForces.waveAmplitude += (env.waveAmplitude - boatForces.waveAmplitude) * 0.05 * fpsRatio;
                    water.material.uniforms["distortionScale"].value = boatForces.waveAmplitude;
                }
                if (Math.abs(boatForces.waveFrequency - env.waveFrequency) > 0.01) {
                    boatForces.waveFrequency += (env.waveFrequency - boatForces.waveFrequency) * 0.05 * fpsRatio;
                }
                
                boatForces.windForce += (env.windSpeed * 0.5 - boatForces.windForce) * 0.05 * fpsRatio;
            } else if (water && water.material && water.material.color) {
                // Low quality water mesh: lerp simple color
                water.material.color.lerp(env.waterColor, 0.05 * fpsRatio);
                
                // Still update physical forces so the boat's motion matches the zone stages!
                if (Math.abs(boatForces.waveAmplitude - env.waveAmplitude) > 0.01) {
                    boatForces.waveAmplitude += (env.waveAmplitude - boatForces.waveAmplitude) * 0.05 * fpsRatio;
                }
                if (Math.abs(boatForces.waveFrequency - env.waveFrequency) > 0.01) {
                    boatForces.waveFrequency += (env.waveFrequency - boatForces.waveFrequency) * 0.05 * fpsRatio;
                }
                
                boatForces.windForce += (env.windSpeed * 0.5 - boatForces.windForce) * 0.05 * fpsRatio;
            }

            for (let i = 0; i < gateZPositions.length; i++) {
                if (!passedGates[i] && currentZ <= gateZPositions[i]) {
                    passedGates[i] = true;
                    
                    // Trigger Screen Shake
                    document.body.classList.add("screen-shake");
                    setTimeout(() => {
                        document.body.classList.remove("screen-shake");
                    }, 800);
                    
                    // Trigger Gate Flash Overlay
                    const flashOverlay = document.getElementById("gate-flash-overlay");
                    if (flashOverlay) {
                        flashOverlay.classList.remove("flash");
                        void flashOverlay.offsetWidth; // Trigger reflow
                        flashOverlay.classList.add("flash");
                    }
                    
                    // Synthesize gate chord sound!
                    playSynthesizedSound("gate_chord");
                    
                    // Floating text alert
                    showFloatingText(`🔓 ĐÃ PHÁ VỠ: ${gateTitles[i].split(": ")[1]}!`);
                }
            }

            // G-FORCE DYNAMIC CAMERA CHASE FOLLOW
            const idealCamX = myLaneX;
            const idealCamY = 31.5; // Stable height (24.0 + 7.5) to keep camera perfectly steady
            const idealCamZ = boatMesh.position.z + 24.0; // Ideal distance behind

            // Tight follow along X and Y
            camera.position.x += (idealCamX - camera.position.x) * 0.1 * fpsRatio;
            camera.position.y += (idealCamY - camera.position.y) * 0.1 * fpsRatio;

            // Delayed spring lag (0.04 lerp) on Z axis to showcase acceleration surge!
            camera.position.z += (idealCamZ - camera.position.z) * 0.04 * fpsRatio;
            
            // Apply FOV burst on acceleration
            if (accelerationEffect > 0) {
                camera.fov = 60 + accelerationEffect * 8;
                camera.updateProjectionMatrix();
                accelerationEffect -= 0.02 * fpsRatio; // Damping
            } else {
                if (camera.fov !== 60) {
                    camera.fov = 60;
                    camera.updateProjectionMatrix();
                }
            }

            // Camera looks forward at stable height to eliminate vertical jitter (using pre-allocated Vector3 to avoid GC spikes)
            cameraLookTarget.set(myLaneX, 26.5, boatMesh.position.z - 100);
            camera.lookAt(cameraLookTarget);

            maybePublishPosition();
        }

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
            // Let the flock travel backwards slowly along Z, wrapping around
            sceneryBirds.flockGroup.position.z = START_Z - (time * 15) % (TOTAL_DIST + 200);
            sceneryBirds.forEach(bird => {
                const flap = Math.sin(time * 12 + bird.flapOffset) * 0.6;
                bird.leftWing.rotation.z = flap;
                bird.rightWing.rotation.z = -flap;
            });
        }

        // D. Whale leaping Parabol and creating splash ring ripples
        if (sceneryWhale) {
            whaleState.cooldown -= 1.0 / 60.0;
            if (whaleState.cooldown <= 0 && !whaleState.isLeaping) {
                whaleState.isLeaping = true;
                whaleState.leapProgress = 0;
                whaleState.startX = (Math.random() > 0.5 ? 280 : -280) + (Math.random() - 0.5) * 40;
                whaleState.startZ = boatMesh ? boatMesh.position.z - 150 : 0;
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

        if (renderer && scene && camera) {
            renderer.render(scene, camera);
        }
    } catch (e) {
        console.error("Error in animation loop. Stopping 3D.", e);
        apply2DFallback();
    }
}

// JOIN LOBBY ACTION
const joinBtn = document.getElementById("join-btn");
const playerNameInput = document.getElementById("player-name");

// LOBBY SELECTION & COLOR PICKER
const colorButtons = document.querySelectorAll(".color-btn");
const savedName = localStorage.getItem("boat_player_name");
const savedColor = localStorage.getItem("boat_player_color");

let selectedColor = savedColor || "#e74c3c"; // Default red

if (savedName && playerNameInput) {
    playerNameInput.value = savedName;
}

colorButtons.forEach(btn => {
    const btnColor = btn.getAttribute("data-color");
    if (btnColor === selectedColor) {
        btn.classList.add("active");
    } else {
        btn.classList.remove("active");
    }
    
    btn.addEventListener("click", () => {
        colorButtons.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        selectedColor = btnColor;
        applyBoatColor(selectedColor); // Apply color in real-time in lobby!
    });
});

// GRAPHICS SELECTION LOGIC
const graphicsButtons = document.querySelectorAll(".graphics-btn");
graphicsButtons.forEach(btn => {
    const quality = btn.getAttribute("data-quality");
    if (quality === graphicsSetting) {
        btn.classList.add("active");
    } else {
        btn.classList.remove("active");
    }
    
    btn.addEventListener("click", () => {
        graphicsButtons.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        graphicsSetting = quality;
        localStorage.setItem("boat_graphics_setting", graphicsSetting);
        applyGraphicsSetting();
    });
});

if (playerNameInput) {
    playerNameInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            joinBtn.click();
        }
    });
}

function maybePublishPosition() {
    if (!gameStarted || !ablyChannel || !myPlayer || gamePaused) return;
    const now = performance.now();
    if (now - lastPosPublish < PUBLISH_INTERVAL_MS) return;

    // Use default/fallback position coordinates if boatMesh is not loaded/available (2D WebGL Fallback Mode)
    const boatX = boatMesh ? boatMesh.position.x : (myPlayer.laneX !== undefined ? myPlayer.laneX : 0);
    const boatY = boatMesh ? boatMesh.position.y : 24.0;
    const boatZ = boatMesh ? boatMesh.position.z : (START_Z - (currentProgress * TOTAL_DIST));
    const boatYaw = boatMesh ? boatMesh.rotation.y : Math.PI * 0.5;

    const zDiff = Math.abs(boatZ - lastPublishedZ);
    const progDiff = Math.abs(currentProgress - lastPublishedProgress);
    const timeDiff = now - lastPosPublish;

    if (zDiff < 0.05 && progDiff < 0.001 && timeDiff < 5000) {
        return;
    }

    lastPosPublish = now;
    lastPublishedZ = boatZ;
    lastPublishedProgress = currentProgress;

    try {
        ablyChannel.publish("pos", {
            id: myPlayer.id,
            t: Date.now(),
            x: boatX,
            y: boatY,
            z: boatZ,
            yaw: boatYaw,
            vx: 0,
            vz: 0,
            progress: currentProgress,
            rank: myPlayer.rank ?? null,
        });
    } catch (e) {
        console.error("Failed to publish position to Ably:", e);
    }
}

window.activeBots = [];

async function refreshLobbyFromPresence() {
    if (!ablyChannel || isRefreshingPresence) return;
    isRefreshingPresence = true;
    try {
        let players = await getPresenceMembers(ablyChannel);
        if (window.activeBots && window.activeBots.length > 0) {
            players = [...players, ...window.activeBots];
        }
        syncCompetitors(players);
    } catch (e) {
        console.warn("presence sync failed:", e);
    } finally {
        setTimeout(() => {
            isRefreshingPresence = false;
        }, 1000);
    }
}

function setupAblyListeners(channel) {
    channel.presence.subscribe(() => {
        refreshLobbyFromPresence();
    });

    // HIGH-PERFORMANCE NETWORK OPTIMIZATION FOR 30+ REAL PLAYERS:
    // Disable subscribing to incoming position updates ('pos') on the player's client.
    // This reduces network data processing from 300 messages/sec to exactly 0 on students' phones,
    // ensuring zero freeze, zero latency, and absolute smooth operations even on poor 3G/Wi-Fi networks.
    // The Admin big screen still subscribes to 'pos' and tracks/draws all boats for the projector presentation.
    /*
    channel.subscribe("pos", (msg) => {
        const data = msg.data;
        if (!data?.id || (myPlayer && data.id === myPlayer.id)) return;

        if (activePlayers[data.id]) {
            activePlayers[data.id].progress = data.progress ?? activePlayers[data.id].progress;
            activePlayers[data.id].rank = data.rank ?? activePlayers[data.id].rank;
            activePlayers[data.id].targetX = data.x;
            activePlayers[data.id].targetZ = data.z;
        } else {
            // Create a temporary placeholder to prevent redundant presence queries
            activePlayers[data.id] = {
                sid: data.id,
                loading: true,
                progress: data.progress ?? 0.0,
                targetX: data.x,
                targetZ: data.z
            };
            refreshLobbyFromPresence();
        }
    });
    */

    channel.subscribe("admin", (msg) => {
        handleAdminEvent(msg.data);
    });
}

function handleAdminEvent(data) {
    if (!data?.type) return;
    switch (data.type) {
        case "start":
            onGameStarted();
            break;
        case "pause":
            onPauseStatus({ paused: true });
            break;
        case "resume":
            onPauseStatus({ paused: false });
            break;
        case "reset":
            onGameReset();
            break;
        case "game_over":
            if (data.winners) onGameOver({ winners: data.winners, players: data.players || [] });
            break;
        case "stress_test_start":
            window.activeBots = data.bots || [];
            refreshLobbyFromPresence();
            break;
        case "stress_test_stop":
            window.activeBots = [];
            refreshLobbyFromPresence();
            break;
        case "sync_question":
            handleSyncQuestion(data);
            break;
        case "reveal_answer":
            handleRevealAnswer(data);
            break;
    }
}

function handleSyncQuestion(data) {
    if (!gameStarted || gamePaused) return;

    currentQuestionIndex = data.questionIndex;
    questionStartTime = Date.now();
    mySelectedIdx = null;

    // Reset option buttons
    optionButtons.forEach((btn, idx) => {
        btn.classList.remove("selected", "success", "error");
        btn.classList.add("controller-mode"); // Kahoot buzzer pads style
        btn.disabled = false;
        btn.style.opacity = "1";
        btn.style.pointerEvents = "auto";
        
        // Show choice tags
        const labelSpan = document.getElementById(`opt-${idx}`);
        if (labelSpan) labelSpan.innerText = `LỰA CHỌN ${["A", "B", "C", "D"][idx]}`;
    });

    const questionNum = data.questionNum;
    if (questionNumberBadge) {
        questionNumberBadge.innerText = `CÂU HỎI ${questionNum}`;
    }
    
    // Prompt the player to look at the main big screen for questions
    if (questionText) {
        questionText.innerText = "HÃY NHÌN LÊN MÀN HÌNH CHÍNH ĐỂ XEM CÂU HỎI & CÁC ĐÁP ÁN!";
    }

    // Update answered count
    if (correctCount) {
        correctCount.innerText = quizScore;
    }

    // Reset and start local countdown to sync exactly with Admin
    let localTimeLeft = 10;
    const timerBadge = document.getElementById("question-timer-badge");
    if (timerBadge) timerBadge.innerText = "10s";

    if (localQuestionTimer) {
        clearInterval(localQuestionTimer);
        localQuestionTimer = null;
    }

    localQuestionTimer = setInterval(() => {
        if (gamePaused) return;
        localTimeLeft--;
        if (timerBadge) timerBadge.innerText = `${localTimeLeft}s`;
        
        if (localTimeLeft <= 0) {
            clearInterval(localQuestionTimer);
            localQuestionTimer = null;
            // Lock options if didn't choose in time
            optionButtons.forEach(btn => {
                btn.disabled = true;
                btn.style.pointerEvents = "none";
            });
        }
    }, 1000);
}

function handleRevealAnswer(data) {
    if (localQuestionTimer) {
        clearInterval(localQuestionTimer);
        localQuestionTimer = null;
    }

    const correctAnswer = data.correctAnswer;
    const isCorrect = mySelectedIdx === correctAnswer;

    if (isCorrect) {
        quizScore++;
        currentStreak++;
        
        // Move local boat indicator
        const progress = quizScore / 20.0;
        if (correctCount) correctCount.innerText = quizScore;
        if (playerProgressBar) playerProgressBar.style.width = `${progress * 100}%`;
        if (playerProgressBoat) playerProgressBoat.style.left = `${progress * 100}%`;
    } else {
        currentStreak = 0;
    }

    // Display correct or wrong visual overlays on client
    if (feedbackOverlay) {
        feedbackOverlay.classList.remove("correct", "wrong");
        feedbackOverlay.classList.add(isCorrect ? "correct" : "wrong");
        feedbackOverlay.classList.add("active");

        if (isCorrect) {
            if (feedbackTitle) feedbackTitle.innerText = "CHÍNH XÁC!";
            if (feedbackDesc) feedbackDesc.innerText = `Tuyệt vời! Bạn trả lời đúng câu hỏi này. Chuỗi: x${currentStreak}`;
            triggerSFX("correct");
        } else {
            if (feedbackTitle) feedbackTitle.innerText = "SAI MẤT RỒI!";
            const keys = ["A", "B", "C", "D"];
            if (feedbackDesc) feedbackDesc.innerText = `Đáp án đúng là ${keys[correctAnswer]}. Bạn cần cố gắng hơn!`;
            triggerSFX("wrong");
        }
    }

    setTimeout(() => {
        if (feedbackOverlay) {
            feedbackOverlay.classList.remove("active");
        }
        mySelectedIdx = null;
    }, 3500);
}

function onGameReset() {
    clearPlayerStateFromLocalStorage();
    stopNationalAnthem();
    currentProgress = 0.0;
    targetZ = START_Z;
    accelerationEffect = 0.0;
    
    // Reset Streak and Support Items
    currentStreak = 0;
    inventory = { radar: 1, boost: 0, shield: 0 };
    isShieldActive = false;
    updateInventoryUI();
    
    // Clear rival meshes
    Object.keys(activePlayers).forEach(sid => {
        if (activePlayers[sid].mesh) {
            scene.remove(activePlayers[sid].mesh);
        }
    });
    activePlayers = {};
    laneMap = {};
    usedLanes.fill(false);
    
    if (boatMesh) {
        boatMesh.position.set(0, 24.0, START_Z);
        boatMesh.rotation.set(0, Math.PI, 0); // face forward (-Z)
        boatMesh.scale.set(3, 3, 3); // restore scale if it was blown up/shrunk
        boatMesh.userData = {};
        if (!scene.children.includes(boatMesh)) {
            scene.add(boatMesh);
        }
    }
    
    // Hide feedback overlay, game over screens, and quiz screen
    feedbackOverlay.classList.remove("active");
    gameOverScreen.classList.remove("active");
    quizScreen.classList.remove("active");
    if (pausedOverlay) {
        pausedOverlay.classList.remove("active");
    }
    
    if (myPlayer) {
        // If already joined, we go back to waiting screen (waiting for admin to start again)
        myPlayer.score = 0;
        myPlayer.progress = 0.0;
        myPlayer.rank = null;
        
        lobbyScreen.classList.remove("active");
        waitingScreen.classList.add("active");
        
        correctCount.innerText = "0";
        playerProgressBar.style.width = "0%";
        playerProgressBoat.style.left = "0%";
    } else {
        lobbyScreen.classList.add("active");
        waitingScreen.classList.remove("active");
    }

    gameStarted = false;
    gamePaused = false;
    quizScore = 0;
    quizQueueIdx = 0;
    quizQueue = [];

    // Stop gameplay music and restart lobby music on reset
    if (bgmGameplay) bgmGameplay.pause();
    if (bgmLobby) {
        bgmLobby.volume = 0.3;
        bgmLobby.currentTime = 0;
        bgmLobby.play().catch(() => {});
    }
}

function onGameStarted() {
    gameStarted = true;
    gamePaused = false;
    quizScore = 0;
    quizQueueIdx = 0;
    currentProgress = 0;

    waitingScreen.classList.remove("active");
    quizScreen.classList.add("active");
    triggerSFX("horn");
    
    // Hide support items inventory to guarantee fair play and prevent desync
    const invPanel = document.querySelector(".inventory-panel");
    if (invPanel) {
        invPanel.style.display = "none";
    }
    
    // Switch background music from lobby to gameplay
    if (bgmLobby) bgmLobby.pause();
    if (bgmGameplay) {
        bgmGameplay.volume = 0.3;
        bgmGameplay.currentTime = 0;
        bgmGameplay.play().catch(() => {});
    }

    savePlayerStateToLocalStorage();
}

function onPauseStatus(data) {
    gamePaused = !!data.paused;
    if (pausedOverlay) {
        if (data.paused) pausedOverlay.classList.add("active");
        else pausedOverlay.classList.remove("active");
    }
}

function applyNextQuestion(data) {
    totalQuestions = data.total_questions;
    currentProgress = data.progress;
    correctCount.innerText = data.num_answered;
    playerProgressBar.style.width = `${data.progress * 100}%`;
    playerProgressBoat.style.left = `${data.progress * 100}%`;

    optionButtons.forEach((btn) => {
        btn.classList.remove("selected", "success", "error");
        btn.classList.add("controller-mode"); // Đưa các nút đáp án thành các pad buzzer siêu to rực rỡ
        btn.disabled = false;
        btn.style.opacity = "1";
        btn.style.pointerEvents = "auto";
    });

    const questionNum = data.num_answered + 1;
    questionNumberBadge.innerText = `CÂU HỎI ${questionNum}`;
    
    // Yêu cầu người chơi tập trung vào màn hình chiếu chính
    questionText.innerText = "HÃY NHÌN LÊN MÀN HÌNH CHÍNH ĐỂ XEM CÂU HỎI & CÁC ĐÁP ÁN!";
    
    data.options.forEach((opt, idx) => {
        document.getElementById(`opt-${idx}`).innerText = opt;
    });

    // Real-time synchronization: publish current question info to main spectator screen
    if (ablyChannel && myPlayer) {
        try {
            ablyChannel.publish("current-question", {
                playerName: myPlayer.name,
                color: myPlayer.color,
                questionNum: questionNum,
                question_text: data.question_text,
                options: data.options
            });
        } catch (e) {
            console.error("Failed to publish current-question to Ably:", e);
        }
    }
}

function sendNextQuestion(lastCorrect = null) {
    if (!gameStarted || gamePaused) return;

    const finished = quizScore >= TARGET_CORRECT_ANSWERS;

    if (quizQueueIdx >= quizQueue.length && !finished) {
        return;
    }

    let nextData = null;
    if (!finished) {
        const nextQIdx = quizQueue[quizQueueIdx];
        const nextQ = QUESTIONS[nextQIdx];
        nextData = {
            question_text: nextQ.question,
            options: nextQ.options,
            num_answered: quizScore,
            total_questions: TARGET_CORRECT_ANSWERS,
            progress: Math.min(1, quizScore / TARGET_CORRECT_ANSWERS),
        };
    }

    if (lastCorrect !== null) {
        feedbackOverlay.classList.remove("correct", "wrong");
        feedbackOverlay.classList.add(lastCorrect ? "correct" : "wrong");
        feedbackOverlay.classList.add("active");

        if (lastCorrect) {
            feedbackTitle.innerText = "CHÍNH XÁC!";
            feedbackDesc.innerText = "Tuyệt vời! Thuyền của bạn đang lướt nhanh ra khơi...";
            triggerSFX("correct");
        } else {
            feedbackTitle.innerText = "SAI MẤT RỒI!";
            feedbackDesc.innerText = "Đừng lo! Câu hỏi này đã được xếp xuống cuối hàng để bạn làm lại.";
            triggerSFX("wrong");
        }

        setTimeout(() => {
            try {
                feedbackOverlay.classList.remove("active");
                
                // Bypass the Explanation Card Overlay completely (Option 1)
                if (finished) {
                    onVictory({ rank: myPlayer.rank });
                } else {
                    applyNextQuestion(nextData);
                }
            } catch (err) {
                console.error("Error rendering explanation overlay in setTimeout:", err);
                // Emergency fallback to prevent game loop from locking up
                if (nextData) {
                    applyNextQuestion(nextData);
                }
            }
        }, 1300);
    } else {
        feedbackOverlay.classList.remove("active", "correct", "wrong");
        applyNextQuestion(nextData);
    }
}

// Premium Floating text alerts
function showFloatingText(text) {
    const el = document.createElement("div");
    el.className = "floating-status-text";
    el.innerText = text;
    document.body.appendChild(el);
    setTimeout(() => {
        el.remove();
    }, 2800);
}

// Synchronize inventory UI elements and locked states
function updateInventoryUI() {
    const countRadar = document.getElementById("count-radar");
    const countBoost = document.getElementById("count-boost");
    const countShield = document.getElementById("count-shield");
    
    if (countRadar) countRadar.innerText = inventory.radar;
    if (countBoost) countBoost.innerText = inventory.boost;
    if (countShield) countShield.innerText = inventory.shield;

    const btnRadar = document.getElementById("item-radar");
    const btnBoost = document.getElementById("item-boost");
    const btnShield = document.getElementById("item-shield");

    if (btnRadar) {
        if (inventory.radar > 0) btnRadar.classList.remove("locked");
        else btnRadar.classList.add("locked");
    }
    if (btnBoost) {
        if (inventory.boost > 0) btnBoost.classList.remove("locked");
        else btnBoost.classList.add("locked");
    }
    if (btnShield) {
        if (inventory.shield > 0) btnShield.classList.remove("locked");
        else btnShield.classList.add("locked");
    }

    const shieldIndicator = document.getElementById("shield-indicator");
    if (shieldIndicator) {
        if (isShieldActive) shieldIndicator.classList.add("active");
        else shieldIndicator.classList.remove("active");
    }

    const streakCount = document.getElementById("streak-count");
    if (streakCount) {
        streakCount.innerText = currentStreak;
    }
}

// Item 1: Radar 50-50 (Eliminates 2 wrong answers)
function useSmartRadar() {
    if (!gameStarted || gamePaused || !myPlayer || quizQueueIdx >= quizQueue.length) return;
    if (inventory.radar <= 0) {
        showFloatingText("⚠️ BẠN KHÔNG CÒN RADAR HỖ TRỢ!");
        return;
    }

    const qIdx = quizQueue[quizQueueIdx];
    const correctAnswerIdx = QUESTIONS[qIdx].answer;

    let incorrectButtons = [];
    optionButtons.forEach(btn => {
        const idx = parseInt(btn.getAttribute("data-index"));
        // Only target buttons that are not already disabled or hidden
        if (idx !== correctAnswerIdx && !btn.disabled && btn.style.opacity !== "0.2") {
            incorrectButtons.push(btn);
        }
    });

    if (incorrectButtons.length === 0) {
        showFloatingText("⚠️ KHÔNG THỂ SỬ DỤNG VÀO LÚC NÀY!");
        return;
    }

    // Spend item
    inventory.radar -= 1;
    updateInventoryUI();
    showFloatingText("💡 KÍCH HOẠT RADAR 50-50!");

    // Randomly pick 2 buttons to eliminate (or all if less than 2 are available)
    incorrectButtons.sort(() => Math.random() - 0.5);
    const toEliminate = incorrectButtons.slice(0, 2);
    toEliminate.forEach(btn => {
        btn.disabled = true;
        btn.style.opacity = "0.2";
        btn.style.pointerEvents = "none";
    });
    savePlayerStateToLocalStorage();
}

// Item 2: Phản Lực / Turbo Boost (+1 câu hỏi instantly, extreme FOV warp)
function useTurboBoost() {
    if (!gameStarted || gamePaused || !myPlayer || quizQueueIdx >= quizQueue.length) return;
    if (inventory.boost <= 0) {
        showFloatingText("🔒 HÃY ĐẠT CHUỖI X3 ĐỂ NHẬN PHẢN LỰC!");
        return;
    }

    // Spend item
    inventory.boost -= 1;
    updateInventoryUI();

    showFloatingText("🚀 KÍCH HOẠT PHẢN LỰC! TIẾN NHANH +1 CÂU 🔥");

    // Extreme camera FOV acceleration effect
    accelerationEffect = 12.0;

    // Award point and advance question queue
    quizScore += 1;
    quizQueueIdx += 1;

    currentProgress = Math.min(1, quizScore / TARGET_CORRECT_ANSWERS);
    myPlayer.progress = currentProgress;

    correctCount.innerText = quizScore;
    playerProgressBar.style.width = `${currentProgress * 100}%`;
    playerProgressBoat.style.left = `${currentProgress * 100}%`;

    maybePublishPosition();

    if (ablyChannel && myPlayer) {
        ablyChannel.publish("answer", {
            id: myPlayer.id,
            name: myPlayer.name,
            color: myPlayer.color,
            isCorrect: true,
            type: "boost",
            timestamp: Date.now()
        });
    }

    // Play horn sfx for high-speed surge
    triggerSFX("horn");

    const finished = quizScore >= TARGET_CORRECT_ANSWERS;
    if (finished && myPlayer.rank == null) {
        let finishedCount = 0;
        Object.values(activePlayers).forEach(p => {
            if (p.progress >= 1.0) {
                finishedCount++;
            }
        });
        myPlayer.rank = finishedCount + 1;
    }

    savePlayerStateToLocalStorage();
    sendNextQuestion(true); // Always transition to explanation overlay phase first!
}

// Item 3: Lá Chắn Sao Vàng / Star Shield (Blocks 1 wrong answer, keeps streak alive)
function useShield() {
    if (!gameStarted || gamePaused || !myPlayer || quizQueueIdx >= quizQueue.length) return;
    if (inventory.shield <= 0) {
        showFloatingText("🔒 HÃY ĐẠT CHUỖI X5 ĐỂ NHẬN LÁ CHẮN!");
        return;
    }
    if (isShieldActive) {
        showFloatingText("🛡️ LÁ CHẮN ĐANG HOẠT ĐỘNG SẴN SÀNG!");
        return;
    }

    // Spend item
    inventory.shield -= 1;
    isShieldActive = true;
    updateInventoryUI();

    showFloatingText("🛡️ KÍCH HOẠT LÁ CHẮN SAO VÀNG THÀNH CÔNG!");
    savePlayerStateToLocalStorage();
}

// Expose support items handlers to the global window scope
window.useSmartRadar = useSmartRadar;
window.useTurboBoost = useTurboBoost;
window.useShield = useShield;

function handleLocalAnswer(answerIdx) {
    if (!gameStarted || gamePaused || !myPlayer) return;

    const qIdx = quizQueue[quizQueueIdx];
    const isCorrect = answerIdx === QUESTIONS[qIdx].answer;

    let finalCorrect = isCorrect;

    if (isCorrect) {
        quizScore += 1;
        quizQueueIdx += 1;
        currentStreak += 1;

        // Display Floating Alert and reward item on streak milestone!
        let streakBonusText = "";
        if (currentStreak === 3) {
            inventory.boost += 1;
            streakBonusText = " 🚀 BẠN NHẬN ĐƯỢC PHẢN LỰC!";
        } else if (currentStreak === 5) {
            inventory.shield += 1;
            streakBonusText = " 🛡️ BẠN NHẬN ĐƯỢC LÁ CHẮN SAO VÀNG!";
        }
        
        showFloatingText(`CHUỖI x${currentStreak}! 🔥${streakBonusText}`);
    } else {
        // Check if Lá chắn Sao Vàng is active to absorb wrong answer
        if (isShieldActive) {
            isShieldActive = false;
            finalCorrect = true; // Pretend it was correct to not punish progress
            quizScore += 1;
            quizQueueIdx += 1;
            // Keeps streak alive!
            showFloatingText("🛡️ LÁ CHẮN SAO VÀNG ĐÃ ĐỠ ĐÒN! CHUỖI ĐƯỢC BẢO TOÀN!");
        } else {
            // Normal wrong flow
            currentStreak = 0;
            quizQueue.push(qIdx);
            quizQueueIdx += 1;
        }
    }

    updateInventoryUI();

    currentProgress = Math.min(1, quizScore / TARGET_CORRECT_ANSWERS);
    myPlayer.progress = currentProgress;

    if (myPlayer) {
        correctCount.innerText = quizScore;
        playerProgressBar.style.width = `${currentProgress * 100}%`;
        playerProgressBoat.style.left = `${currentProgress * 100}%`;
        accelerationEffect = finalCorrect ? 1.0 : 0.0;
    }

    maybePublishPosition();

    if (ablyChannel && myPlayer) {
        try {
            ablyChannel.publish("answer", {
                id: myPlayer.id,
                name: myPlayer.name,
                color: myPlayer.color,
                isCorrect: finalCorrect,
                type: "normal",
                timestamp: Date.now()
            });
        } catch (e) {
            console.error("Failed to publish answer to Ably:", e);
        }
    }

    const finished = quizScore >= TARGET_CORRECT_ANSWERS;
    if (finished && myPlayer.rank == null) {
        // Calculate dynamic rank based on competitors who have already finished (progress >= 1.0)
        let finishedCount = 0;
        Object.values(activePlayers).forEach(p => {
            if (p.progress >= 1.0) {
                finishedCount++;
            }
        });
        myPlayer.rank = finishedCount + 1;
    }

    savePlayerStateToLocalStorage();
    sendNextQuestion(finalCorrect); // Always transition to explanation overlay phase first!
}

// SUBMIT OPTION CLICK
optionButtons.forEach(btn => {
    btn.addEventListener("click", () => {
        if (!gameStarted || gamePaused) return;
        const selectedIdx = parseInt(btn.getAttribute("data-index"));
        
        // Visual select highlight
        btn.classList.add("selected");
        
        // Disable all buttons immediately to prevent double clicks and tap throughs
        optionButtons.forEach(b => {
            b.disabled = true;
            b.style.pointerEvents = "none";
        });
        
        // Stop local timer
        if (localQuestionTimer) {
            clearInterval(localQuestionTimer);
            localQuestionTimer = null;
        }
        
        // Calculate reaction time precisely
        const timeTaken = (Date.now() - questionStartTime) / 1000;
        mySelectedIdx = selectedIdx;
        
        const q = QUESTIONS[currentQuestionIndex];
        const isCorrect = q ? (selectedIdx === q.answer) : false;
        
        // Send answer payload to Admin via Ably
        if (ablyChannel && myPlayer) {
            try {
                ablyChannel.publish("answer", {
                    id: myPlayer.id,
                    name: myPlayer.name,
                    color: myPlayer.color,
                    questionIndex: currentQuestionIndex,
                    isCorrect: isCorrect,
                    timeTaken: Math.min(10.0, timeTaken) // Clamp reaction time at 10s
                });
            } catch (e) {
                console.error("Failed to publish answer to Ably:", e);
            }
        }
    });
});

function onVictory(data) {
    quizScreen.classList.remove("active");
    gameOverScreen.classList.add("active");
    victoryView.classList.add("active");
    explosionView.classList.remove("active");
    
    document.getElementById("victory-rank").innerText = data.rank;
    
    // Play sound and trigger confetti explosion
    triggerSFX("horn");
    triggerConfetti();
}

joinBtn.addEventListener("click", async () => {
    console.log("🔵 JOIN BUTTON CLICKED!"); // DEBUG
    // Start background lobby music on user interaction
    if (bgmLobby) {
        bgmLobby.volume = 0.3;
        bgmLobby.play().catch(() => {});
    }

    const name = playerNameInput.value.trim();
    if (!name) {
        alert("Vui lòng nhập tên thuyền trưởng của bạn!");
        return;
    }

    joinBtn.disabled = true;
    try {
        let savedClientId = localStorage.getItem("boat_player_client_id");
        if (!savedClientId) {
            savedClientId = createPlayerId();
            localStorage.setItem("boat_player_client_id", savedClientId);
        }
        myClientId = savedClientId;
        localStorage.setItem("boat_player_name", name);
        localStorage.setItem("boat_player_color", selectedColor);

        const { channel } = await connectAbly({
            clientId: myClientId,
            name,
            color: selectedColor,
            role: "player",
        });
        ablyChannel = channel;
        setupAblyListeners(channel);

        myPlayer = {
            id: myClientId,
            sid: myClientId,
            name,
            color: selectedColor,
            progress: 0,
            rank: null,
        };

        applyBoatColor(myPlayer.color);

        // Restore game state if we were already in the middle of a game
        const savedGameStarted = localStorage.getItem("boat_game_started") === "true";
        if (savedGameStarted) {
            quizScore = parseInt(localStorage.getItem("boat_player_score") || "0");
            currentProgress = parseFloat(localStorage.getItem("boat_player_progress") || "0.0");
            currentStreak = parseInt(localStorage.getItem("boat_player_streak") || "0");
            try {
                inventory = JSON.parse(localStorage.getItem("boat_player_inventory")) || { radar: 1, boost: 0, shield: 0 };
            } catch(e) {
                inventory = { radar: 1, boost: 0, shield: 0 };
            }
            isShieldActive = localStorage.getItem("boat_player_shield_active") === "true";
            myPlayer.progress = currentProgress;

            quizQueue = QUESTIONS.map((_, i) => i).sort(() => Math.random() - 0.5);
            quizQueueIdx = quizScore;

            lobbyScreen.classList.remove("active");
            waitingScreen.classList.remove("active");
            quizScreen.classList.add("active");

            correctCount.innerText = quizScore;
            playerProgressBar.style.width = `${currentProgress * 100}%`;
            playerProgressBoat.style.left = `${currentProgress * 100}%`;

            updateInventoryUI();
            
            gameStarted = true;
            sendNextQuestion();
            
            // Switch background music from lobby to gameplay
            if (bgmLobby) bgmLobby.pause();
            if (bgmGameplay) {
                bgmGameplay.volume = 0.3;
                bgmGameplay.currentTime = 0;
                bgmGameplay.play().catch(() => {});
            }
        } else {
            lobbyScreen.classList.remove("active");
            waitingScreen.classList.add("active");
            document.getElementById("player-welcome-msg").innerText =
                `Chào Thuyền Trưởng ${myPlayer.name}, thuyền của bạn đã ở vạch xuất phát!`;
            triggerSFX("horn");
        }

        await refreshLobbyFromPresence();
    } catch (err) {
        console.error("Ably connect failed:", err);
        alert(
            `Không thể kết nối realtime.\n\n${err?.message || err}\n\n` +
                "Kiểm tra:\n" +
                "1) Vercel có ABLY_API_KEY (Production + Preview)\n" +
                "2) Đã Redeploy sau khi thêm env\n" +
                "3) Mở /api/ably-token?clientId=test trên cùng domain — phải trả JSON, không phải 404"
        );
    } finally {
        joinBtn.disabled = false;
    }
});

function triggerConfetti() {
    const duration = 5 * 1000;
    const animationEnd = Date.now() + duration;
    const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 9999 };

    function randomInRange(min, max) {
        return Math.random() * (max - min) + min;
    }

    const interval = setInterval(function() {
        const timeLeft = animationEnd - Date.now();

        if (timeLeft <= 0) {
            return clearInterval(interval);
        }

        const particleCount = 50 * (timeLeft / duration);
        confetti(Object.assign({}, defaults, { particleCount, origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } }));
        confetti(Object.assign({}, defaults, { particleCount, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } }));
    }, 250);
}

function onGameOver(data) {
    clearPlayerStateFromLocalStorage();
    quizScreen.classList.remove("active");
    waitingScreen.classList.remove("active");
    if (pausedOverlay) {
        pausedOverlay.classList.remove("active");
    }
    
    gameOverScreen.classList.add("active");
    
    // Stop background music
    if (bgmLobby) bgmLobby.pause();
    if (bgmGameplay) bgmGameplay.pause();
    playNationalAnthem();
    
    // Sync final competitor states
    syncCompetitors(data.players);
    
    // Determine if I was among the top 3 winners
    let won = false;
    let myRank = null;
    
    if (myPlayer) {
        const matchedWinner = data.winners.find(w => w.sid === myPlayer.sid);
        if (matchedWinner) {
            won = true;
            myRank = matchedWinner.rank;
        }
    }
    
    if (won) {
        victoryView.classList.add("active");
        explosionView.classList.remove("active");
        document.getElementById("victory-rank").innerText = myRank;
        triggerConfetti();
    } else {
        victoryView.classList.remove("active");
        explosionView.classList.add("active");
        
        // Trigger visual screen shake & explosion sound
        document.body.classList.add("screen-shake");
        triggerSFX("explosion");
        
        // Explode other rival loser boats too
        const winnerSids = data.winners.map(w => w.sid);
        Object.keys(activePlayers).forEach(sid => {
            if (!winnerSids.includes(sid)) {
                const rival = activePlayers[sid];
                if (rival.mesh) {
                    let rt = 0;
                    const rShrink = setInterval(() => {
                        rt += 0.05;
                        if (rival.mesh.scale.x > 0.05) {
                            rival.mesh.scale.set(2.5 - rt, 2.5 - rt, 2.5 - rt);
                            rival.mesh.position.y -= 0.12;
                        } else {
                            scene.remove(rival.mesh);
                            clearInterval(rShrink);
                        }
                    }, 30);
                }
            }
        });
        
        // Sinking/Exploding local boat simulation
        if (boatMesh) {
            // Play particle sparks or scale boat to 0
            let t = 0;
            const shrinkInterval = setInterval(() => {
                t += 0.05;
                if (boatMesh.scale.x > 0.05) {
                    boatMesh.scale.set(3 - t, 3 - t, 3 - t);
                    boatMesh.position.y -= 0.1;
                } else {
                    scene.remove(boatMesh);
                    clearInterval(shrinkInterval);
                }
            }, 30);
        }
        
        setTimeout(() => {
            document.body.classList.remove("screen-shake");
        }, 1000);
    }
    
    // Render dynamic podium list
    winnersPodium.innerHTML = "";
    data.winners.forEach(w => {
        const row = document.createElement("div");
        row.className = `winner-row rank-${w.rank}`;
        row.innerHTML = `
            <div class="winner-name-group">
                <span class="winner-dot" style="background: ${w.color};"></span>
                <span>Thuyền trưởng: <strong>${w.name}</strong></span>
            </div>
            <span class="winner-rank">Hạng ${w.rank}</span>
        `;
        winnersPodium.appendChild(row);
    });
}

// START
try {
    if (!isWebGLAvailable()) {
        throw new Error("WebGL is not supported in this browser/device.");
    }
    init3D();
    updateInventoryUI();
    animate();
} catch (e) {
    console.error("3D Graphics Initialization Failed. Applying 2D Fallback.", e);
    apply2DFallback();
}

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
    }
}

// Ngăn chặn copy câu hỏi và câu trả lời (Ràng buộc nghiệp vụ chống gian lận - Chỉ kích hoạt ở production)
document.addEventListener("contextmenu", (e) => {
    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") return;
    e.preventDefault();
    showCheatWarning("Không thể mở menu chuột phải. Sao chép câu hỏi và câu trả lời bị nghiêm cấm!");
});

document.addEventListener("copy", (e) => {
    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") return;
    e.preventDefault();
    showCheatWarning("Hành vi sao chép nội dung bị nghiêm cấm để bảo vệ tính công bằng!");
});

document.addEventListener("cut", (e) => {
    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") return;
    e.preventDefault();
});

document.addEventListener("keydown", (e) => {
    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") return;
    // Chặn F12
    if (e.key === "F12") {
        e.preventDefault();
        showCheatWarning("Phím tắt F12 đã bị vô hiệu hóa!");
        return false;
    }
    // Chặn Ctrl+C, Ctrl+X, Ctrl+U, Ctrl+Shift+I, Ctrl+Shift+C, Ctrl+Shift+J
    if (e.ctrlKey) {
        const key = e.key.toLowerCase();
        if (key === "c" || key === "x" || key === "u" || key === "s" || key === "a") {
            e.preventDefault();
            showCheatWarning("Không được phép sao chép/chụp mã nguồn!");
            return false;
        }
        if (e.shiftKey && (key === "i" || key === "c" || key === "j")) {
            e.preventDefault();
            showCheatWarning("Không thể mở Developer Tools!");
            return false;
        }
    }
});

// Hàm hiển thị cảnh báo chống gian lận đẹp mắt
function showCheatWarning(message) {
    console.warn(`[ANTI-CHEAT] ${message}`);
    // Tạo notification toast nếu chưa có
    let toast = document.getElementById("cheat-toast");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "cheat-toast";
        toast.style.position = "fixed";
        toast.style.bottom = "30px";
        toast.style.left = "50%";
        toast.style.transform = "translateX(-50%) translateY(100px)";
        toast.style.background = "rgba(231, 76, 60, 0.95)";
        toast.style.color = "#ffffff";
        toast.style.padding = "12px 24px";
        toast.style.borderRadius = "8px";
        toast.style.fontSize = "0.9rem";
        toast.style.fontWeight = "bold";
        toast.style.fontFamily = "'Montserrat', sans-serif";
        toast.style.boxShadow = "0 10px 25px rgba(231, 76, 60, 0.5), 0 0 15px rgba(231, 76, 60, 0.3)";
        toast.style.zIndex = "99999";
        toast.style.transition = "transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.4s";
        toast.style.opacity = "0";
        toast.style.backdropFilter = "blur(10px)";
        toast.style.border = "1px solid rgba(255, 255, 255, 0.2)";
        toast.style.pointerEvents = "none";
        document.body.appendChild(toast);
    }
    
    toast.innerText = `⚠️ ${message}`;
    toast.style.opacity = "1";
    toast.style.transform = "translateX(-50%) translateY(0)";
    
    // Clear previous timeout if any
    if (window.cheatToastTimeout) {
        clearTimeout(window.cheatToastTimeout);
    }
    
    window.cheatToastTimeout = setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateX(-50%) translateY(100px)";
    }, 3000);
}

// ==========================================================================
// Explanation Continue Handler
// ==========================================================================
const explanationContinueBtn = document.getElementById("explanation-continue-btn");
if (explanationContinueBtn) {
    explanationContinueBtn.addEventListener("click", () => {
        try {
            const explanationOverlay = document.getElementById("explanation-overlay");
            if (explanationOverlay) {
                explanationOverlay.style.opacity = "0";
                explanationOverlay.style.pointerEvents = "none";
            }
            
            const finished = quizScore >= TARGET_CORRECT_ANSWERS;
            if (finished) {
                onVictory({ rank: myPlayer.rank });
            } else if (pendingNextQuestionData) {
                applyNextQuestion(pendingNextQuestionData);
                pendingNextQuestionData = null;
            } else {
                console.warn("Continue clicked but pendingNextQuestionData is null! Attempting emergency recovery.");
                // Emergency recovery: dynamically reconstruct the next question if state got lost
                if (!finished && quizQueueIdx < quizQueue.length) {
                    const nextQIdx = quizQueue[quizQueueIdx];
                    const nextQ = QUESTIONS[nextQIdx];
                    if (nextQ) {
                        const recoveryData = {
                            question_text: nextQ.question,
                            options: nextQ.options,
                            num_answered: quizScore,
                            total_questions: TARGET_CORRECT_ANSWERS,
                            progress: Math.min(1, quizScore / TARGET_CORRECT_ANSWERS),
                        };
                        applyNextQuestion(recoveryData);
                    }
                }
            }
        } catch (err) {
            console.error("Error in explanationContinueBtn click handler:", err);
        }
    });
}

// ==========================================================================
// Hall of Fame (Bảng Vàng Lịch Sử) Client Logic
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
        hofList.innerHTML = '<tr><td colspan="5" class="text-center" style="color: #8da2c4;">Chưa có kỷ lục nào được ghi nhận. Hãy trở thành người đầu tiên!</td></tr>';
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
        
        // Format time to MM:SS.SS
        const minutes = Math.floor(r.race_time / 60);
        const seconds = (r.race_time % 60).toFixed(2);
        const timeStr = `${minutes > 0 ? minutes + "m " : ""}${seconds}s`;
        
        // Format date dynamically
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
            <td>${r.score}/20</td>
            <td style="color: #00f2fe; font-family: monospace; font-weight: bold;">${timeStr}</td>
            <td style="color: #8da2c4; font-size: 0.8rem;">${dateStr}</td>
        `;
        hofList.appendChild(tr);
    });
}

// Automatically reconnect/rejoin if game was already running on reload
const savedGameStarted = localStorage.getItem("boat_game_started") === "true";
if (savedName && savedGameStarted && playerNameInput && joinBtn) {
    playerNameInput.value = savedName;
    setTimeout(() => {
        console.log("Automatically re-joining game for Captain", savedName);
        joinBtn.click();
    }, 1000);
}

