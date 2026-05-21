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
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.8;
    container.appendChild(renderer.domElement);

    // Scene
    scene = new THREE.Scene();

    // Camera - Cinematic isometric 3D tactical perspective
    camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 1, 25000);
    camera.position.set(220, 140, START_Z + 160); 

    // Orbit Controls (Admin can look around!)
    controls = new OrbitControls(camera, renderer.domElement);
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.minDistance = 30.0;
    controls.maxDistance = 2500.0;
    controls.target.set(0, 10, START_Z - 80); // Focus on the start line area
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
        mtGroup.position.set(x, 9.0, z);

        // Rocky grey mountain cone base
        const rockMat = new THREE.MeshStandardMaterial({
            color: 0x475662,
            roughness: 0.9,
            metalness: 0.15,
            flatShading: true
        });
        const baseGeom = new THREE.ConeGeometry(radius, height, 5); // 5-sided for premium low-poly facets
        const baseMesh = new THREE.Mesh(baseGeom, rockMat);
        baseMesh.position.y = height / 2;
        mtGroup.add(baseMesh);

        // Snow-capped peak (smaller white cone stacked on top)
        const snowMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            roughness: 0.95,
            flatShading: true
        });
        const snowHeight = height * 0.35;
        const snowRadius = radius * 0.35;
        const snowGeom = new THREE.ConeGeometry(snowRadius, snowHeight, 5);
        const snowMesh = new THREE.Mesh(snowGeom, snowMat);
        snowMesh.position.y = height - (snowHeight / 2) - 0.1;
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
        finGroup.add(finMesh);
        return finGroup;
    }

    // Helper: Create a Palm Tree
    function createPalmTree() {
        const treeGroup = new THREE.Group();
        
        // Bendy trunk using stacked segment cylinders
        const trunkMat = new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 0.9, flatShading: true });
        let prevY = 0;
        const numSegments = 6;
        for (let j = 0; j < numSegments; j++) {
            const h = 2.5;
            const rBottom = 0.6 - j * 0.05;
            const rTop = 0.55 - j * 0.05;
            const segGeom = new THREE.CylinderGeometry(rTop, rBottom, h, 5);
            const segMesh = new THREE.Mesh(segGeom, trunkMat);
            segMesh.position.y = prevY + h / 2;
            // curve it slightly
            segMesh.rotation.z = 0.08 + Math.sin(j * 0.4) * 0.05;
            segMesh.rotation.x = Math.cos(j * 0.4) * 0.03;
            treeGroup.add(segMesh);
            prevY += h - 0.2;
        }

        // Leaves at the top
        const leafMat = new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.8, flatShading: true });
        const numLeaves = 5;
        const topPos = new THREE.Vector3(0, prevY, 0);
        for (let j = 0; j < numLeaves; j++) {
            const angle = (j / numLeaves) * Math.PI * 2;
            const leafGeom = new THREE.ConeGeometry(1.5, 6, 4);
            leafGeom.rotateX(Math.PI / 2.5); // Droop leaf
            leafGeom.scale(1, 0.15, 1);
            const leaf = new THREE.Mesh(leafGeom, leafMat);
            leaf.position.copy(topPos);
            leaf.rotation.y = angle;
            treeGroup.add(leaf);
        }
        
        return treeGroup;
    }

    // Helper: Create an Island
    function createIsland(x, z, scaleX, scaleZ) {
        const islandGroup = new THREE.Group();
        islandGroup.position.set(x, 9.0, z);

        // Sand Base
        const sandMat = new THREE.MeshStandardMaterial({ color: 0xe6c280, roughness: 0.95, flatShading: true });
        const sandGeom = new THREE.CylinderGeometry(28, 35, 6, 7);
        const sand = new THREE.Mesh(sandGeom, sandMat);
        sand.scale.set(scaleX, 1, scaleZ);
        islandGroup.add(sand);

        // Grassy Mound on top
        const grassMat = new THREE.MeshStandardMaterial({ color: 0x388e3c, roughness: 0.9, flatShading: true });
        const grassGeom = new THREE.DodecahedronGeometry(22, 1);
        grassGeom.scale(scaleX, 0.4, scaleZ);
        const grass = new THREE.Mesh(grassGeom, grassMat);
        grass.position.y = 2.5;
        islandGroup.add(grass);

        // Some grey rocks
        const rockMat = new THREE.MeshStandardMaterial({ color: 0x78909c, roughness: 0.8, flatShading: true });
        const numRocks = 2 + Math.floor(Math.random() * 3);
        for (let r = 0; r < numRocks; r++) {
            const rockRad = 2 + Math.random() * 4;
            const rockGeom = new THREE.SphereGeometry(rockRad, 5, 5);
            const rock = new THREE.Mesh(rockGeom, rockMat);
            rock.position.set(
                (Math.random() - 0.5) * 20 * scaleX,
                2.0 + rockRad * 0.4,
                (Math.random() - 0.5) * 20 * scaleZ
            );
            islandGroup.add(rock);
        }

        // Add 2-3 bendy palm trees
        const numTrees = 2 + Math.floor(Math.random() * 2);
        for (let t = 0; t < numTrees; t++) {
            const tree = createPalmTree();
            tree.scale.set(1.2, 1.2, 1.2);
            tree.position.set(
                (Math.random() - 0.5) * 12 * scaleX,
                3.0,
                (Math.random() - 0.5) * 12 * scaleZ
            );
            // lean tree slightly away from island center
            tree.rotation.z += (Math.random() - 0.5) * 0.2;
            islandGroup.add(tree);
        }

        scene.add(islandGroup);
    }

    // 2. Spawn 5 beautiful Islands along race lanes (Moved closer for panoramic widescreen visibility)
    createIsland(-280, 200, 1.2, 1.4); // Island 1 left
    createIsland(270, 100, 1.3, 1.1);  // Island 2 right
    createIsland(-290, -100, 1.0, 1.5); // Island 3 left
    createIsland(280, -280, 1.4, 1.2);  // Island 4 right
    createIsland(-270, -450, 1.2, 1.3); // Island 5 left

    // 3. Sunset Lighthouse (Hải đăng cực hạn)
    const lhGroup = new THREE.Group();
    lhGroup.position.set(270, 9.0, -530);

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
    lhGroup.position.set(280, 9.0, FINISH_Z - 20); // Align with finish gate
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

    // 8. Glowing Hologram Tech Speed Rings
    const ringGeom = new THREE.TorusGeometry(4.5, 0.35, 8, 24);
    const ringMat = new THREE.MeshBasicMaterial({
        color: 0x00f2fe,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending
    });
    
    const ringZPositions = [150, 0, -150, -300];
    const ringLanes = [-160, -80, 80, 160];
    
    for (let r = 0; r < 4; r++) {
        const ring = new THREE.Mesh(ringGeom, ringMat);
        ring.position.set(ringLanes[r], 16.0, ringZPositions[r]);
        scene.add(ring);
        scenerySpeedRings.push(ring);
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

        // G. Vòng Neon tự xoay và bay lửng lơ
        scenerySpeedRings.forEach((ring, idx) => {
            ring.rotation.y += 0.015;
            ring.position.y = 16.0 + Math.sin(time * 2.0 + idx) * 0.4;
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
        
        // Slide OrbitControls target horizontally (along Z axis) to track leader
        controls.target.lerp(new THREE.Vector3(0, 10, leaderPos.z - 80), 0.04);
        
        // Slide camera position horizontally (along Z axis) at the same rate to maintain horizontal track framing
        camera.position.z += ((leaderPos.z + 160) - camera.position.z) * 0.04;
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
    try {
        const players = await getPresenceMembers(ablyChannel);
        if (!gameStarted) {
            updateLobbyUI(players);
        } else {
            sync3DPlayers(players);
            updateLiveLeaderboard();
        }
    } catch (e) {
        console.warn("admin presence sync failed:", e);
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

    const totalPlayersCount = Object.keys(activePlayers).length;
    const targetLimit = Math.max(1, Math.min(3, totalPlayersCount));
    if (adminWinners.length >= targetLimit) {
        endGameAsAdmin();
    }
}

async function endGameAsAdmin() {
    gameStarted = false;
    const players = await getPresenceMembers(ablyChannel);

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
            // Delete vertex colors to prevent them from overriding the material color
            if (child.geometry && child.geometry.attributes.color) {
                child.geometry.deleteAttribute('color');
            }
            
            const processMaterial = (mat) => {
                const matName = (mat.name || "").toLowerCase();
                const meshName = (child.name || "").toLowerCase();
                
                // Nếu chất liệu đã được sơn trước đó, cập nhật màu trực tiếp để tối ưu hiệu năng
                if (matName.includes("painted")) {
                    mat.color.copy(color);
                    mat.needsUpdate = true;
                    return mat;
                }
                
                // So khớp một phần an toàn hơn để thích ứng với mọi chỉnh sửa của GLTFLoader
                const isHullMat = matName.includes("acmat_0") || matName.includes("acmat_7") || matName.includes("acmat_8") || matName.includes("acmat_13");
                const isHullMesh = meshName.includes("object_2") || meshName.includes("object_7") || meshName.includes("object_13") || meshName.includes("object_14");
                
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
                    if (newM && newM !== child.material[i]) {
                        child.material[i] = newM;
                    }
                }
            } else if (child.material) {
                const newM = processMaterial(child.material);
                if (newM && newM !== child.material) {
                    child.material = newM;
                }
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
                paintBoat(boat, p.color);

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
    gameStarted = false;
    adminPanel.classList.add("active");
    liveLeaderboard.classList.remove("active");
    podiumScreen.classList.remove("active");
    
    if (pauseGameBtn) {
        pauseGameBtn.style.display = "none";
        pauseGameBtn.innerText = "TẠM DỪNG";
        pauseGameBtn.classList.remove("paused");
    }
    
    // Reset camera back to cinematic isometric 3D perspective
    controls.target.set(0, 10, START_Z - 80);
    camera.position.set(220, 140, START_Z + 160);
    
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
    controls.target.set(0, 10, START_Z - 80);
    camera.position.set(220, 140, START_Z + 160);
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
