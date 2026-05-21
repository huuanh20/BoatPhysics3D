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

let ablyChannel = null;
let myClientId = null;
let gameStarted = false;
let gamePaused = false;
let quizQueue = [];
let quizQueueIdx = 0;
let quizScore = 0;
let lastPosPublish = 0;

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

// Sound Effects
const sfxCorrect = document.getElementById("sfx-correct");
const sfxWrong = document.getElementById("sfx-wrong");
const sfxExplosion = document.getElementById("sfx-explosion");
const sfxHorn = document.getElementById("sfx-horn");

// Game State
let myPlayer = null;
let currentProgress = 0.0;
let targetZ = 300;
let totalQuestions = 15; // Set default to 15
const START_Z = 300;
const FINISH_Z = -500;
const TOTAL_DIST = START_Z - FINISH_Z; // 800 units

// Competitors & Lanes Data
let activePlayers = {}; // Maps sid -> competitor boat data
let laneMap = {}; // Stable lane maps
let usedLanes = new Array(30).fill(false);
let accelerationEffect = 0.0; // Dynamic G-force camera stretch

// 3D Scene Setup
let camera, scene, renderer;
let water, sky, sun;
let boatMesh = null;
let loader = new GLTFLoader();

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
    pole.rotation.x = -0.15; // Slanted backward slightly
    pole.position.y = 1.6;
    flagGroup.add(pole);
    
    // Flag Fabric
    const flagGeom = new THREE.PlaneGeometry(2.2, 1.45);
    const flagMat = new THREE.MeshBasicMaterial({ 
        map: flagTexture, 
        side: THREE.DoubleSide 
    });
    const flag = new THREE.Mesh(flagGeom, flagMat);
    flag.position.set(1.1, 2.8, 0);
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
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.8;
    container.appendChild(renderer.domElement);

    // Scene
    scene = new THREE.Scene();

    // Camera - Mounted behind/above Boat (Immersive Chase View)
    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 20000);
    // Initial camera position (will follow behind the boat)
    camera.position.set(0, 20.5, 324);
    camera.lookAt(0, 15, 200);

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xfff5e6, 1.2);
    dirLight.position.set(200, 300, -200);
    scene.add(dirLight);

    // Water
    const waterGeometry = new THREE.PlaneGeometry(100000, 100000);
    water = new Water(waterGeometry, {
        textureWidth: 512,
        textureHeight: 512,
        waterNormals: new THREE.TextureLoader().load("helpers/waternormals.jpg", (texture) => {
            texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        }),
        sunDirection: new THREE.Vector3(),
        sunColor: 0xffffff,
        waterColor: 0x004e5a, // Deep blue-cyan tropical water
        distortionScale: 3.7,
        fog: false,
    });
    water.rotation.x = -Math.PI / 2;
    scene.add(water);

    // Sky & Sun
    sky = new Sky();
    sky.scale.setScalar(100000);
    scene.add(sky);

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



    // Load Player's Boat Mesh
    loader.load("helpers/boat/scene.gltf", (gltf) => {
        boatMesh = gltf.scene;
        boatMesh.scale.set(3, 3, 3);
        boatMesh.position.set(0, 13, START_Z);
        boatMesh.rotation.y = Math.PI * 0.5; // Face towards -Z (France)
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

    // Resize Handler
    window.addEventListener("resize", onWindowResize);
}

function paintBoat(boatGroup, colorHex) {
    if (!boatGroup) return;
    const color = new THREE.Color(colorHex);
    boatGroup.traverse((child) => {
        if (child.isMesh) {
            // Delete vertex colors to prevent them from overriding the material color
            if (child.geometry && child.geometry.attributes.color) {
                child.geometry.deleteAttribute('color');
            }
            
            const processMaterial = (mat) => {
                const matName = (mat.name || "").toLowerCase();
                const meshName = (child.name || "").toLowerCase();
                
                // Exact match fiberglass body and hull parts
                // Hull / Deck Materials: acmat_0, acmat_7, acmat_8, acmat_13
                // Hull / Deck Meshes: object_2, object_7, object_13, object_14
                const isHullMat = matName === "acmat_0" || matName === "acmat_7" || matName === "acmat_8" || matName === "acmat_13";
                const isHullMesh = meshName === "object_2" || meshName === "object_7" || meshName === "object_13" || meshName === "object_14";
                
                if (isHullMat || isHullMesh) {
                    return new THREE.MeshStandardMaterial({
                        color: color,
                        roughness: 0.15,
                        metalness: 0.45,
                        name: mat.name ? mat.name + "_painted" : "hull_painted",
                        vertexColors: false // Ensure no vertex colors override
                    });
                }
                return null;
            };

            if (Array.isArray(child.material)) {
                for (let i = 0; i < child.material.length; i++) {
                    const newM = processMaterial(child.material[i]);
                    if (newM) {
                        child.material[i] = newM;
                    }
                }
            } else if (child.material) {
                const newM = processMaterial(child.material);
                if (newM) {
                    child.material = newM;
                }
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

// Sync all competitor boats from server status list
function syncCompetitors(playersList) {
    if (!scene) return;
    const currentSids = playersList.map(p => p.sid);
    
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
            for (let i = 0; i < 30; i++) {
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
        if (!activePlayers[p.sid]) {
            activePlayers[p.sid] = {
                sid: p.sid,
                name: p.name,
                color: p.color,
                progress: p.progress || 0.0,
                rank: p.rank || null,
                mesh: null,
                laneX: laneX,
                heaveOffset: Math.random() * Math.PI
            };
            loader.load("helpers/boat/scene.gltf", (gltf) => {
                const boat = gltf.scene;
                boat.scale.set(2.5, 2.5, 2.5);
                const currentZ = START_Z - ((activePlayers[p.sid] ? activePlayers[p.sid].progress : p.progress || 0.0) * TOTAL_DIST);
                boat.position.set(laneX, 13, currentZ);
                boat.rotation.y = Math.PI * 0.5; // Face towards -Z (France)
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
            });
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

// 3D Animation Loop
function animate() {
    try {
        requestAnimationFrame(animate);
        
        const time = performance.now() * 0.001;
        
        // Animate Water
        if (water && water.material && water.material.uniforms) {
            water.material.uniforms["time"].value += 1.0 / 60.0;
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
                p.mesh.position.z += (targetZPos - p.mesh.position.z) * 0.12;
                p.mesh.position.x += (targetX - p.mesh.position.x) * 0.12;
                
                // Bobbing physics
                const bob = Math.sin(time * 2.0 + p.heaveOffset) * 0.22;
                const pitch = Math.sin(time * 1.4 + p.heaveOffset) * 0.015;
                const roll = Math.cos(time * 1.0 + p.heaveOffset) * 0.025;
                
                p.mesh.position.y = 12.8 + bob;
                p.mesh.rotation.x = pitch;
                p.mesh.rotation.z = roll;
                
                if (p.mesh.userData && p.mesh.userData.flagMesh) {
                    p.mesh.userData.flagMesh.rotation.z = Math.sin(time * 10 + p.heaveOffset) * 0.08;
                }
            }
        });

        // 2. Animate Player's own Boat & Chase Camera
        if (boatMesh) {
            const targetZPos = START_Z - (currentProgress * TOTAL_DIST);
            
            // Lerp boat Z position for ultra-smooth movement
            boatMesh.position.z += (targetZPos - boatMesh.position.z) * 0.08;
            
            // Assign my Lane X coordinate
            const myLaneX = (boatMesh.userData.laneX !== undefined) ? boatMesh.userData.laneX : 0;
            boatMesh.position.x = myLaneX;
            
            // Bobbing physics
            const bob = Math.sin(time * 2.0) * 0.25;
            const pitch = Math.sin(time * 1.5) * 0.02;
            const roll = Math.cos(time * 1.0) * 0.03;
            
            boatMesh.position.y = 12.8 + bob;
            boatMesh.rotation.x = pitch;
            boatMesh.rotation.z = roll;
            boatMesh.rotation.y = Math.PI * 0.5 + Math.sin(time * 0.5) * 0.01;

            if (boatMesh.userData && boatMesh.userData.flagMesh) {
                boatMesh.userData.flagMesh.rotation.z = Math.sin(time * 10) * 0.08;
            }

            // G-FORCE DYNAMIC CAMERA CHASE FOLLOW
            const idealCamX = myLaneX;
            const idealCamY = 20.3; // Stable height (12.8 + 7.5) to keep camera perfectly steady
            const idealCamZ = boatMesh.position.z + 24.0; // Ideal distance behind

            // Tight follow along X and Y
            camera.position.x += (idealCamX - camera.position.x) * 0.1;
            camera.position.y += (idealCamY - camera.position.y) * 0.1;

            // Delayed spring lag (0.04 lerp) on Z axis to showcase acceleration surge!
            camera.position.z += (idealCamZ - camera.position.z) * 0.04;
            
            // Apply FOV burst on acceleration
            if (accelerationEffect > 0) {
                camera.fov = 60 + accelerationEffect * 8;
                camera.updateProjectionMatrix();
                accelerationEffect -= 0.02; // Damping
            } else {
                if (camera.fov !== 60) {
                    camera.fov = 60;
                    camera.updateProjectionMatrix();
                }
            }

            // Camera looks forward at stable height to eliminate vertical jitter
            const lookTarget = new THREE.Vector3(
                myLaneX,
                15.3, // Stable height (12.8 + 2.5) to keep camera perfectly steady
                boatMesh.position.z - 100
            );
            camera.lookAt(lookTarget);

            maybePublishPosition();
        }

        if (renderer && scene && camera) {
            renderer.render(scene, camera);
        }
    } catch (e) {
        console.error("Error in animation loop. Stopping 3D.", e);
        apply2DFallback();
    }
}

// LOBBY SELECTION & COLOR PICKER
const colorButtons = document.querySelectorAll(".color-btn");
let selectedColor = "#e74c3c"; // Default red

colorButtons.forEach(btn => {
    btn.addEventListener("click", () => {
        colorButtons.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        selectedColor = btn.getAttribute("data-color");
        applyBoatColor(selectedColor); // Apply color in real-time in lobby!
    });
});

// JOIN LOBBY ACTION
const joinBtn = document.getElementById("join-btn");
const playerNameInput = document.getElementById("player-name");

if (playerNameInput) {
    playerNameInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            joinBtn.click();
        }
    });
}

function maybePublishPosition() {
    if (!ablyChannel || !boatMesh || !myPlayer || gamePaused) return;
    const now = performance.now();
    if (now - lastPosPublish < PUBLISH_INTERVAL_MS) return;
    lastPosPublish = now;

    ablyChannel.publish("pos", {
        id: myPlayer.id,
        t: Date.now(),
        x: boatMesh.position.x,
        y: boatMesh.position.y,
        z: boatMesh.position.z,
        yaw: boatMesh.rotation.y,
        vx: 0,
        vz: 0,
        progress: currentProgress,
        rank: myPlayer.rank ?? null,
    });
}

async function refreshLobbyFromPresence() {
    if (!ablyChannel) return;
    try {
        const players = await getPresenceMembers(ablyChannel);
        syncCompetitors(players);
    } catch (e) {
        console.warn("presence sync failed:", e);
    }
}

function setupAblyListeners(channel) {
    channel.presence.subscribe(() => {
        refreshLobbyFromPresence();
    });

    channel.subscribe("pos", (msg) => {
        const data = msg.data;
        if (!data?.id || (myPlayer && data.id === myPlayer.id)) return;

        if (activePlayers[data.id]) {
            activePlayers[data.id].progress = data.progress ?? activePlayers[data.id].progress;
            activePlayers[data.id].rank = data.rank ?? activePlayers[data.id].rank;
            activePlayers[data.id].targetX = data.x;
            activePlayers[data.id].targetZ = data.z;
        } else {
            refreshLobbyFromPresence();
        }
    });

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
    }
}

function onGameReset() {
    currentProgress = 0.0;
    targetZ = START_Z;
    accelerationEffect = 0.0;
    
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
        boatMesh.position.set(0, 13, START_Z);
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
}

function onGameStarted() {
    gameStarted = true;
    gamePaused = false;
    quizScore = 0;
    quizQueueIdx = 0;
    quizQueue = QUESTIONS.map((_, i) => i);
    currentProgress = 0;

    waitingScreen.classList.remove("active");
    quizScreen.classList.add("active");
    sfxHorn.play().catch(() => {});
    sendNextQuestion();
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
        btn.disabled = false;
    });

    const questionNum = data.num_answered + 1;
    questionNumberBadge.innerText = `CÂU HỎI ${questionNum}`;
    questionText.innerText = data.question_text;
    data.options.forEach((opt, idx) => {
        document.getElementById(`opt-${idx}`).innerText = opt;
    });
}

function sendNextQuestion(lastCorrect = null) {
    if (!gameStarted || gamePaused || quizQueueIdx >= quizQueue.length) return;

    const qIdx = quizQueue[quizQueueIdx];
    const q = QUESTIONS[qIdx];
    const data = {
        question_text: q.question,
        options: q.options,
        num_answered: quizScore,
        total_questions: QUESTIONS.length,
        progress: Math.min(1, quizScore / QUESTIONS.length),
    };

    if (lastCorrect !== null) {
        feedbackOverlay.classList.remove("correct", "wrong");
        feedbackOverlay.classList.add(lastCorrect ? "correct" : "wrong");
        feedbackOverlay.classList.add("active");

        if (lastCorrect) {
            feedbackTitle.innerText = "CHÍNH XÁC!";
            feedbackDesc.innerText = "Tuyệt vời! Thuyền của bạn đang lướt nhanh ra khơi...";
            sfxCorrect.currentTime = 0;
            sfxCorrect.play().catch(() => {});
        } else {
            feedbackTitle.innerText = "SAI MẤT RỒI!";
            feedbackDesc.innerText = "Đừng lo! Câu hỏi này đã được xếp xuống cuối hàng để bạn làm lại.";
            sfxWrong.currentTime = 0;
            sfxWrong.play().catch(() => {});
        }

        setTimeout(() => {
            feedbackOverlay.classList.remove("active");
            applyNextQuestion(data);
        }, 1300);
    } else {
        feedbackOverlay.classList.remove("active", "correct", "wrong");
        applyNextQuestion(data);
    }
}

function handleLocalAnswer(answerIdx) {
    if (!gameStarted || gamePaused || !myPlayer) return;

    const qIdx = quizQueue[quizQueueIdx];
    const isCorrect = answerIdx === QUESTIONS[qIdx].answer;

    if (isCorrect) {
        quizScore += 1;
        quizQueueIdx += 1;
    } else {
        quizQueue.push(qIdx);
        quizQueueIdx += 1;
    }

    currentProgress = Math.min(1, quizScore / QUESTIONS.length);
    myPlayer.progress = currentProgress;

    if (myPlayer) {
        correctCount.innerText = quizScore;
        playerProgressBar.style.width = `${currentProgress * 100}%`;
        playerProgressBoat.style.left = `${currentProgress * 100}%`;
        accelerationEffect = 1.0;
    }

    maybePublishPosition();

    const finished = quizScore >= QUESTIONS.length;
    if (finished && myPlayer.rank == null) {
        // Calculate dynamic rank based on competitors who have already finished (progress >= 1.0)
        let finishedCount = 0;
        Object.values(activePlayers).forEach(p => {
            if (p.progress >= 1.0) {
                finishedCount++;
            }
        });
        myPlayer.rank = finishedCount + 1;
        onVictory({ rank: myPlayer.rank });
        return;
    }

    if (!finished) {
        sendNextQuestion(isCorrect);
    }
}

// SUBMIT OPTION CLICK
optionButtons.forEach(btn => {
    btn.addEventListener("click", () => {
        const selectedIdx = parseInt(btn.getAttribute("data-index"));
        
        // Visual select highlight
        btn.classList.add("selected");
        
        // Disable all buttons to prevent double clicks
        optionButtons.forEach(b => b.disabled = true);
        
        handleLocalAnswer(selectedIdx);
    });
});

function onVictory(data) {
    quizScreen.classList.remove("active");
    gameOverScreen.classList.add("active");
    victoryView.classList.add("active");
    explosionView.classList.remove("active");
    
    document.getElementById("victory-rank").innerText = data.rank;
    
    // Play sound and trigger confetti explosion
    sfxHorn.play().catch(() => {});
    triggerConfetti();
}

joinBtn.addEventListener("click", async () => {
    const name = playerNameInput.value.trim();
    if (!name) {
        alert("Vui lòng nhập tên thuyền trưởng của bạn!");
        return;
    }

    joinBtn.disabled = true;
    try {
        myClientId = createPlayerId();
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
        lobbyScreen.classList.remove("active");
        waitingScreen.classList.add("active");
        document.getElementById("player-welcome-msg").innerText =
            `Chào Thuyền Trưởng ${myPlayer.name}, thuyền của bạn đã ở vạch xuất phát!`;
        sfxHorn.play().catch(() => {});

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
    quizScreen.classList.remove("active");
    waitingScreen.classList.remove("active");
    if (pausedOverlay) {
        pausedOverlay.classList.remove("active");
    }
    
    gameOverScreen.classList.add("active");
    
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
        sfxExplosion.currentTime = 0;
        sfxExplosion.play().catch(() => {});
        
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

// Ngăn chặn copy câu hỏi và câu trả lời (Ràng buộc nghiệp vụ chống gian lận)
document.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    showCheatWarning("Không thể mở menu chuột phải. Sao chép câu hỏi và câu trả lời bị nghiêm cấm!");
});

document.addEventListener("copy", (e) => {
    e.preventDefault();
    showCheatWarning("Hành vi sao chép nội dung bị nghiêm cấm để bảo vệ tính công bằng!");
});

document.addEventListener("cut", (e) => {
    e.preventDefault();
});

document.addEventListener("keydown", (e) => {
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

