// Sprites (bg2) — short-lived “forest spirit” particles: UV+depth ellipsoid spawn, turbulence + optional
// velocity wander + speed oscillation, billboard core + optional fuzzy trail motes (spriteTrail.png), random UV offset,
// optional spawn bias opposite head UV velocity (+ speed vs speedUVPerSec coupling), radial drift, shrink, fade.

import BaseEffect, { effectConfigHexToInt } from '../../../js/base-effect.js';
import * as THREE from 'https://unpkg.com/three@0.172.0/build/three.module.js';

const log = (...args) => {
    if (window.location.pathname.endsWith('test-effects.html')) {
        console.log(...args);
    }
};

const _scratchMatrix = new THREE.Matrix4();
const _scratchPosition = new THREE.Vector3();
const _scratchCamDir = new THREE.Vector3();
const _scratchColor = new THREE.Color();
const _scratchDisp = new THREE.Vector2();
const _scratchScale = new THREE.Vector3();
const _billboardQuat = new THREE.Quaternion();

function randRange(min, max) {
    return min + Math.random() * (max - min);
}

/** @param {unknown} v @param {number} fb */
function num(v, fb) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fb;
}

/** UV ellipse radii: `sphereRadiusU` / `sphereRadiusV`, or legacy `sphereRadiusUV` for both.
 *  Offset is rotated in the UV plane by `sphereRotationDegrees` (applied in `_spawnParticle` from live `config`). */
function ellipseRadiiUV(cfg) {
    const legacy = num(cfg.sphereRadiusUV, NaN);
    const ru0 = num(cfg.sphereRadiusU, NaN);
    const rv0 = num(cfg.sphereRadiusV, NaN);
    const ru = Number.isFinite(ru0) ? ru0 : (Number.isFinite(legacy) ? legacy : 0.05);
    const rv = Number.isFinite(rv0) ? rv0 : (Number.isFinite(legacy) ? legacy : ru);
    return { ru, rv };
}

/**
 * @param {Record<string, unknown>} cfg
 * @param {string} key
 * @param {number} defMin
 * @param {number} defMax
 */
function range(cfg, key, defMin, defMax) {
    const o = cfg && typeof cfg[key] === 'object' ? cfg[key] : null;
    if (o && o !== null && 'min' in o && 'max' in o) {
        return { min: num(o.min, defMin), max: num(o.max, defMax) };
    }
    return { min: defMin, max: defMax };
}

/** Single number repeats min=max; missing key uses defaults. */
function scalarOrRange(cfg, key, defMin, defMax) {
    const v = cfg && cfg[key];
    if (v && typeof v === 'object' && !Array.isArray(v) && 'min' in v && 'max' in v) {
        return { min: num(v.min, defMin), max: num(v.max, defMax) };
    }
    if (typeof v === 'number' && Number.isFinite(v)) {
        return { min: v, max: v };
    }
    return { min: defMin, max: defMax };
}

/** Spawns/sec range; falls back to legacy `trailEmitInterval` if `trailSpawnPerSecond` is absent. */
function trailSpawnRateRange(cfg) {
    const ts = cfg && cfg.trailSpawnPerSecond;
    if (ts && typeof ts === 'object' && !Array.isArray(ts) && 'min' in ts && 'max' in ts) {
        return range(cfg, 'trailSpawnPerSecond', 12, 24);
    }
    const intv = range(cfg, 'trailEmitInterval', 0.12, 0.35);
    const lo = 1 / Math.max(1e-4, intv.max);
    const hi = 1 / Math.max(1e-4, intv.min);
    return lo <= hi ? { min: lo, max: hi } : { min: hi, max: lo };
}

/**
 * Oscillation tuning: each key can be `{ min, max }` (randomized per particle on spawn) or a legacy
 * single number (treated as a loose band so old configs still vary).
 */
function oscRange(cfg, key, defMin, defMax) {
    const v = cfg && cfg[key];
    if (v && typeof v === 'object' && !Array.isArray(v) && 'min' in v && 'max' in v) {
        const lo = num(v.min, defMin);
        const hi = num(v.max, defMax);
        return lo <= hi ? { min: lo, max: hi } : { min: hi, max: lo };
    }
    if (typeof v === 'number' && Number.isFinite(v)) {
        const lo = v * 0.85;
        const hi = v * 1.15;
        return lo <= hi ? { min: lo, max: hi } : { min: hi, max: lo };
    }
    return { min: defMin, max: defMax };
}

/**
 * `oscillateScaleAmp` defines the scale multiplier swing relative to each particle's `baseScale`.
 * Use `{ min, max }` multipliers (e.g. 0.9 … 1.1): oscillation runs between those values via sin.
 * Legacy configs used small numbers as additive sin amplitude (~0.05–0.35); those map to ~[1−a, 1+a].
 */
