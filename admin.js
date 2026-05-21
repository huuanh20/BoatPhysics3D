import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Water } from "three/examples/jsm/objects/Water.js";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  connectAbly,
  createPlayerId,
  presenceToPlayers,
} from "./ably-realtime.js";

let ablyChannel = null;
let adminWinners = [];
let gamePaused = false;

// UI Elements
const adminPanel = document.getElementById("admin-panel");
const startGameBtn = document.getElementById("start-game-btn");
const resetGameBtn = document.getElementById("reset-game-btn");
const connectedCount = document.getElementById("connected-count");
const lobbyPlayersGrid = document.getElementById("lobby-players-grid");
const liveLeaderboard = document.getElementById("live-leaderboard");
const leaderboardList = document.getElementById("leaderboard-list");
const podiumScreen = document.getElementById("podium-screen");
const pauseGameBtn = document.getElementById("pause-game-btn");

// Sound Effects
const sfxAmbient = document.getElementById("sfx-ambient");
const sfxHorn = document.getElementById("sfx-horn");
const sfxExplosion = document.getElementById("sfx-explosion");

// Game State
let activePlayers = {}; // map of sid -> player data (mesh, labelDiv, name, color, progress, rank)
let gameStarted = false;
let startButtonEnabled = false;

const START_Z = 300;
const FINISH_Z = -500;
const TOTAL_DIST = START_Z - FINISH_Z; // 800 units

// Stable Lane Assignment Maps
let laneMap = {}; // Maps sid -> lane index (0-19)
let usedLanes = new Array(30).fill(false);

// 3D Scene Variables
let camera, scene, renderer, controls;
let water, sky, sun;
let loader = new GLTFLoader();
let activeExplosions = []; // List of animated explosion spheres/particles

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
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.8;
    container.appendChild(renderer.domElement);

    // Scene
    scene = new THREE.Scene();

    // Camera - Wide side-profile overview angle (Start on left, Finish on right)
    camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 1, 25000);
    camera.position.set(-350, 90, START_Z); // Centered near the start line on negative X side

    // Orbit Controls (Admin can look around!)
    controls = new OrbitControls(camera, renderer.domElement);
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.minDistance = 30.0;
    controls.maxDistance = 2500.0;
    controls.target.set(0, 10, START_Z); // Focus on the start line
    controls.update();

    // Ambient/Direct light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xfffaed, 1.3);
    dirLight.position.set(300, 400, -300);
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
        distortionScale: 3.7,
        fog: false,
    });
    water.rotation.x = -Math.PI / 2;
    scene.add(water);

    // Sky & Sun
    sky = new Sky();
    sky.scale.setScalar(120000);
    scene.add(sky);

    sun = new THREE.Vector3();
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    
    // Setting golden hour dusk parameters
    const elevation = 10;
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

                p.mesh.position.z += (targetZPos - p.mesh.position.z) * 0.12;
                p.mesh.position.x += (targetX - p.mesh.position.x) * 0.12;
                
                // Boat bobbing physics
                const bobOffset = Math.sin(time * 2.0 + p.heaveOffset) * 0.22;
                const pitchOffset = Math.sin(time * 1.4 + p.heaveOffset) * 0.015;
                const rollOffset = Math.cos(time * 1.0 + p.heaveOffset) * 0.025;
                
                p.mesh.position.y = 12.8 + bobOffset;
                p.mesh.rotation.x = pitchOffset;
                p.mesh.rotation.z = rollOffset;
                
                // Wave flag animation
                if (p.mesh.userData && p.mesh.userData.flagMesh) {
                    p.mesh.userData.flagMesh.rotation.z = Math.sin(time * 10 + p.heaveOffset) * 0.08;
                }
            }
        });

        // Animate Active Explosion effects
        animateExplosions();

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
        
        // Slide OrbitControls target horizontally (along Z axis) to track leader
        controls.target.lerp(new THREE.Vector3(0, 10, leaderPos.z), 0.04);
        
        // Slide camera position horizontally (along Z axis) at the same rate to maintain horizontal track framing
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
        badge.innerHTML = `
            <span class="player-color-dot" style="background: ${p.color};"></span>
            <span>${p.name}</span>
        `;
        lobbyPlayersGrid.appendChild(badge);
    });

    sync3DPlayers(players);
    startGameBtn.disabled = false;
    startButtonEnabled = true;
}

async function refreshAdminPresence() {
    if (!ablyChannel) return;
    const members = await ablyChannel.presence.get();
    const players = presenceToPlayers(members);
    if (!gameStarted) {
        updateLobbyUI(players);
    } else {
        sync3DPlayers(players);
        updateLiveLeaderboard();
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
            refreshAdminPresence();
        }
    });
}

function trackWinnerFromPos(data) {
    if ((data.progress ?? 0) < 1) return;
    if (adminWinners.find((w) => w.sid === data.id)) return;

    const p = activePlayers[data.id];
    adminWinners.push({
        sid: data.id,
        name: p?.name || "Player",
        color: p?.color || "#fff",
        rank: adminWinners.length + 1,
    });

    if (activePlayers[data.id]) {
        activePlayers[data.id].rank = adminWinners.length;
    }

    if (adminWinners.length >= 3) {
        endGameAsAdmin();
    }
}

