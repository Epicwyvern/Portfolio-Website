// Water Particle Emitter — procedural droplet particles for sploosh spout + speed spray
// Utility class owned by WaterRippleEffect (not a standalone BaseEffect)

import * as THREE from 'https://unpkg.com/three@0.172.0/build/three.module.js';

const log = (...args) => {
    if (window.location.pathname.endsWith('test-effects.html')) {
        console.log(...args);
    }
};

class WaterParticleEmitter {
    constructor(scene, camera, renderer) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;

        this.particles = [];
        this.pool = [];
        this.maxParticles = 200;
        this.texture = null;
        this.material = null;
        this._sharedGeometry = null;

        this.lastSprayTime = 0;
        this.time = 0;

        // Pre-allocate reusable temp objects to avoid per-frame GC
        this._tmpVelScreen = new THREE.Vector3();
        this._cachedCamQuatInverse = new THREE.Quaternion();
        this._camQuatDirty = true;

        this._createTexture();
        this._createMaterial();
        this._sharedGeometry = new THREE.PlaneGeometry(1, 1);
    }

    _createTexture() {
        const size = 64;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        const cx = size / 2;
        const cy = size / 2;
        const r = size / 2;

        // Translucent droplet body: soft disc, mostly transparent
        const body = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        body.addColorStop(0, 'rgba(255, 255, 255, 0.35)');
        body.addColorStop(0.3, 'rgba(255, 255, 255, 0.2)');
        body.addColorStop(0.6, 'rgba(255, 255, 255, 0.08)');
        body.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
        ctx.fillStyle = body;
        ctx.fillRect(0, 0, size, size);

        // Small specular highlight offset from center (light refraction)
        const hl = ctx.createRadialGradient(
            cx - r * 0.2, cy - r * 0.22, 0,
            cx - r * 0.2, cy - r * 0.22, r * 0.18
        );
        hl.addColorStop(0, 'rgba(255, 255, 255, 0.7)');
        hl.addColorStop(0.4, 'rgba(255, 255, 255, 0.2)');
        hl.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
        ctx.fillStyle = hl;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();

        // Subtle rim/edge highlight (light bending around the droplet)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2);
        ctx.stroke();

        this.texture = new THREE.CanvasTexture(canvas);
        this.texture.needsUpdate = true;
    }

    _createMaterial() {
        this.material = new THREE.MeshBasicMaterial({
            map: this.texture,
            transparent: true,
            blending: THREE.NormalBlending,
            depthWrite: false,
            depthTest: true,
            side: THREE.DoubleSide
        });
    }

    _acquireParticle() {
        if (this.pool.length > 0) {
            const p = this.pool.pop();
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
                // Swap-and-pop: O(1) removal instead of O(n) splice
                const recycled = this.particles[oldest];
                const last = this.particles.length - 1;
                if (oldest !== last) this.particles[oldest] = this.particles[last];
                this.particles.length = last;
                recycled.mesh.visible = true;
                return recycled;
            }
        }

        const mat = this.material.clone();
        const mesh = new THREE.Mesh(this._sharedGeometry, mat);
        mesh.renderOrder = 10;
        this.scene.add(mesh);

        return {
            mesh,
            material: mat,
            position: new THREE.Vector3(),
            velocity: new THREE.Vector3(),
            age: 0,
            lifetime: 1,
            baseScale: 0.02,
            opacity: 1,
            tintR: 0.53,
            tintG: 0.8,
            tintB: 1.0
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

    emitSploosh(worldPos, config = {}) {
        const countMin = config.countMin ?? 12;
        const countMax = config.countMax ?? 20;
        const count = Math.round(this._randRange(countMin, countMax));

        const velUpMin = config.velocityUpMin ?? 1.2;
        const velUpMax = config.velocityUpMax ?? 3.0;
        const velSpread = config.velocitySpread ?? 0.6;
        const velForward = config.velocityForward ?? 0.08;
        const lifetimeMin = config.lifetimeMin ?? 0.4;
        const lifetimeMax = config.lifetimeMax ?? 0.9;
        const scaleMin = config.scaleMin ?? 0.02;
        const scaleMax = config.scaleMax ?? 0.06;
        const opacity = config.opacity ?? 0.5;

        // Water color sampled from background, slightly brightened with blue bias
        const wc = config.waterColor || { r: 0.15, g: 0.25, b: 0.35 };
        const boost = 0.15;
        const tintR = Math.min(1.0, wc.r + boost * 0.3);
        const tintG = Math.min(1.0, wc.g + boost * 0.7);
        const tintB = Math.min(1.0, wc.b + boost * 1.0);

        for (let i = 0; i < count; i++) {
            const p = this._acquireParticle();

            p.position.copy(worldPos);
            p.position.z += this._randRange(0.08, 0.2);

            const angle = Math.random() * Math.PI * 2;
            const spreadMag = this._randRange(0, velSpread);
            p.velocity.set(
                Math.cos(angle) * spreadMag,
                this._randRange(velUpMin, velUpMax),
                Math.sin(angle) * spreadMag * 0.15 + velForward
            );

            p.age = 0;
            p.lifetime = this._randRange(lifetimeMin, lifetimeMax);
            p.baseScale = this._randRange(scaleMin, scaleMax);
            p.opacity = opacity;
            // Per-particle color variation for natural look
            const colorVar = this._randRange(-0.04, 0.04);
            p.tintR = Math.min(1.0, tintR + colorVar);
            p.tintG = Math.min(1.0, tintG + colorVar);
            p.tintB = Math.min(1.0, tintB + colorVar * 0.5);

            this.particles.push(p);
        }

        log(`WaterParticleEmitter: Sploosh burst at (${worldPos.x.toFixed(3)}, ${worldPos.y.toFixed(3)}), ${count} particles, water rgb(${(wc.r*255)|0},${(wc.g*255)|0},${(wc.b*255)|0})`);
    }

    emitSpray(worldPos, velocity, config = {}) {
        const spawnInterval = config.spawnInterval ?? 0.05;
        if (this.time - this.lastSprayTime < spawnInterval) return;
        this.lastSprayTime = this.time;

        const countMin = config.countMin ?? 2;
        const countMax = config.countMax ?? 4;
        const count = Math.round(this._randRange(countMin, countMax));

        // Trail: how much particles fly opposite to movement direction
        const trailMin = config.trailMin ?? 0.5;
        const trailMax = config.trailMax ?? 1.5;
        // Up: small upward component (much less than trail)
        const velUpMin = config.velocityUpMin ?? 0.3;
        const velUpMax = config.velocityUpMax ?? 0.8;
        // Perp: sideways spread off the trail axis
        const velSpread = config.velocitySpread ?? 0.2;
        const lifetimeMin = config.lifetimeMin ?? 0.2;
        const lifetimeMax = config.lifetimeMax ?? 0.5;
        const scaleMin = config.scaleMin ?? 0.01;
        const scaleMax = config.scaleMax ?? 0.035;
        const opacity = config.opacity ?? 0.4;

        // Water color sampled from background, with blue bias
        const wc = config.waterColor || { r: 0.15, g: 0.25, b: 0.35 };
        const boost = 0.12;
        const tintR = Math.min(1.0, wc.r + boost * 0.3);
        const tintG = Math.min(1.0, wc.g + boost * 0.7);
        const tintB = Math.min(1.0, wc.b + boost * 1.0);

        const velMag = velocity.length();
        let vdx, vdy;
        if (velMag > 0.001) {
            vdx = velocity.x / velMag;
            vdy = velocity.y / velMag;
        } else {
            vdx = 0;
            vdy = 1;
        }
        const perpX = -vdy, perpY = vdx;

        for (let i = 0; i < count; i++) {
            const p = this._acquireParticle();

            p.position.copy(worldPos);
            p.position.z += this._randRange(0.08, 0.15);

            // Primary velocity: trail BEHIND the wake (opposite to movement)
            const trailMag = this._randRange(trailMin, trailMax);
            const upMag = this._randRange(velUpMin, velUpMax);
            const side = (Math.random() > 0.5 ? 1 : -1) * this._randRange(0.2, 1.0);
            const perpMag = side * this._randRange(0, velSpread);

            p.velocity.set(
                -vdx * trailMag + perpX * perpMag,
                -vdy * trailMag + perpY * perpMag + upMag,
                0.04
            );

            p.age = 0;
            p.lifetime = this._randRange(lifetimeMin, lifetimeMax);
            p.baseScale = this._randRange(scaleMin, scaleMax);
            p.opacity = opacity;
            const colorVar = this._randRange(-0.03, 0.03);
            p.tintR = Math.min(1.0, tintR + colorVar);
            p.tintG = Math.min(1.0, tintG + colorVar);
            p.tintB = Math.min(1.0, tintB + colorVar * 0.5);

            this.particles.push(p);
        }
    }

    update(deltaTime, gravity = 2.0) {
        this.time += deltaTime;

        // Cache inverse camera quaternion once per frame (not per particle)
        this._cachedCamQuatInverse.copy(this.camera.quaternion).invert();

        // Iterate with swap-and-pop for O(1) removal
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

            p.position.x += p.velocity.x * deltaTime;
            p.position.y += p.velocity.y * deltaTime;
            p.position.z += p.velocity.z * deltaTime;

            const t = p.age / p.lifetime;

            let scaleMul;
            if (t < 0.15) {
                scaleMul = t / 0.15;
            } else if (t < 0.6) {
                scaleMul = 1.0;
            } else {
                scaleMul = 1.0 - (t - 0.6) / 0.4;
            }
            if (scaleMul < 0) scaleMul = 0;
            const s = p.baseScale * (0.3 + scaleMul * 0.7);

            let alpha;
            if (t < 0.05) {
                alpha = t / 0.05;
            } else if (t < 0.6) {
                alpha = 1.0;
            } else {
                alpha = 1.0 - (t - 0.6) / 0.4;
            }
            if (alpha < 0) alpha = 0;
            alpha *= p.opacity;

            p.mesh.position.copy(p.position);

            // Compute speed without calling .length() (avoid sqrt when possible)
            const vx = p.velocity.x, vy = p.velocity.y, vz = p.velocity.z;
            const speedSq = vx * vx + vy * vy + vz * vz;
            const speed = speedSq > 0.0025 ? Math.sqrt(speedSq) : 0;
            const stretchFactor = 1.0 + Math.min(speed * 0.6, 1.5);
            p.mesh.scale.set(s, s * stretchFactor, 1);

            p.mesh.material.opacity = alpha;
            p.mesh.material.color.setRGB(p.tintR, p.tintG, p.tintB);

            // Billboard: copy camera orientation, then rotate to align stretch
            p.mesh.quaternion.copy(this.camera.quaternion);
            if (speed > 0.05) {
                // Reuse temp vector instead of cloning
                this._tmpVelScreen.set(vx, vy, vz).applyQuaternion(this._cachedCamQuatInverse);
                const angle = Math.atan2(this._tmpVelScreen.x, this._tmpVelScreen.y);
                p.mesh.rotateZ(-angle);
            }

            i++;
        }
    }

    cleanup() {
        for (const p of this.particles) {
            this.scene.remove(p.mesh);
            p.mesh.material.dispose();
        }
        for (const p of this.pool) {
            this.scene.remove(p.mesh);
            p.mesh.material.dispose();
        }
        this.particles = [];
        this.pool = [];

        if (this._sharedGeometry) {
            this._sharedGeometry.dispose();
            this._sharedGeometry = null;
        }
        if (this.texture) {
            this.texture.dispose();
            this.texture = null;
        }
        if (this.material) {
            this.material.dispose();
            this.material = null;
        }

        log('WaterParticleEmitter: Cleanup complete');
    }
}

export default WaterParticleEmitter;