function scaleOscMultiplierRange(cfg) {
    const v = cfg && cfg.oscillateScaleAmp;
    if (v && typeof v === 'object' && !Array.isArray(v) && 'min' in v && 'max' in v) {
        let lo = num(v.min, 0.9);
        let hi = num(v.max, 1.1);
        if (lo > hi) {
            const t = lo;
            lo = hi;
            hi = t;
        }
        if (hi <= 0.45) {
            const a = Math.max(lo, hi);
            return {
                min: Math.max(0.05, 1 - a),
                max: 1 + a,
            };
        }
        return {
            min: Math.max(0.05, lo),
            max: Math.max(Math.max(0.05, lo), hi),
        };
    }
    if (typeof v === 'number' && Number.isFinite(v)) {
        const w = Math.abs(v);
        if (w <= 0.45) {
            return { min: Math.max(0.05, 1 - w), max: 1 + w };
        }
        return {
            min: Math.max(0.05, 1 - w * 0.5),
            max: 1 + w * 0.5,
        };
    }
    return { min: 0.9, max: 1.1 };
}

function fract(x) {
    return x - Math.floor(x);
}

/** Cheap 3D value noise in [0,1) for turbulence */
function valueNoise3(x, y, z) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    const fx = fract(x);
    const fy = fract(y);
    const fz = fract(z);
    const smooth = (t) => t * t * (3 - 2 * t);
    const ux = smooth(fx);
    const uy = smooth(fy);
    const uz = smooth(fz);
    const h = (a, b, c) => fract(Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453);
    const n000 = h(ix, iy, iz);
    const n100 = h(ix + 1, iy, iz);
    const n010 = h(ix, iy + 1, iz);
    const n110 = h(ix + 1, iy + 1, iz);
    const n001 = h(ix, iy, iz + 1);
    const n101 = h(ix + 1, iy, iz + 1);
    const n011 = h(ix, iy + 1, iz + 1);
    const n111 = h(ix + 1, iy + 1, iz + 1);
    const x00 = n000 * (1 - ux) + n100 * ux;
    const x10 = n010 * (1 - ux) + n110 * ux;
    const x01 = n001 * (1 - ux) + n101 * ux;
    const x11 = n011 * (1 - ux) + n111 * ux;
    const y0 = x00 * (1 - uy) + x10 * uy;
    const y1 = x01 * (1 - uy) + x11 * uy;
    return y0 * (1 - uz) + y1 * uz;
}

function mergeSpriteConfig(defaults, cluster) {
    return { ...defaults, ...cluster };
}

class SpritesEffect extends BaseEffect {
    async init() {
        log('SpritesEffect: init');
        try {
            const spritePath = './assets/ParallaxBackgrounds/bg2/assets/sprite.png';
            const trailPath = './assets/ParallaxBackgrounds/bg2/assets/spriteTrail.png';
            if (!this._spriteTexture || !this._trailTexture) {
                const [mainTex, trailTex] = await Promise.all([
                    this.loadTexture(spritePath),
                    this.loadTexture(trailPath),
                ]);
                this._spriteTexture = mainTex;
                this._trailTexture = trailTex;
            }

            const raw = this.parallax?.config?.effects?.sprites;
            if (!raw || !Array.isArray(raw.spriteClusters)) {
                console.warn('SpritesEffect: missing effects.sprites.spriteClusters, using fallback');
                this._fullConfig = this._fallbackConfig();
            } else {
                this._fullConfig = this._normalizeConfig(raw);
            }

            this._buildClusterSystems();
            const { headCap, trailCap } = this._computeInstanceCapacity();
            this._trailInstanceCapacity = trailCap;
            if (trailCap > 0) {
                this._createTrailInstancedMesh(trailCap);
            } else {
                this._trailInstancedMesh = null;
            }
            this._createInstancedMesh(headCap);
            if (this._instancedMesh) {
                this._instancedMesh.renderOrder = 1;
            }
            this._refreshDisabledClusters();
            this._warmStartClusters();
            this._unsubSpritesChange = this.parallax?.onSpritesIndividualChange?.(() => {
                this._refreshDisabledClusters();
            });

            this.isInitialized = true;
            this.update(1e-6);
            log(`SpritesEffect: ${this._clusterSystems.length} clusters, head=${headCap} trail=${trailCap}`);
        } catch (e) {
            console.error('SpritesEffect: init failed', e);
            throw e;
        }
    }

