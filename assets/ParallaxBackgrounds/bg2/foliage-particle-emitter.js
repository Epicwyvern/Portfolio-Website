// Foliage Particle Emitter — falling leaf particles for interactive rustle effect
// Utility class owned by FoliageWindEffect (not a standalone BaseEffect)
// Loads leaf1.webp–leaf6.webp and randomly assigns textures per particle

import * as THREE from 'https://unpkg.com/three@0.172.0/build/three.module.js';

const log = (...args) => {
    if (window.location.pathname.endsWith('test-effects.html')) {
        console.log(...args);
    }
};

const LEAF_COUNT = 6;

class FoliageParticleEmitter {
    constructor(scene, camera, renderer, basePath) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;
        this.basePath = basePath;

        this.particles = [];
        this.pool = [];
        this.maxParticles = 120;
        this.leafTextures = [];
        this.leafMaterials = [];
        this._sharedGeometry = new THREE.PlaneGeometry(1, 1);
        this._texturesLoaded = false;

        this.time = 0;

        this._cachedCamQuatInverse = new THREE.Quaternion();
        this._tmpVelScreen = new THREE.Vector3();

        this._loadLeafTextures();
    }

    async _loadLeafTextures() {
        const loader = new THREE.TextureLoader();
        const promises = [];
        for (let i = 1; i <= LEAF_COUNT; i++) {
            const path = `${this.basePath}assets/leaf${i}s.webp`;
            promises.push(new Promise((resolve) => {
                loader.load(path, (tex) => {
                    tex.colorSpace = THREE.SRGBColorSpace;
                    resolve(tex);
                }, undefined, () => {
                    log(`FoliageParticleEmitter: Failed to load ${path}`);
                    resolve(null);
                });
            }));
        }
        const results = await Promise.all(promises);
        this.leafTextures = results.filter(Boolean);

        for (const tex of this.leafTextures) {
            const mat = new THREE.MeshBasicMaterial({
                map: tex,
                transparent: true,
                blending: THREE.NormalBlending,
                depthWrite: false,
                depthTest: true,
                side: THREE.DoubleSide,
                alphaTest: 0.05
            });
            this.leafMaterials.push(mat);
        }

        this._texturesLoaded = this.leafTextures.length > 0;
        log(`FoliageParticleEmitter: Loaded ${this.leafTextures.length}/${LEAF_COUNT} leaf textures`);
    }

    _acquireParticle(materialIndex) {
        if (this.pool.length > 0) {
            const p = this.pool.pop();
            p.mesh.material = this.leafMaterials[materialIndex];
            p.mesh.visible = true;
            return p;
        }

        if (this.particles.length + this.pool.length >= this.maxParticles) {
            let oldest = null;
            let oldestAge = -1;
            for (let i = 0; i < this.particles.length; i++) {
                if (this.particles[i].age > oldestAge) {
                    oldestAge = this.particles[i].age;
                    oldest = i;
                }
            }
            if (oldest !== null) {
                const recycled = this.particles[oldest];
                const last = this.particles.length - 1;
                if (oldest !== last) this.particles[oldest] = this.particles[last];
                this.particles.length = last;
                recycled.mesh.material = this.leafMaterials[materialIndex];
                recycled.mesh.visible = true;
                return recycled;
            }
        }

        const mat = this.leafMaterials[materialIndex].clone();
        const mesh = new THREE.Mesh(this._sharedGeometry, mat);
        mesh.renderOrder = 11;
        this.scene.add(mesh);

        return {
            mesh,
            material: mat,
            position: new THREE.Vector3(),
            velocity: new THREE.Vector3(),
            age: 0,
            lifetime: 3,
            baseScale: 0.04,
            opacity: 1,
            spinSpeed: 0,
            spinAngle: 0,
            swayPhase: 0,
            swayFreq: 1,
            swayAmp: 0.1,
            twirlAxis: 0
        };
    }

    _releaseParticle(particle) {
        particle.mesh.visible = false;
        particle.age = 0;
        this.pool.push(particle);
    }

    _randRange(min, max) {
        return min + Math.random() * (max - min);
    }

    emitLeaves(worldPos, config = {}) {
        if (!this._texturesLoaded || this.leafMaterials.length === 0) return;

        const countMin = config.countMin ?? 1;
        const countMax = config.countMax ?? 3;
        const count = Math.round(this._randRange(countMin, countMax));

        const scaleMin = config.scaleMin ?? 0.02;
        const scaleMax = config.scaleMax ?? 0.06;
        const lifetimeMin = config.lifetimeMin ?? 2.0;
        const lifetimeMax = config.lifetimeMax ?? 4.5;
        const fallSpeedMin = config.fallSpeedMin ?? 0.15;
        const fallSpeedMax = config.fallSpeedMax ?? 0.4;
        const driftSpeed = config.driftSpeed ?? 0.08;
        const swayAmpMin = config.swayAmpMin ?? 0.05;
        const swayAmpMax = config.swayAmpMax ?? 0.2;
        const swayFreqMin = config.swayFreqMin ?? 1.5;
        const swayFreqMax = config.swayFreqMax ?? 3.5;
        const spinMin = config.spinMin ?? 1.0;
        const spinMax = config.spinMax ?? 4.0;
        const opacity = config.opacity ?? 0.9;
        const ejectSpeed = config.ejectSpeed ?? 0.3;

        for (let i = 0; i < count; i++) {
            const matIdx = Math.floor(Math.random() * this.leafMaterials.length);
            const p = this._acquireParticle(matIdx);

            p.position.copy(worldPos);
            p.position.z += this._randRange(0.03, 0.08);

            const angle = Math.random() * Math.PI * 2;
            const eject = this._randRange(0, ejectSpeed);
            p.velocity.set(
                Math.cos(angle) * eject + this._randRange(-driftSpeed, driftSpeed),
                -this._randRange(fallSpeedMin, fallSpeedMax),
                Math.sin(angle) * eject * 0.1
            );

            p.age = 0;
            p.lifetime = this._randRange(lifetimeMin, lifetimeMax);
            p.baseScale = this._randRange(scaleMin, scaleMax);
            p.opacity = opacity;
            p.spinSpeed = this._randRange(spinMin, spinMax) * (Math.random() > 0.5 ? 1 : -1);
            p.spinAngle = Math.random() * Math.PI * 2;
            p.swayPhase = Math.random() * Math.PI * 2;
            p.swayFreq = this._randRange(swayFreqMin, swayFreqMax);
            p.swayAmp = this._randRange(swayAmpMin, swayAmpMax);
            p.twirlAxis = Math.random() * Math.PI * 2;

            this.particles.push(p);
        }
    }

    update(deltaTime, gravity = 0.15) {
        if (!this._texturesLoaded) return;
        this.time += deltaTime;

        this._cachedCamQuatInverse.copy(this.camera.quaternion).invert();

        let i = 0;
        while (i < this.particles.length) {
            const p = this.particles[i];
            p.age += deltaTime;

            if (p.age >= p.lifetime) {
                this._releaseParticle(p);
                const last = this.particles.length - 1;
                if (i !== last) this.particles[i] = this.particles[last];
                this.particles.length = last;
                continue;
            }

            p.velocity.y -= gravity * deltaTime;

            const swayOffset = Math.sin(p.age * p.swayFreq * Math.PI * 2 + p.swayPhase) * p.swayAmp;
            p.position.x += (p.velocity.x + swayOffset * deltaTime) * deltaTime;
            p.position.y += p.velocity.y * deltaTime;
            p.position.z += p.velocity.z * deltaTime;

            p.spinAngle += p.spinSpeed * deltaTime;

            const t = p.age / p.lifetime;

            let alpha;
            if (t < 0.08) {
                alpha = t / 0.08;
            } else if (t < 0.65) {
                alpha = 1.0;
            } else {
                alpha = 1.0 - (t - 0.65) / 0.35;
            }
            if (alpha < 0) alpha = 0;
            alpha *= p.opacity;

            const twirlScale = 0.3 + 0.7 * Math.abs(Math.cos(p.spinAngle * 0.5 + p.twirlAxis));
            const s = p.baseScale * twirlScale;

            p.mesh.position.copy(p.position);
            p.mesh.scale.set(s, p.baseScale, 1);
            p.mesh.material.opacity = alpha;

            p.mesh.quaternion.copy(this.camera.quaternion);
            p.mesh.rotateZ(p.spinAngle);

            i++;
        }
    }

    cleanup() {
        for (const p of this.particles) {
            this.scene.remove(p.mesh);
            if (p.mesh.material !== p.material) p.mesh.material.dispose();
        }
        for (const p of this.pool) {
            this.scene.remove(p.mesh);
            if (p.mesh.material !== p.material) p.mesh.material.dispose();
        }
        this.particles = [];
        this.pool = [];

        if (this._sharedGeometry) {
            this._sharedGeometry.dispose();
            this._sharedGeometry = null;
        }
        for (const mat of this.leafMaterials) mat.dispose();
        for (const tex of this.leafTextures) tex.dispose();
        this.leafMaterials = [];
        this.leafTextures = [];

        log('FoliageParticleEmitter: Cleanup complete');
    }
}

export default FoliageParticleEmitter;
