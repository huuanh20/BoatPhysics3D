import * as THREE from 'three';

export class BoatMovementSystem {
    constructor(waveAmplitude = 0.5, waveFrequency = 1.0) {
        this.waveAmplitude = waveAmplitude;
        this.waveFrequency = waveFrequency;
    }

    updateWaves(amplitude, frequency) {
        this.waveAmplitude = amplitude;
        this.waveFrequency = frequency;
    }

    // Apply procedural wave physics to any 3D object
    applyWaveBobbing(mesh, time, heaveOffset = 0) {
        if (!mesh) return;
        
        const localTime = time * 2.0 + heaveOffset;
        const bob = Math.sin(localTime) * 0.25 * this.waveAmplitude;
        const pitch = Math.sin(time * 1.5 + heaveOffset) * 0.02 * this.waveFrequency;
        const roll = Math.cos(time * 1.0 + heaveOffset) * 0.03 * this.waveAmplitude;
        
        mesh.position.y = 24.0 + bob;
        mesh.rotation.x = pitch;
        mesh.rotation.z = roll;
    }

    // Smooth position interpolation (independent of FPS)
    interpolatePosition(currentPos, targetPos, lerpFactor, fpsRatio) {
        return currentPos + (targetPos - currentPos) * lerpFactor * fpsRatio;
    }
}