    _fallbackConfig() {
        return {
            meshZOffset: 0.008,
            depthTest: false,
            depthWrite: false,
            defaults: {
                blendMode: 'AdditiveBlending',
                alphaTest: 0.01,
                spawnPerSecond: { min: 2, max: 5 },
                lifetimeSeconds: { min: 4, max: 9 },
                baseScale: { min: 0.045, max: 0.11 },
                speedUVPerSec: { min: 0.015, max: 0.055 },
                depthSpeed: { min: -0.012, max: 0.012 },
                depthRange: { min: -0.025, max: 0.035 },
                sphereRadiusU: 0.045,
                sphereRadiusV: 0.045,
                sphereRadiusZ: 0.018,
                sphereRotationDegrees: 0,
                turbulence: 0.42,
                turbulenceScaleUV: 9,
                velocityDamping: 0.92,
                velocityWanderStrength: 0.11,
                velocityWanderFreq: { min: 0.55, max: 2.0 },
                speedOscillationAmp: 0.14,
                speedOscillationFreq: { min: 0.32, max: 1.15 },
                oscillateAlphaAmp: { min: 0.06, max: 0.2 },
                oscillateAlphaFreq: { min: 1.2, max: 4.2 },
                oscillateScaleAmp: { min: 0.9, max: 1.1 },
                oscillateScaleFreq: { min: 0.7, max: 3.0 },
                color: '0xb8ff66',
                colorVariance: 0.12,
                trailEnabled: true,
                trailPlaybackSpeed: 1,
                trailSpawnPerSecond: { min: 12, max: 24 },
                trailLifetime: { min: 0.22, max: 0.52 },
                trailSpawnRadiusUV: { min: 0.002, max: 0.016 },
                trailSpawnOppositeMotionBias: 0,
                trailSpawnOppositeMotionSpeedCoupling: 0,
                trailDriftUVPerSec: { min: 0.004, max: 0.028 },
                trailScaleStart: { min: 0.22, max: 0.48 },
                trailScaleEnd: { min: 0.03, max: 0.1 },
                trailScaleUsesParentBase: true,
                trailPeakOpacity: { min: 0.2, max: 0.42 },
                trailFadePower: 1.35,
                trailMaxConcurrent: 14,
                trailFollowParentEnvelope: true,
                trailDepthBias: 0.002,
                trailDepthDriftPerSec: { min: -0.003, max: 0.003 },
                trailBlendMode: 'AdditiveBlending',
                trailAlphaTest: 0.001,
                instanceBufferHeadroom: 2.35,
                opacity: { min: 0.55, max: 1.0 },
                warmStartEnabled: true,
                warmStartCount: { min: 0, max: 0 },
                warmStartAgeFraction: { min: 0.35, max: 0.65 },
            },
            spriteClusters: [
                {
                    name: 'DemoSprites',
                    position: { x: 0.42, y: 0.38, z: 0 },
                    sphereRadiusU: 0.055,
                    sphereRadiusV: 0.055,
                    sphereRadiusZ: 0.022,
                },
            ],
        };
    }

    _normalizeConfig(raw) {
        const d = raw.defaults && typeof raw.defaults === 'object' ? { ...raw.defaults } : {};
        if (Object.prototype.hasOwnProperty.call(raw, 'warmStartEnabled')) {
            d.warmStartEnabled = raw.warmStartEnabled !== false && raw.warmStartEnabled !== 'false';
        }
        if (d.color && typeof d.color === 'string') {
            d.color = effectConfigHexToInt(d.color, 0xb8ff66);
        } else if (typeof d.color !== 'number') {
            d.color = effectConfigHexToInt(d.color, 0xb8ff66);
        }
        const clusters = raw.spriteClusters.map((c) => {
            const m = { ...c };
            if (m.color && typeof m.color === 'string') {
                m.color = effectConfigHexToInt(m.color, d.color);
            }
            return m;
        });
        return {
            meshZOffset: num(raw.meshZOffset, 0.008),
            depthTest: raw.depthTest === true,
            depthWrite: raw.depthWrite === true,
            defaults: d,
            spriteClusters: clusters,
        };
    }

    _buildClusterSystems() {
        const fc = this._fullConfig;
        this._clusterSystems = [];
        for (let i = 0; i < fc.spriteClusters.length; i++) {
            const cfg = mergeSpriteConfig(fc.defaults, fc.spriteClusters[i]);
            const spawnR = range(cfg, 'spawnPerSecond', 2, 5);
            const lifeR = range(cfg, 'lifetimeSeconds', 3, 8);
            const headroom = Math.max(1.1, num(cfg.instanceBufferHeadroom, 2.35));
            const estConcurrent = spawnR.max * lifeR.max * headroom;
            const particleCap = Math.max(8, Math.ceil(estConcurrent));

            const center = cfg.position || { x: 0.5, y: 0.5, z: 0 };
            if (typeof cfg.color === 'string') {
                cfg.color = effectConfigHexToInt(cfg.color, effectConfigHexToInt(fc.defaults?.color, 0xb8ff66));
            }
            this._clusterSystems.push({
                name: cfg.name || `sprites_${i}`,
                index: i,
                config: cfg,
                particles: [],
                nextSpawnTime: Math.random() * 0.8,
                particleCap,
                centerU: num(center.x, 0.5),
                centerV: num(center.y, 0.5),
                centerZ: num(center.z, 0),
            });
        }
    }