async function endGameAsAdmin() {
    gameStarted = false;
    const members = await ablyChannel.presence.get();
    const players = presenceToPlayers(members);

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

function sync3DPlayers(playersList) {
    // 1. Remove old labels/meshes if disconnected
    const currentSids = playersList.map(p => p.sid);
    Object.keys(activePlayers).forEach(sid => {
        if (!currentSids.includes(sid)) {
            // Remove floating div
            if (activePlayers[sid].labelDiv) {
                document.body.removeChild(activePlayers[sid].labelDiv);
            }
            // Remove mesh
            if (activePlayers[sid].mesh) {
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

    // 3. Add or update players in scene
    playersList.forEach((p) => {
        const laneIndex = laneMap[p.sid];
        const laneX = -232 + laneIndex * 16; // Stable lane coordinates
        const startZPos = START_Z - ((p.progress || 0.0) * TOTAL_DIST);

        if (!activePlayers[p.sid]) {
            // Create floating HTML tag immediately
            const label = document.createElement("div");
            label.className = "floating-player-label";
            label.innerHTML = `${p.name} (${Math.round((p.progress || 0.0) * 100)}%)`;
            document.body.appendChild(label);

            activePlayers[p.sid] = {
                sid: p.sid,
                name: p.name,
                color: p.color,
                progress: p.progress || 0.0,
                rank: p.rank || null,
                mesh: null,
                labelDiv: label,
                heaveOffset: Math.random() * Math.PI, // staggered waves wave phases
                targetZ: startZPos,
                laneX: laneX
            };

            // Instantiate dynamic boat model
            loader.load("helpers/boat/scene.gltf", (gltf) => {
                const boat = gltf.scene;
                boat.scale.set(2.5, 2.5, 2.5);
                const currentZ = START_Z - ((activePlayers[p.sid] ? activePlayers[p.sid].progress : p.progress || 0.0) * TOTAL_DIST);
                boat.position.set(laneX, 13, currentZ);
                boat.rotation.y = Math.PI * 0.5; // Face towards -Z (France)
                scene.add(boat);

                // Paint Hull custom color
                const color = new THREE.Color(p.color);
                boat.traverse((child) => {
                    if (child.isMesh) {
                        if (child.name.includes("hull") || child.name.includes("body") || child.material.name.includes("White") || child.material.name.includes("hull")) {
                            child.material = child.material.clone();
                            child.material.color.copy(color);
                            child.material.roughness = 0.2;
                        }
                    }
                });

                // Attach flying Vietnam flag to the stern
                attachVietnamFlag(boat);

                if (activePlayers[p.sid]) {
                    activePlayers[p.sid].mesh = boat;
                } else {
                    scene.remove(boat);
                }
            });
        } else {
            // Already exists, keep lane offsets but update names and stats
            activePlayers[p.sid].name = p.name;
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
    gameStarted = false;
    adminPanel.classList.add("active");
    liveLeaderboard.classList.remove("active");
    podiumScreen.classList.remove("active");
    
    if (pauseGameBtn) {
        pauseGameBtn.style.display = "none";
        pauseGameBtn.innerText = "TẠM DỪNG";
        pauseGameBtn.classList.remove("paused");
    }
    
    // Zoom camera back to side-profile start overview
    controls.target.set(0, 10, START_Z);
    camera.position.set(-350, 90, START_Z);
    
    // Reset all active players' stats and re-align/restore 3D meshes
    Object.keys(activePlayers).forEach(sid => {
        const p = activePlayers[sid];
        p.progress = 0.0;
        p.rank = null;
        if (p.mesh) {
            // Restore position to start line using correct stable lane coordinate
            p.mesh.position.set(p.laneX, 13, START_Z);
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
}

function onGameStarted() {
    adminPanel.classList.remove("active");
    liveLeaderboard.classList.add("active");

    if (pauseGameBtn) {
        pauseGameBtn.style.display = "block";
        pauseGameBtn.innerText = "TẠM DỪNG";
        pauseGameBtn.classList.remove("paused");
    }

    sfxHorn.play().catch(() => {});
    controls.target.set(0, 10, START_Z);
    camera.position.set(-350, 90, START_Z);
    refreshAdminPresence();
}

function updateLiveLeaderboard() {
    // Sort players by progress descending
    const sorted = Object.values(activePlayers).sort((a, b) => b.progress - a.progress);
    
    leaderboardList.innerHTML = "";
    sorted.forEach((p, idx) => {
        const row = document.createElement("div");
        row.className = "leader-row";
        row.style.borderLeftColor = p.color;
        
        let rankBadge = `${idx + 1}. `;
        if (p.rank === 1) rankBadge = "🥇 1st | ";
        else if (p.rank === 2) rankBadge = "🥈 2nd | ";
        else if (p.rank === 3) rankBadge = "🥉 3rd | ";
        
        row.innerHTML = `
            <div class="leader-meta">
                <span class="leader-name"><strong>${rankBadge}${p.name}</strong></span>
                <span class="leader-percent">${Math.round(p.progress * 100)}%</span>
            </div>
            <div class="leader-progress-track">
                <div class="leader-progress-bar" style="width: ${p.progress * 100}%; background-color: ${p.color}"></div>
            </div>
        `;
        leaderboardList.appendChild(row);
    });
}

function onGameOver(data) {
    gameStarted = false;
    liveLeaderboard.classList.remove("active");
    podiumScreen.classList.add("active");
    if (pauseGameBtn) {
        pauseGameBtn.style.display = "none";
    }

    // Play horn and launch continuous confetti
    sfxHorn.play().catch(() => {});
    sfxExplosion.play().catch(() => {});
    triggerAdminConfetti();

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
                        if (p.labelDiv) document.body.removeChild(p.labelDiv);
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
    initAdminAbly();
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