    /**
     * Spawn a random count of particles per cluster and integrate them on a shared timeline so turbulence
     * (uses `this.time`) matches the live effect. Skipped when `warmStartEnabled` is false or
     * `warmStartCount` min/max are both 0.
     */
    _warmStartClusters() {
        this.time = 0;
        if (!this._clusterSystems?.length) {
            return;
        }

        const dt = 0.02;
        const maxSim = 120;
        let simTime = 0;

        for (const system of this._clusterSystems) {
            if (this._disabledClusters?.has(system.name)) continue;

            const cfg = system.config;
            if (cfg.warmStartEnabled === false || cfg.warmStartEnabled === 'false') continue;

            const cntR = scalarOrRange(cfg, 'warmStartCount', 0, 0);
            const want = Math.floor(randRange(Math.min(cntR.min, cntR.max), Math.max(cntR.min, cntR.max)));
            const n = Math.max(0, Math.min(want, system.particleCap));
            if (n <= 0) continue;

            const ageFracR = range(cfg, 'warmStartAgeFraction', 0.35, 0.65);
            const lifeR = range(cfg, 'lifetimeSeconds', 3, 8);

            for (let i = 0; i < n; i++) {
                this._spawnParticle(system, lifeR);
                const p = system.particles[system.particles.length - 1];
                const frac = randRange(ageFracR.min, ageFracR.max);
                const clamped = Math.max(0.08, Math.min(0.92, frac));
                p._warmTargetAge = Math.min(p.lifetime * clamped, p.lifetime * 0.999);
            }
        }

        while (simTime < maxSim) {
            let anyWarming = false;
            for (const system of this._clusterSystems) {
                if (this._disabledClusters?.has(system.name)) continue;
                for (const p of system.particles) {
                    if (p._warmTargetAge != null && p.age < p._warmTargetAge) {
                        anyWarming = true;
                        break;
                    }
                }
                if (anyWarming) break;
            }
            if (!anyWarming) break;

            this.time = simTime;
            for (const system of this._clusterSystems) {
                if (this._disabledClusters?.has(system.name)) continue;
                const cfg = system.config;
                for (const p of system.particles) {
                    if (p._warmTargetAge == null || p.age >= p._warmTargetAge) continue;
                    const h = Math.min(dt, p._warmTargetAge - p.age);
                    this._integrateParticle(p, cfg, h);
                    p.age += h;
                }
            }
            simTime += dt;
        }

        this.time = simTime;

        for (const system of this._clusterSystems) {
            if (this._disabledClusters?.has(system.name)) continue;
            for (const p of system.particles) {
                if (p._warmTargetAge != null) delete p._warmTargetAge;
                p.trailNextEmit = this.time + Math.random() * 0.06;
                if (p.trailMotes?.length) p.trailMotes.length = 0;
            }
        }

        if (simTime > 0) {
            for (const system of this._clusterSystems) {
                if (this._disabledClusters?.has(system.name)) continue;
                const cfg = system.config;
                const spawnR = range(cfg, 'spawnPerSecond', 2, 5);
                const interval = 1 / randRange(spawnR.min, spawnR.max);
                system.nextSpawnTime = this.time + interval * (0.85 + Math.random() * 0.3);
            }
        }
    }

    _computeInstanceCapacity() {
        let headSum = 0;
        let trailSum = 0;
        for (const sys of this._clusterSystems) {
            const cfg = sys.config;
            headSum += sys.particleCap;
            let maxP = 0;
            if (cfg.trailEnabled !== false) {
                const mc = cfg.trailMaxConcurrent ?? cfg.trailMaxPulses;
                maxP = Math.max(0, Math.min(64, Math.floor(num(mc, 14))));
            }
            trailSum += sys.particleCap * maxP;
        }
        headSum = Math.min(8000, Math.max(32, Math.ceil(headSum)));
        trailSum = Math.min(12000, Math.max(0, Math.ceil(trailSum)));
        return { headCap: headSum, trailCap: trailSum };
    }

    _createInstancedMesh(capacity) {
        const fc = this._fullConfig;
        const d = fc.defaults || {};
        const blendMode = this.getBlendMode(d.blendMode || 'AdditiveBlending');
        const alphaTest = num(d.alphaTest, 0.01);

        const geometry = new THREE.PlaneGeometry(1, 1);
        const material = new THREE.MeshBasicMaterial({
            map: this._spriteTexture,
            transparent: true,
            opacity: 1,
            alphaTest,
            blending: blendMode,
            side: THREE.DoubleSide,
            depthWrite: fc.depthWrite === true,
            depthTest: fc.depthTest === true,
        });

        this._instancedMesh = new THREE.InstancedMesh(geometry, material, capacity);
        this._instancedMesh.count = 0;
        this._instancedMesh.frustumCulled = false;

        _scratchMatrix.makeScale(0, 0, 0);
        for (let i = 0; i < capacity; i++) {
            this._instancedMesh.setMatrixAt(i, _scratchMatrix);
        }
        this._instancedMesh.instanceMatrix.needsUpdate = true;

        this.scene.add(this._instancedMesh);
        this.meshes.push(this._instancedMesh);
        this.materials.push(material);
        this.textures.push(this._spriteTexture);
        this._instanceCapacity = capacity;
    }

    _createTrailInstancedMesh(capacity) {
        const fc = this._fullConfig;
        const d = fc.defaults || {};
        const blendMode = this.getBlendMode(d.trailBlendMode || 'AdditiveBlending');
        const alphaTest = num(d.trailAlphaTest, 0.001);

        const geometry = new THREE.PlaneGeometry(1, 1);
        const material = new THREE.MeshBasicMaterial({
            map: this._trailTexture,
            transparent: true,
            opacity: 1,
            alphaTest,
            blending: blendMode,
            side: THREE.DoubleSide,
            depthWrite: fc.depthWrite === true,
            depthTest: fc.depthTest === true,
        });

        this._trailInstancedMesh = new THREE.InstancedMesh(geometry, material, capacity);
        this._trailInstancedMesh.count = 0;
        this._trailInstancedMesh.frustumCulled = false;
        this._trailInstancedMesh.renderOrder = 0;

        _scratchMatrix.makeScale(0, 0, 0);
        for (let i = 0; i < capacity; i++) {
            this._trailInstancedMesh.setMatrixAt(i, _scratchMatrix);
        }
        this._trailInstancedMesh.instanceMatrix.needsUpdate = true;

        this.scene.add(this._trailInstancedMesh);
        this.meshes.push(this._trailInstancedMesh);
        this.materials.push(material);
        this.textures.push(this._trailTexture);
    }

    _refreshDisabledClusters() {
        this._disabledClusters = new Set();
        const cfg = this.parallax?.config?.effects?.sprites;
        if (!this.parallax || !cfg?.spriteClusters) return;
        for (const c of cfg.spriteClusters) {
            const name = c.name;
            if (this.parallax.getFlag(`effects.sprites.individual.${name}`) === false) {
                this._disabledClusters.add(name);
            }
        }
    }

    update(deltaTime) {
        if (!this.isInitialized || !this._instancedMesh) return;

        let frameDelta = Number.isFinite(deltaTime) && deltaTime > 0 ? deltaTime : 0.016;
        frameDelta = Math.min(frameDelta, 0.1);
        this.time += frameDelta;

        _billboardQuat.copy(this.camera.quaternion);

        let instanceIndex = 0;
        const cap = this._instanceCapacity;
        let trailIndex = 0;
        const trailCap = this._trailInstanceCapacity || 0;

        for (let si = 0; si < this._clusterSystems.length; si++) {
            const system = this._clusterSystems[si];
            if (this._disabledClusters?.has(system.name)) {
                system.particles.length = 0;
                continue;
            }

            const cfg = system.config;
            const spawnR = range(cfg, 'spawnPerSecond', 2, 5);

            while (this.time >= system.nextSpawnTime && system.particles.length < system.particleCap) {
                const lifeR = range(cfg, 'lifetimeSeconds', 3, 8);
                this._spawnParticle(system, lifeR);
                const interval = 1 / randRange(spawnR.min, spawnR.max);
                system.nextSpawnTime = this.time + interval * (0.85 + Math.random() * 0.3);
            }

            let pi = 0;
            while (pi < system.particles.length) {
                const p = system.particles[pi];

                p.age += frameDelta;
                if (p.age >= p.lifetime) {
                    const last = system.particles.length - 1;
                    if (pi < last) system.particles[pi] = system.particles[last];
                    system.particles.length = last;
                    continue;
                }

                if (!p.trailMotes) {
                    p.trailMotes = [];
                    p.trailNextEmit = this.time + Math.random() * 0.06;
                }

                this._integrateParticle(p, cfg, frameDelta);

                const lifeT = p.age / p.lifetime;
                let env = 1;
                if (lifeT < 0.12) {
                    const t = lifeT / 0.12;
                    env = t * t;
                } else if (lifeT > 0.78) {
                    const t = (lifeT - 0.78) / 0.22;
                    env = 1 - t * t;
                }

                const oscAraw =
                    1 - p.oscAmpA * Math.sin(p.age * p.oscFreqA + p.phaseA);
                const oscA = Math.max(0.12, Math.min(1.35, oscAraw));

                const smLo = p.scaleMultMin;
                const smHi = p.scaleMultMax;
                const smMid = (smLo + smHi) * 0.5;
                const smHalf = (smHi - smLo) * 0.5;
                const scaleMult = smMid + smHalf * Math.sin(p.age * p.oscFreqS + p.phaseS);

                const headScale = p.baseScale * scaleMult * env;
                const headAlpha = env * oscA * p.peakOpacity;

                if (instanceIndex < cap) {
                    this._writeBillboard(
                        this._instancedMesh,
                        p.u,
                        p.v,
                        p.zOff,
                        0,
                        headScale,
                        p.baseColor,
                        headAlpha,
                        instanceIndex++
                    );
                }

                const trailOn = cfg.trailEnabled !== false && this._trailInstancedMesh && trailCap > 0;
                if (trailOn) {
                    const maxC = Math.max(0, Math.min(64, Math.floor(num(cfg.trailMaxConcurrent ?? cfg.trailMaxPulses, 14))));
                    const spd = Math.max(0.05, num(cfg.trailPlaybackSpeed, 1));
                    const trailDt = frameDelta * spd;
                    const spawnRR = trailSpawnRateRange(cfg);
                    const fadePow = Math.max(0.15, num(cfg.trailFadePower, 1.35));
                    const depthBias = num(cfg.trailDepthBias, 0.002);
                    const useParentScale = cfg.trailScaleUsesParentBase !== false;

                    for (let ti = p.trailMotes.length - 1; ti >= 0; ti--) {
                        const m = p.trailMotes[ti];
                        m.age += trailDt;
                        if (m.age >= m.lifetime) {
                            p.trailMotes.splice(ti, 1);
                        }
                    }

                    while (maxC > 0 && p.trailNextEmit <= this.time && p.trailMotes.length < maxC) {
                        this._spawnTrailMote(p, cfg);
                        const gap = 1 / Math.max(0.1, randRange(spawnRR.min, spawnRR.max));
                        p.trailNextEmit = this.time + gap / spd;
                    }

                    for (let ti = 0; ti < p.trailMotes.length; ti++) {
                        const m = p.trailMotes[ti];
                        const t = Math.min(1, m.age / m.lifetime);
                        const fade = Math.pow(Math.max(0, 1 - t), fadePow);
                        let alpha = m.peakOpacity * fade;
                        if (cfg.trailFollowParentEnvelope !== false) {
                            alpha *= env;
                        }
                        if (alpha < 0.008 || trailIndex >= trailCap) continue;

                        const u = p.u + m.offU + m.driftU * m.age;
                        const v = p.v + m.offV + m.driftV * m.age;
                        const baseS = useParentScale ? p.baseScale : 1;
                        const trailScale = baseS * (m.scale0 + (m.scale1 - m.scale0) * t);
                        const zExtra = depthBias + m.z0 + m.zDrift * m.age;

                        this._writeBillboard(
                            this._trailInstancedMesh,
                            u,
                            v,
                            p.zOff,
                            zExtra,
                            trailScale,
                            p.baseColor,
                            alpha,
                            trailIndex++
                        );
                    }
                } else if (cfg.trailEnabled === false) {
                    p.trailMotes.length = 0;
                }

                pi++;
            }
        }

        this._instancedMesh.count = instanceIndex;
        if (instanceIndex > 0) {
            this._instancedMesh.instanceMatrix.needsUpdate = true;
            if (this._instancedMesh.instanceColor) {
                this._instancedMesh.instanceColor.needsUpdate = true;
            }
        }

        if (this._trailInstancedMesh) {
            this._trailInstancedMesh.count = trailIndex;
            if (trailIndex > 0) {
                this._trailInstancedMesh.instanceMatrix.needsUpdate = true;
                if (this._trailInstancedMesh.instanceColor) {
                    this._trailInstancedMesh.instanceColor.needsUpdate = true;
                }
            }
        }
    }

    _spawnParticle(system, lifeR) {
        const cfg = system.config;
        const { ru, rv } = ellipseRadiiUV(cfg);
        const rz = num(cfg.sphereRadiusZ, 0.02);
        let x;
        let y;
        let z;
        do {
            x = (Math.random() * 2 - 1) * ru;
            y = (Math.random() * 2 - 1) * rv;
            z = (Math.random() * 2 - 1) * rz;
        } while (x * x / (ru * ru) + y * y / (rv * rv) + z * z / (rz * rz) > 1);

        const rotDeg = num(cfg.sphereRotationDegrees, 0);
        const rotRad = (rotDeg * Math.PI) / 180;
        const c = Math.cos(rotRad);
        const s = Math.sin(rotRad);
        const xRot = x * c - y * s;
        const yRot = x * s + y * c;
        const u = system.centerU + xRot;
        const v = system.centerV + yRot;
        const zOff = system.centerZ + z;

        const speedR = range(cfg, 'speedUVPerSec', 0.02, 0.06);
        const dzR = range(cfg, 'depthSpeed', -0.015, 0.015);
        const ang = Math.random() * Math.PI * 2;
        const sp = randRange(speedR.min, speedR.max);

        const afA = oscRange(cfg, 'oscillateAlphaFreq', 1.0, 3.5);
        const afS = oscRange(cfg, 'oscillateScaleFreq', 0.6, 2.8);
        const ampA = oscRange(cfg, 'oscillateAlphaAmp', 0.05, 0.2);
        const scaleMultBounds = scaleOscMultiplierRange(cfg);

        const baseCol = new THREE.Color(
            typeof cfg.color === 'number' ? cfg.color : effectConfigHexToInt(cfg.color, 0xb8ff66)
        );
        const varAmt = num(cfg.colorVariance, 0.12);
        if (varAmt > 0) {
            baseCol.r = Math.max(0, Math.min(1, baseCol.r + randRange(-varAmt, varAmt)));
            baseCol.g = Math.max(0, Math.min(1, baseCol.g + randRange(-varAmt, varAmt)));
            baseCol.b = Math.max(0, Math.min(1, baseCol.b + randRange(-varAmt, varAmt)));
        }

        const scaleR = range(cfg, 'baseScale', 0.04, 0.1);
        const opR = range(cfg, 'opacity', 0.55, 1);
        const peakOpacity = randRange(opR.min, opR.max);

        const vu0 = Math.cos(ang) * sp;
        const vv0 = Math.sin(ang) * sp;
        const wfR = oscRange(cfg, 'velocityWanderFreq', 0.55, 2.0);
        const sofR = range(cfg, 'speedOscillationFreq', 0.32, 1.15);

        system.particles.push({
            u,
            v,
            zOff,
            vu: vu0,
            vv: vv0,
            vz: randRange(dzR.min, dzR.max),
            age: 0,
            lifetime: randRange(lifeR.min, lifeR.max),
            baseScale: randRange(scaleR.min, scaleR.max),
            peakOpacity,
            baseColor: baseCol,
            cruiseSpeedUV: sp,
            wanderPhase: Math.random() * Math.PI * 2,
            wanderFreq: randRange(wfR.min, wfR.max),
            speedOscPhase: Math.random() * Math.PI * 2,
            speedOscFreq: randRange(sofR.min, sofR.max),
            phaseA: Math.random() * Math.PI * 2,
            phaseS: Math.random() * Math.PI * 2,
            noiseSeed: Math.random() * 1000,
            oscFreqA: randRange(afA.min, afA.max),
            oscFreqS: randRange(afS.min, afS.max),
            oscAmpA: randRange(ampA.min, ampA.max),
            scaleMultMin: scaleMultBounds.min,
            scaleMultMax: scaleMultBounds.max,
            trailMotes: [],
            trailNextEmit: this.time + Math.random() * 0.06,
        });
    }

    _spawnTrailMote(p, cfg) {
        const radR = range(cfg, 'trailSpawnRadiusUV', 0.002, 0.016);
        const rDisk = randRange(radR.min, radR.max) * Math.sqrt(Math.random());
        const ang0 = Math.random() * Math.PI * 2;
        let dirU = Math.cos(ang0);
        let dirV = Math.sin(ang0);
        const baseMotBias = Math.max(0, Math.min(1, num(cfg.trailSpawnOppositeMotionBias, 0)));
        const speedCoupling = num(cfg.trailSpawnOppositeMotionSpeedCoupling, 0);
        const speedR = range(cfg, 'speedUVPerSec', 0.02, 0.06);
        const refSpeedUV = (speedR.min + speedR.max) * 0.5;
        const sp = Math.hypot(p.vu, p.vv);
        const speedRatio = refSpeedUV > 1e-8 ? sp / refSpeedUV : 0;
        let motBias = baseMotBias;
        if (baseMotBias > 0 || speedCoupling !== 0) {
            motBias = Math.max(0, Math.min(1, baseMotBias + speedCoupling * (speedRatio - 1)));
        }
        if (motBias > 0 && sp > 1e-8) {
            const bu = -p.vu / sp;
            const bv = -p.vv / sp;
            dirU = dirU * (1 - motBias) + bu * motBias;
            dirV = dirV * (1 - motBias) + bv * motBias;
            const dLen = Math.hypot(dirU, dirV);
            if (dLen > 1e-8) {
                dirU /= dLen;
                dirV /= dLen;
            }
        }
        const offU = dirU * rDisk;
        const offV = dirV * rDisk;

        const driftR = range(cfg, 'trailDriftUVPerSec', 0.004, 0.028);
        let du = offU;
        let dv = offV;
        let len = Math.hypot(du, dv);
        if (len < 1e-8) {
            const a = Math.random() * Math.PI * 2;
            du = Math.cos(a);
            dv = Math.sin(a);
            len = 1;
        }
        const mag = randRange(driftR.min, driftR.max);
        const driftU = (du / len) * mag;
        const driftV = (dv / len) * mag;

        const lifeR = range(cfg, 'trailLifetime', 0.22, 0.52);
        const opR = range(cfg, 'trailPeakOpacity', 0.2, 0.42);
        const scale0R = scalarOrRange(cfg, 'trailScaleStart', 0.22, 0.48);
        const scale1R = scalarOrRange(cfg, 'trailScaleEnd', 0.03, 0.1);
        let s0 = randRange(scale0R.min, scale0R.max);
        let s1 = randRange(scale1R.min, scale1R.max);
        if (s0 < s1) {
            const tmp = s0;
            s0 = s1;
            s1 = tmp;
        }

        const zdR = range(cfg, 'trailDepthDriftPerSec', -0.003, 0.003);

        p.trailMotes.push({
            age: 0,
            lifetime: Math.max(0.02, randRange(lifeR.min, lifeR.max)),
            peakOpacity: randRange(opR.min, opR.max),
            offU,
            offV,
            driftU,
            driftV,
            scale0: s0,
            scale1: s1,
            z0: randRange(-0.0012, 0.0012),
            zDrift: randRange(zdR.min, zdR.max),
        });
    }

    _integrateParticle(p, cfg, dt) {
        const turb = num(cfg.turbulence, 0.4);
        const scale = num(cfg.turbulenceScaleUV, 8);
        const damp = num(cfg.velocityDamping, 0.92);
        const t = this.time * 0.55 + p.noiseSeed;

        const nU =
            valueNoise3(p.u * scale, p.v * scale, t) - 0.5 +
            (valueNoise3(p.u * scale * 1.7 + 20, p.v * scale * 1.3, t * 1.1) - 0.5) * 0.5;
        const nV =
            valueNoise3(p.u * scale + 100, p.v * scale + 100, t * 0.9) - 0.5 +
            (valueNoise3(p.u * scale * 1.2 + 5, p.v * scale * 1.9 + 8, t * 1.05) - 0.5) * 0.5;
        const nZ =
            valueNoise3(p.u * scale * 0.8 + 200, p.v * scale * 0.8 + 200, t * 1.2) - 0.5;

        p.vu += nU * turb * dt * 3.2;
        p.vv += nV * turb * dt * 3.2;
        p.vz += nZ * turb * dt * 1.8;

        const wStr = num(cfg.velocityWanderStrength, 0);
        if (wStr > 0) {
            const spUv = Math.hypot(p.vu, p.vv);
            if (spUv > 1e-7) {
                const px = -p.vv / spUv;
                const py = p.vu / spUv;
                const steer = wStr * Math.sin(p.age * p.wanderFreq + p.wanderPhase);
                p.vu += px * steer * dt;
                p.vv += py * steer * dt;
            }
        }

        p.vu *= Math.pow(damp, dt * 60 * 0.016);
        p.vv *= Math.pow(damp, dt * 60 * 0.016);
        p.vz *= Math.pow(damp, dt * 60 * 0.016);

        const oscAmp = Math.max(0, num(cfg.speedOscillationAmp, 0));
        if (oscAmp > 0 && p.cruiseSpeedUV > 1e-8) {
            const curSp = Math.hypot(p.vu, p.vv);
            if (curSp > 1e-8) {
                const desired =
                    p.cruiseSpeedUV * (1 + oscAmp * Math.sin(p.age * p.speedOscFreq + p.speedOscPhase));
                const scl = Math.max(0.12, Math.min(2.8, desired / curSp));
                p.vu *= scl;
                p.vv *= scl;
            }
        }

        p.u += p.vu * dt;
        p.v += p.vv * dt;
        p.zOff += p.vz * dt;

        const zRange = range(cfg, 'depthRange', -0.03, 0.04);
        p.zOff = Math.max(zRange.min, Math.min(zRange.max, p.zOff));
    }

    _writeBillboard(mesh, u, v, zOff, extraAlongCam, scale, color, alphaMul, slotIndex) {
        const meshZ = this._fullConfig.meshZOffset;
        this.parallax?.getWorldPositionForUV(u, v, 0, _scratchPosition);
        _scratchCamDir.subVectors(this.camera.position, _scratchPosition);
        if (_scratchCamDir.lengthSq() < 1e-10) {
            _scratchCamDir.set(0, 0, 1);
        } else {
            _scratchCamDir.normalize();
        }
        _scratchPosition.addScaledVector(_scratchCamDir, zOff + meshZ + extraAlongCam);

        if (this.parallax?.getParallaxDisplacementForUV) {
            this.parallax.getParallaxDisplacementForUV(u, v, _scratchDisp);
            _scratchPosition.x += _scratchDisp.x;
            _scratchPosition.y += _scratchDisp.y;
        }

        _scratchColor.copy(color).multiplyScalar(Math.max(0, Math.min(2.5, alphaMul)));
        mesh.setColorAt(slotIndex, _scratchColor);

        _scratchScale.set(scale, scale, 1);
        _scratchMatrix.compose(_scratchPosition, _billboardQuat, _scratchScale);
        mesh.setMatrixAt(slotIndex, _scratchMatrix);
    }

    getBlendMode(blendModeString) {
        const blendModes = {
            NoBlending: THREE.NoBlending,
            NormalBlending: THREE.NormalBlending,
            AdditiveBlending: THREE.AdditiveBlending,
            SubtractiveBlending: THREE.SubtractiveBlending,
            MultiplyBlending: THREE.MultiplyBlending,
            CustomBlending: THREE.CustomBlending,
        };
        return blendModes[blendModeString] || THREE.AdditiveBlending;
    }

    updatePositionsForMeshTransform() {}

    cleanup() {
        if (this._clusterSystems) {
            this._clusterSystems.forEach((s) => {
                s.particles.length = 0;
            });
            this._clusterSystems = [];
        }

        if (this._trailInstancedMesh) {
            this.scene.remove(this._trailInstancedMesh);
            this._trailInstancedMesh.geometry?.dispose();
            this._trailInstancedMesh.material?.dispose();
            let mi = this.meshes.indexOf(this._trailInstancedMesh);
            if (mi >= 0) this.meshes.splice(mi, 1);
            let mai = this.materials.indexOf(this._trailInstancedMesh.material);
            if (mai >= 0) this.materials.splice(mai, 1);
            let tix = this.textures.indexOf(this._trailTexture);
            if (tix >= 0) this.textures.splice(tix, 1);
            this._trailInstancedMesh = null;
        }

        if (this._instancedMesh) {
            this.scene.remove(this._instancedMesh);
            this._instancedMesh.geometry?.dispose();
            this._instancedMesh.material?.dispose();
            const mi = this.meshes.indexOf(this._instancedMesh);
            if (mi >= 0) this.meshes.splice(mi, 1);
            const mai = this.materials.indexOf(this._instancedMesh.material);
            if (mai >= 0) this.materials.splice(mai, 1);
            const ti = this.textures.indexOf(this._spriteTexture);
            if (ti >= 0) this.textures.splice(ti, 1);
            this._instancedMesh = null;
        }

        if (typeof this._unsubSpritesChange === 'function') {
            this._unsubSpritesChange();
            this._unsubSpritesChange = null;
        }

        this.time = 0;
        super.cleanup();

        if (this._spriteTexture) {
            this.textures.push(this._spriteTexture);
        }
        if (this._trailTexture) {
            this.textures.push(this._trailTexture);
        }
    }
}

export default SpritesEffect;
