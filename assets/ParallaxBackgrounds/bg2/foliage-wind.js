// Foliage Wind Effect - Area effect for bg2: ambient wind + interactive rustle on masked foliage
// Uses grayscale mask for per-pixel wind influence, wind envelope for natural blow/calm cycles,
// and back-and-forth mouse/touch tracking for interactive rustling with falling leaves.

import BaseEffect, {
    GLSL_AREA_PASS_UV_BOUNDS_DISCARD_AND_LINE,
    GLSL_AREA_PASS_UV_BOUNDS_UNIFORMS,
    mergeAreaPassUvBoundsUniforms,
    syncAreaPassUvBoundsUniforms,
    PARALLAX_COARSE_OVERLAY_Z
} from '../../../js/base-effect.js';
import FoliageParticleEmitter from './foliage-particle-emitter.js';
import * as THREE from 'https://unpkg.com/three@0.172.0/build/three.module.js';

const log = (...args) => {
    if (window.location.pathname.endsWith('test-effects.html')) {
        console.log(...args);
    }
};

const MAX_RUSTLE_INSTANCES = 6;

const FRAGMENT_SHADER = `
    uniform sampler2D map;
    uniform sampler2D maskMap;
    uniform float time;
    uniform float windStrength;
    uniform float windSpeed;
    uniform float primaryScale;
    uniform float secondaryScale;
    uniform float gustStrength;
    uniform float gustScale;
    uniform float shimmerStrength;
    uniform float influenceCurve;
    uniform float minInfluence;
    uniform float sharpness;
    uniform vec2 texelSize;
${GLSL_AREA_PASS_UV_BOUNDS_UNIFORMS}
    uniform float windEnvelope;
    uniform vec2 windDirection;

    // Rustle interaction (per-slot for WebGL 1)
    uniform float rustleEnabled;
    uniform float rustleStrength;
    uniform float rustleRadius;
    uniform int rustleInstanceCount;
    uniform vec2 rustlePos0;
    uniform vec2 rustlePos1;
    uniform vec2 rustlePos2;
    uniform vec2 rustlePos3;
    uniform vec2 rustlePos4;
    uniform vec2 rustlePos5;
    uniform vec2 rustleVel0;
    uniform vec2 rustleVel1;
    uniform vec2 rustleVel2;
    uniform vec2 rustleVel3;
    uniform vec2 rustleVel4;
    uniform vec2 rustleVel5;
    uniform float rustleIntensity0;
    uniform float rustleIntensity1;
    uniform float rustleIntensity2;
    uniform float rustleIntensity3;
    uniform float rustleIntensity4;
    uniform float rustleIntensity5;
    uniform float rustleAlpha0;
    uniform float rustleAlpha1;
    uniform float rustleAlpha2;
    uniform float rustleAlpha3;
    uniform float rustleAlpha4;
    uniform float rustleAlpha5;

    varying vec2 vUv;

    // Returns vec3(displaceX, displaceY, weight) - weight used to suppress ambient
    // vel carries branch sway state, not raw mouse velocity.
    vec3 rustleContrib(vec2 pos, vec2 vel, float intensity, float alpha) {
        if (alpha <= 0.001 || intensity <= 0.001) return vec3(0.0);
        vec2 toFrag = vUv - pos;
        float dist = length(toFrag);
        if (dist >= rustleRadius || dist < 0.0002) return vec3(0.0);

        float normDist = dist / rustleRadius;
        float falloff = exp(-4.0 * normDist * normDist);

        float swayMag = length(vel);
        if (swayMag < 0.0002) return vec3(0.0, 0.0, falloff * intensity * alpha);
        vec2 pushDir = vel / swayMag;
        float swayAmount = smoothstep(0.0, 0.06, swayMag);

        float w = falloff * intensity * alpha;
        vec2 disp = pushDir * swayAmount * w * rustleStrength;
        return vec3(disp, w);
    }

    void main() {
${GLSL_AREA_PASS_UV_BOUNDS_DISCARD_AND_LINE}
        float maskValue = texture2D(maskMap, vUv).r;
        if (maskValue <= 0.001) {
            if (passLine * uPassBoundsHiStrength < 0.012) discard;
            gl_FragColor = vec4(uPassBoundsHiColor * passLine * uPassBoundsHiStrength, 1.0);
            return;
        }

        float normalized = clamp((maskValue - minInfluence) / max(0.0001, 1.0 - minInfluence), 0.0, 1.0);
        float influence = pow(normalized, max(0.01, influenceCurve));
        if (influence <= 0.001) {
            if (passLine * uPassBoundsHiStrength < 0.012) discard;
            gl_FragColor = vec4(uPassBoundsHiColor * passLine * uPassBoundsHiStrength, 1.0);
            return;
        }

        // Ambient wind
        float env = windEnvelope;
        float effectiveStrength = windStrength * env;
        float effectiveGust = gustStrength * env;

        float t = time * windSpeed;
        float phaseA = sin((vUv.y * primaryScale + t) * 6.2831853);
        float phaseB = sin((vUv.x * secondaryScale - t * 0.73) * 6.2831853 + phaseA * 0.45);
        float gustA = sin(((vUv.x + vUv.y) * gustScale + t * 1.7) * 6.2831853);
        float gustB = sin((vUv.x * (gustScale * 0.7) - vUv.y * (gustScale * 1.3) + t * 1.1) * 6.2831853);

        float waveMag = (phaseA * 0.65 + phaseB * 0.35) * effectiveStrength
                      + (gustA * 0.6 + gustB * 0.4) * effectiveGust;
        float wavePerp = phaseB * effectiveStrength * 0.45
                       + gustB * effectiveGust * 0.35;

        vec2 dir = normalize(windDirection + vec2(0.0001));
        vec2 perp = vec2(-dir.y, dir.x);
        vec2 ambientDrift = dir * waveMag + perp * wavePerp;

        // Rustle interaction — accumulate displacement + weight
        vec2 rustleDrift = vec2(0.0);
        float rustleWeight = 0.0;
        if (rustleEnabled > 0.5 && rustleInstanceCount > 0) {
            vec3 r;
            if (rustleInstanceCount > 0) { r = rustleContrib(rustlePos0, rustleVel0, rustleIntensity0, rustleAlpha0); rustleDrift += r.xy; rustleWeight = max(rustleWeight, r.z); }
            if (rustleInstanceCount > 1) { r = rustleContrib(rustlePos1, rustleVel1, rustleIntensity1, rustleAlpha1); rustleDrift += r.xy; rustleWeight = max(rustleWeight, r.z); }
            if (rustleInstanceCount > 2) { r = rustleContrib(rustlePos2, rustleVel2, rustleIntensity2, rustleAlpha2); rustleDrift += r.xy; rustleWeight = max(rustleWeight, r.z); }
            if (rustleInstanceCount > 3) { r = rustleContrib(rustlePos3, rustleVel3, rustleIntensity3, rustleAlpha3); rustleDrift += r.xy; rustleWeight = max(rustleWeight, r.z); }
            if (rustleInstanceCount > 4) { r = rustleContrib(rustlePos4, rustleVel4, rustleIntensity4, rustleAlpha4); rustleDrift += r.xy; rustleWeight = max(rustleWeight, r.z); }
            if (rustleInstanceCount > 5) { r = rustleContrib(rustlePos5, rustleVel5, rustleIntensity5, rustleAlpha5); rustleDrift += r.xy; rustleWeight = max(rustleWeight, r.z); }
        }

        // Suppress ambient wind where rustle is active; as rustle fades, ambient returns
        float ambientFade = 1.0 - clamp(rustleWeight, 0.0, 1.0);
        vec2 totalDrift = ambientDrift * ambientFade + rustleDrift;
        vec2 displacedUv = clamp(vUv + totalDrift * influence, vec2(0.0), vec2(1.0));
        vec4 baseColor = texture2D(map, vUv);
        vec4 displacedColor = texture2D(map, displacedUv);

        vec3 blur = (
            texture2D(map, clamp(displacedUv + vec2(texelSize.x, 0.0), vec2(0.0), vec2(1.0))).rgb +
            texture2D(map, clamp(displacedUv - vec2(texelSize.x, 0.0), vec2(0.0), vec2(1.0))).rgb +
            texture2D(map, clamp(displacedUv + vec2(0.0, texelSize.y), vec2(0.0), vec2(1.0))).rgb +
            texture2D(map, clamp(displacedUv - vec2(0.0, texelSize.y), vec2(0.0), vec2(1.0))).rgb
        ) * 0.25;
        float baseLuma = dot(displacedColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        float highlightLimiter = 1.0 - smoothstep(0.65, 1.0, baseLuma);
        float effectiveSharpness = sharpness * (0.4 + 0.6 * highlightLimiter);
        vec3 detail = displacedColor.rgb - blur;
        float detailLuma = dot(detail, vec3(0.2126, 0.7152, 0.0722));
        detailLuma = clamp(detailLuma, -0.08, 0.08);
        vec3 sharpened = clamp(displacedColor.rgb + vec3(detailLuma * effectiveSharpness), 0.0, 1.0);

        float shimmer = sin((vUv.x * 18.0 + vUv.y * 11.0 + t * 2.2) * 6.2831853);
        float blendAmount = influence;
        vec3 mixedColor = mix(baseColor.rgb, sharpened, blendAmount);
        vec3 color = mixedColor * (1.0 + shimmer * shimmerStrength * influence * env);
        color = min(color + uPassBoundsHiColor * passLine * uPassBoundsHiStrength, vec3(1.0));

        gl_FragColor = vec4(color, 1.0);
    }
`;

// Wind envelope states
const WIND_STATE = { BLOWING: 0, CALMING: 1, CALM: 2, RISING: 3 };

function randRange(min, max) {
    return min + Math.random() * (max - min);
}

function smoothstepJS(t) {
    t = Math.max(0, Math.min(1, t));
    return t * t * (3 - 2 * t);
}

class FoliageWindEffect extends BaseEffect {
    constructor(scene, camera, renderer, parallaxInstance) {
        super(scene, camera, renderer, parallaxInstance);
        this.effectType = 'area';
        this.overlayMesh = null;
        this.uniforms = null;
        this.time = 0;
        this.maskTexture = null;
        this._cachedConfig = null;
        this._cachedConfigFrame = -1;
        this._frameCounter = 0;

        // Envelope state machine
        this._envState = WIND_STATE.BLOWING;
        this._envValue = 1.0;
        this._envTimer = 0;
        this._envDuration = 5.0;
        this._envFrom = 1.0;
        this._envTo = 1.0;

        // Speed variation
        this._baseWindSpeed = 0.25;
        this._speedJitter = 0;
        this._speedJitterTarget = 0;
        this._speedJitterTimer = 0;

        // Rustle interaction state
        this.rustleInstances = [];
        this.maxRustleInstances = MAX_RUSTLE_INSTANCES;
        this.rustleIntensity = 0;
        this._lastMouseUV = new THREE.Vector2(-1, -1);
        this._lastVelocity = new THREE.Vector2(0, 0);
        this._effectiveVelocity = new THREE.Vector2(0, 0);
        this._lastUVWasOverFoliage = false;
        this._velocityBuffer = [];
        this._velocityBufferSize = 5;
        this._directionReversals = 0;
        this._reversalDecayTimer = 0;
        this._lastEmitTime = 0;
        this._ambientLeafTimer = 0;

        // Raycaster for mouse-to-UV
        this._raycaster = new THREE.Raycaster();
        this._mouse = new THREE.Vector2();
        this._mousePixelX = 0;
        this._mousePixelY = 0;
        this._isTouching = false;
        this._cachedRect = null;
        this._cachedRectFrame = -1;

        // Mask sampler for hit-testing
        this.maskSampler = null;

        // Particle emitter
        this.particleEmitter = null;

        // Uniform name lists (avoid per-frame string creation)
        this._rustlePosList = [];
        this._rustleVelList = [];
        this._rustleIntensityList = [];
        this._rustleAlphaList = [];
        for (let i = 0; i < MAX_RUSTLE_INSTANCES; i++) {
            this._rustlePosList.push(`rustlePos${i}`);
            this._rustleVelList.push(`rustleVel${i}`);
            this._rustleIntensityList.push(`rustleIntensity${i}`);
            this._rustleAlphaList.push(`rustleAlpha${i}`);
        }

        this._foliageSpawnWorldScratch = new THREE.Vector3();
        this._foliageSpawnDispScratch = new THREE.Vector2();
    }

    /**
     * World position on the parallax mesh at mask UV (u,v), including the same XY parallax
     * displacement as the main mesh vertex shader (matches lanterns / point effects).
     */
    _worldPositionForFoliageUV(u, v) {
        if (!this.parallax?.getWorldPositionForUV || !this.parallax?.getParallaxDisplacementForUV) {
            return null;
        }
        const out = this._foliageSpawnWorldScratch;
        this.parallax.getWorldPositionForUV(u, v, 0, out);
        this.parallax.getParallaxDisplacementForUV(u, v, this._foliageSpawnDispScratch);
        out.x += this._foliageSpawnDispScratch.x;
        out.y += this._foliageSpawnDispScratch.y;
        return out;
    }

    getConfig() {
        if (this._cachedConfigFrame === this._frameCounter) return this._cachedConfig;
        this._cachedConfig = this.parallax?.config?.effects?.foliageWind || {};
        this._cachedConfigFrame = this._frameCounter;
        return this._cachedConfig;
    }

    _getCanvasRect() {
        if (this._cachedRectFrame === this._frameCounter) return this._cachedRect;
        if (this.parallax?.canvas) {
            this._cachedRect = this.parallax.canvas.getBoundingClientRect();
        }
        this._cachedRectFrame = this._frameCounter;
        return this._cachedRect;
    }

    _invalidateRectCache() { this._cachedRectFrame = -1; }

    _getEnvelopeConfig() {
        const config = this.getConfig();
        const env = config.envelope || {};
        return {
            blowMin: env.blowDuration?.[0] ?? 3,
            blowMax: env.blowDuration?.[1] ?? 8,
            calmMin: env.calmDuration?.[0] ?? 0.5,
            calmMax: env.calmDuration?.[1] ?? 2.5,
            riseMin: env.transitionDuration?.[0] ?? 0.8,
            riseMax: env.transitionDuration?.[1] ?? 2.5,
            calmDipMin: env.calmDip?.[0] ?? 0.0,
            calmDipMax: env.calmDip?.[1] ?? 0.15,
            speedVariation: env.speedVariation ?? 0.15
        };
    }

    _initEnvelopeState(state) {
        const ec = this._getEnvelopeConfig();
        this._envState = state;
        this._envTimer = 0;
        this._envFrom = this._envValue;

        switch (state) {
            case WIND_STATE.BLOWING:
                this._envTo = 1.0;
                this._envDuration = randRange(ec.blowMin, ec.blowMax);
                break;
            case WIND_STATE.CALMING:
                this._envTo = randRange(ec.calmDipMin, ec.calmDipMax);
                this._envDuration = randRange(ec.riseMin, ec.riseMax);
                break;
            case WIND_STATE.CALM:
                this._envTo = this._envValue;
                this._envDuration = randRange(ec.calmMin, ec.calmMax);
                break;
            case WIND_STATE.RISING:
                this._envTo = 1.0;
                this._envDuration = randRange(ec.riseMin, ec.riseMax);
                break;
        }
    }

    _updateEnvelope(dt) {
        this._envTimer += dt;
        const progress = Math.min(1, this._envTimer / Math.max(0.01, this._envDuration));

        switch (this._envState) {
            case WIND_STATE.BLOWING:
                this._envValue = 1.0;
                if (progress >= 1) this._initEnvelopeState(WIND_STATE.CALMING);
                break;
            case WIND_STATE.CALMING:
                this._envValue = this._envFrom + (this._envTo - this._envFrom) * smoothstepJS(progress);
                if (progress >= 1) this._initEnvelopeState(WIND_STATE.CALM);
                break;
            case WIND_STATE.CALM:
                if (progress >= 1) this._initEnvelopeState(WIND_STATE.RISING);
                break;
            case WIND_STATE.RISING:
                this._envValue = this._envFrom + (this._envTo - this._envFrom) * smoothstepJS(progress);
                if (progress >= 1) this._initEnvelopeState(WIND_STATE.BLOWING);
                break;
        }
    }

    _updateSpeedVariation(dt) {
        const ec = this._getEnvelopeConfig();
        this._speedJitterTimer -= dt;
        if (this._speedJitterTimer <= 0) {
            this._speedJitterTarget = (Math.random() * 2 - 1) * ec.speedVariation;
            this._speedJitterTimer = randRange(0.4, 1.8);
        }
        this._speedJitter += (this._speedJitterTarget - this._speedJitter) * Math.min(1, dt * 3);
    }

    // --- Mask sampler ---
    _buildMaskSampler(maskTexture) {
        const img = maskTexture?.image;
        if (!img) return null;
        const w = img.width || img.naturalWidth;
        const h = img.height || img.naturalHeight;
        if (!w || !h) return null;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.drawImage(img, 0, 0);
        try {
            return { width: w, height: h, data: ctx.getImageData(0, 0, w, h).data };
        } catch (e) {
            return null;
        }
    }

    _isUVOverFoliage(u, v) {
        if (!this.maskSampler?.data) return false;
        const { width, height, data } = this.maskSampler;
        const x = Math.floor(Math.max(0, Math.min(1, u)) * (width - 1));
        const y = Math.floor((1 - Math.max(0, Math.min(1, v))) * (height - 1));
        return data[(y * width + x) * 4] / 255 > 0.01;
    }

    _getRandomFoliageSpawn(maxAttempts = 32) {
        if (!this.maskSampler?.data) return null;

        for (let i = 0; i < maxAttempts; i++) {
            const u = Math.random();
            const v = Math.random();
            if (!this._isUVOverFoliage(u, v)) continue;
            const w = this._worldPositionForFoliageUV(u, v);
            if (w) return { worldPos: w.clone(), uv: new THREE.Vector2(u, v) };
        }
        return null;
    }

    _getAmbientPeakDriftMagnitude() {
        // Peak amplitude from configured strengths at full envelope (env = 1).
        const config = this.getConfig();
        const windStrength = Math.max(0, config.windStrength ?? 0.0025);
        const gustStrength = Math.max(0, config.gustStrength ?? 0.001);
        const maxWaveMag = windStrength + gustStrength;
        const maxWavePerp = windStrength * 0.45 + gustStrength * 0.35;
        return Math.max(1e-6, Math.hypot(maxWaveMag, maxWavePerp));
    }

    _getAmbientDriftAtUV(uv) {
        // Match shader-side ambient field so ambient leaves follow foliage motion.
        const config = this.getConfig();
        const t = this.time * (this.uniforms?.windSpeed?.value ?? config.windSpeed ?? 0.25);
        const primaryScale = config.primaryScale ?? 1.5;
        const secondaryScale = config.secondaryScale ?? 6.0;
        const gustScale = config.gustScale ?? 1.8;
        const windStrength = (config.windStrength ?? 0.0025) * this._envValue;
        const gustStrength = (config.gustStrength ?? 0.001) * this._envValue;

        const phaseA = Math.sin((uv.y * primaryScale + t) * 6.2831853);
        const phaseB = Math.sin((uv.x * secondaryScale - t * 0.73) * 6.2831853 + phaseA * 0.45);
        const gustA = Math.sin(((uv.x + uv.y) * gustScale + t * 1.7) * 6.2831853);
        const gustB = Math.sin((uv.x * (gustScale * 0.7) - uv.y * (gustScale * 1.3) + t * 1.1) * 6.2831853);

        const waveMag = (phaseA * 0.65 + phaseB * 0.35) * windStrength
                      + (gustA * 0.6 + gustB * 0.4) * gustStrength;
        const wavePerp = phaseB * windStrength * 0.45
                       + gustB * gustStrength * 0.35;

        const dir = this.uniforms?.windDirection?.value?.clone() || new THREE.Vector2(1, 0);
        if (dir.lengthSq() < 1e-6) dir.set(1, 0);
        dir.normalize();
        const perp = new THREE.Vector2(-dir.y, dir.x);

        return dir.multiplyScalar(waveMag).add(perp.multiplyScalar(wavePerp));
    }

    _updateAmbientLeafFall(dt, config) {
        if (!this.particleEmitter) return;

        const leafConfig = config.leafParticles || {};
        if (leafConfig.enabled === false) return;

        const ambient = leafConfig.ambientWind || {};
        if (ambient.enabled === false) return;

        const spawnVerticalBias = typeof ambient.spawnVerticalBias === 'number' && Number.isFinite(ambient.spawnVerticalBias)
            ? ambient.spawnVerticalBias
            : 0;

        const localThreshold = Math.max(0, Math.min(1, ambient.minWindEnvelope ?? 0.82));
        const peakDrift = this._getAmbientPeakDriftMagnitude();

        this._ambientLeafTimer -= dt;
        if (this._ambientLeafTimer > 0) return;

        const intervalMin = ambient.spawnInterval?.[0] ?? 0.7;
        const intervalMax = ambient.spawnInterval?.[1] ?? 1.8;
        this._ambientLeafTimer = randRange(intervalMin, intervalMax);

        // Pick a random foliage point where local ambient drift exceeds threshold.
        let chosenWorldPos = null;
        let chosenWindDir = null;
        const attempts = Math.max(1, ambient.emitAttempts ?? 40);
        if (!this.parallax?.getWorldPositionForUV || !this.parallax?.getParallaxDisplacementForUV) {
            return;
        }

        for (let i = 0; i < attempts; i++) {
            const u = Math.random();
            const v = Math.random();
            if (!this._isUVOverFoliage(u, v)) continue;

            const uv = new THREE.Vector2(u, v);
            const drift = this._getAmbientDriftAtUV(uv);
            const localRatio = drift.length() / peakDrift;
            if (localRatio < localThreshold) continue;

            const worldPosUv = this._worldPositionForFoliageUV(u, v);
            if (!worldPosUv) continue;

            let windDir = drift.clone();
            if (windDir.lengthSq() < 1e-8) {
                const dir = this.uniforms?.windDirection?.value || new THREE.Vector2(1, 0);
                windDir = dir.clone();
            }
            windDir.normalize();

            chosenWorldPos = worldPosUv.clone();
            chosenWindDir = windDir;
            break;
        }

        if (!chosenWorldPos || !chosenWindDir) return;
        chosenWorldPos.y += spawnVerticalBias;
        chosenWorldPos.z += 0.02;

        this.particleEmitter.emitLeaves(chosenWorldPos, {
            countMin: ambient.countMin ?? 1,
            countMax: ambient.countMax ?? 1,
            scaleMin: leafConfig.scaleMin ?? 0.02,
            scaleMax: leafConfig.scaleMax ?? 0.06,
            lifetimeMin: leafConfig.lifetimeMin ?? 2.0,
            lifetimeMax: leafConfig.lifetimeMax ?? 4.5,
            fallSpeedMin: leafConfig.fallSpeedMin ?? 0.15,
            fallSpeedMax: leafConfig.fallSpeedMax ?? 0.4,
            driftSpeed: leafConfig.driftSpeed ?? 0.08,
            swayAmpMin: leafConfig.swayAmpMin ?? 0.05,
            swayAmpMax: leafConfig.swayAmpMax ?? 0.2,
            swayFreqMin: leafConfig.swayFreqMin ?? 1.5,
            swayFreqMax: leafConfig.swayFreqMax ?? 3.5,
            spinMin: leafConfig.spinMin ?? 1.0,
            spinMax: leafConfig.spinMax ?? 4.0,
            opacity: (ambient.opacityMultiplier ?? 0.9) * (leafConfig.opacity ?? 0.9),
            ejectSpeed: ambient.ejectSpeed ?? 0.08,
            windDirection: chosenWindDir,
            windPush: ambient.windPush ?? 0.04,
            windDriftZ: ambient.windDriftZ ?? 0.12
        });
    }

    // --- Mouse tracking ---
    _setupMouseTracking() {
        if (!this.parallax?.canvas) return;
        const canvas = this.parallax.canvas;

        if (this._mouseMoveHandler) canvas.removeEventListener('mousemove', this._mouseMoveHandler);
        if (this._touchStartHandler) canvas.removeEventListener('touchstart', this._touchStartHandler);
        if (this._touchMoveHandler) canvas.removeEventListener('touchmove', this._touchMoveHandler);
        if (this._touchEndHandler) {
            canvas.removeEventListener('touchend', this._touchEndHandler);
            canvas.removeEventListener('touchcancel', this._touchEndHandler);
        }
        if (this._resizeHandler) window.removeEventListener('resize', this._resizeHandler);
        if (this._scrollHandler) window.removeEventListener('scroll', this._scrollHandler);

        this._mouseMoveHandler = (e) => {
            const rect = this._getCanvasRect();
            if (!rect) return;
            this._mousePixelX = e.clientX - rect.left;
            this._mousePixelY = e.clientY - rect.top;
            this._isTouching = false;
        };

        this._touchStartHandler = (e) => {
            if (e.touches.length > 0) {
                this._touchStartY = e.touches[0].clientY;
            }
        };

        this._touchMoveHandler = (e) => {
            // Allow pinch-to-zoom (2+ fingers) and pull-to-refresh (touch started in top zone)
            const allowBrowserGesture =
                e.touches.length >= 2 ||
                (this._touchStartY != null && this._touchStartY < Math.min(150, window.innerHeight * 0.2));
            if (!allowBrowserGesture) {
                e.preventDefault();
            }
            if (e.touches.length > 0) {
                const rect = this._getCanvasRect();
                if (!rect) return;
                this._mousePixelX = e.touches[0].clientX - rect.left;
                this._mousePixelY = e.touches[0].clientY - rect.top;
                this._isTouching = true;
            }
        };

        this._touchEndHandler = (e) => {
            this._isTouching = false;
            if (e.touches.length === 0) {
                this._touchStartY = null;
            }
        };
        this._resizeHandler = () => this._invalidateRectCache();
        this._scrollHandler = () => this._invalidateRectCache();

        canvas.addEventListener('mousemove', this._mouseMoveHandler);
        canvas.addEventListener('touchstart', this._touchStartHandler, { passive: true });
        canvas.addEventListener('touchmove', this._touchMoveHandler, { passive: false });
        canvas.addEventListener('touchend', this._touchEndHandler);
        canvas.addEventListener('touchcancel', this._touchEndHandler);
        window.addEventListener('resize', this._resizeHandler);
        window.addEventListener('scroll', this._scrollHandler, { passive: true });
    }

    _getMouseUV() {
        if (!this.parallax?.canvas || !this.overlayMesh) return null;
        const rect = this._getCanvasRect();
        if (!rect) return null;
        this._mouse.x = ((this._mousePixelX / rect.width) * 2) - 1;
        this._mouse.y = -((this._mousePixelY / rect.height) * 2) + 1;
        this._raycaster.setFromCamera(this._mouse, this.camera);
        const hits = this._raycaster.intersectObject(this.overlayMesh);
        if (hits.length > 0 && hits[0].uv) return hits[0].uv.clone();
        return null;
    }

    _getWorldPosAtPixel(px, py) {
        if (!this.parallax?.canvas || !this.overlayMesh) return null;
        const rect = this._getCanvasRect();
        if (!rect) return null;
        this._mouse.x = ((px / rect.width) * 2) - 1;
        this._mouse.y = -((py / rect.height) * 2) + 1;
        this._raycaster.setFromCamera(this._mouse, this.camera);
        const hits = this._raycaster.intersectObject(this.overlayMesh);
        if (hits.length > 0) return hits[0].point.clone();
        return null;
    }

    // --- Rustle interaction ---
    _updateRustleInteraction(dt) {
        if (!this.uniforms || !this.parallax || !this.overlayMesh) return;

        const rustleFlag = this.parallax.getFlag('effects.foliage-wind.rustleInteraction');
        const rustleConfig = this.getConfig().rustleInteraction || {};
        const shouldBeEnabled = rustleFlag && rustleConfig.enabled !== false;

        this.uniforms.rustleEnabled.value = shouldBeEnabled ? 1.0 : 0.0;
        if (!shouldBeEnabled) {
            this.rustleInstances = [];
            this.rustleIntensity = 0;
            this._directionReversals = 0;
            this._lastVelocity.set(0, 0);
            this._lastMouseUV.set(-1, -1);
            this._lastUVWasOverFoliage = false;
            this._updateRustleUniforms();
            return;
        }

        const velThreshold = rustleConfig.velocityThreshold ?? 0.5;
        const reversalThreshold = Math.max(1, rustleConfig.reversalThreshold ?? 2);
        const maxInputVelocity = Math.max(0.05, rustleConfig.maxInputVelocity ?? 4.0);
        const minInputVelocity = Math.min(
            maxInputVelocity,
            Math.max(velThreshold, rustleConfig.minInputVelocity ?? velThreshold)
        );

        const inputActive = this.parallax.mouseOnScreen || this._isTouching;
        let currentUV = null;
        let isOverFoliage = false;
        let hasValidMouseUV = false;
        const currentVelocity = new THREE.Vector2(0, 0);

        if (inputActive) {
            const mouseUV = this._getMouseUV();
            if (mouseUV && mouseUV.x >= 0 && mouseUV.x <= 1 && mouseUV.y >= 0 && mouseUV.y <= 1) {
                hasValidMouseUV = true;
                if (this._isUVOverFoliage(mouseUV.x, mouseUV.y)) {
                    isOverFoliage = true;
                    currentUV = mouseUV;
                }

                // Use delta UV over time and cap velocity spikes from edge re-entry.
                if (this._lastMouseUV.x >= 0) {
                    const dx = mouseUV.x - this._lastMouseUV.x;
                    const dy = mouseUV.y - this._lastMouseUV.y;
                    const velocityScale = 1.0 / Math.max(dt, 0.001);
                    currentVelocity.set(dx * velocityScale, dy * velocityScale);
                    currentVelocity.clampLength(0, maxInputVelocity);
                }
                this._lastMouseUV.copy(mouseUV);
            } else {
                // If raycast UV is invalid (often at edges), reset continuity state.
                this._lastMouseUV.set(-1, -1);
                this._lastVelocity.set(0, 0);
                this._lastUVWasOverFoliage = false;
            }
        } else {
            this._lastMouseUV.set(-1, -1);
            this._lastVelocity.set(0, 0);
            this._lastUVWasOverFoliage = false;
        }

        const speed = currentVelocity.length();
        let effectiveSpeed = speed;
        this._effectiveVelocity.set(0, 0);
        if (speed > 0.0001) {
            effectiveSpeed = Math.min(maxInputVelocity, Math.max(speed, minInputVelocity));
            this._effectiveVelocity.copy(currentVelocity).multiplyScalar(effectiveSpeed / speed);
        }

        // Count reversals only while continuously over foliage to avoid edge flicker noise.
        const canCountReversal = hasValidMouseUV && isOverFoliage && this._lastUVWasOverFoliage;
        if (canCountReversal && speed > velThreshold && this._lastVelocity.lengthSq() > 0.0001) {
            const dot = currentVelocity.dot(this._lastVelocity) / (speed * this._lastVelocity.length());
            if (dot < -(rustleConfig.reversalDotThreshold ?? 0.3)) {
                this._directionReversals += 1;
            }
        }
        if (hasValidMouseUV && isOverFoliage && speed > velThreshold) {
            this._lastVelocity.copy(currentVelocity);
        } else if (!isOverFoliage) {
            this._lastVelocity.set(0, 0);
        }

        // Decay reversals over time
        const decayRate = rustleConfig.decayRate ?? 3.0;
        this._reversalDecayTimer += dt;
        if (this._reversalDecayTimer > 0.1) {
            this._directionReversals = Math.max(0, this._directionReversals - decayRate * this._reversalDecayTimer);
            this._reversalDecayTimer = 0;
        }

        // Decay intensity continuously
        this.rustleIntensity = Math.max(0, this.rustleIntensity - (rustleConfig.intensityDecay ?? 2.0) * dt);

        // --- Apply rustle only when over foliage AND reversals are sufficient ---
        const rustleActive = this._directionReversals >= reversalThreshold;
        if (isOverFoliage && currentUV && rustleActive && speed > velThreshold) {
            const intensityGain = effectiveSpeed * (rustleConfig.intensityGain ?? 1.5);
            this.rustleIntensity = Math.min(
                rustleConfig.maxIntensity ?? 1.0,
                this.rustleIntensity + intensityGain * dt
            );

            this._spawnOrUpdateRustle(currentUV, this.rustleIntensity, this._effectiveVelocity);

            const leafThreshold = rustleConfig.leafThreshold ?? 0.3;
            if (this.rustleIntensity >= leafThreshold && this.particleEmitter) {
                const leafConfig = this.getConfig().leafParticles || {};
                const spawnInterval = leafConfig.spawnInterval ?? 0.15;
                if (this.time - this._lastEmitTime >= spawnInterval) {
                    this._lastEmitTime = this.time;
                    const worldPos = this._getWorldPosAtPixel(this._mousePixelX, this._mousePixelY);
                    if (worldPos) {
                        worldPos.z += 0.02;
                        const maxI = rustleConfig.maxIntensity ?? 1.0;
                        const intensityFactor = (this.rustleIntensity - leafThreshold) / Math.max(0.01, maxI - leafThreshold);
                        this.particleEmitter.emitLeaves(worldPos, {
                            countMin: leafConfig.countMin ?? 1,
                            countMax: Math.round((leafConfig.countMax ?? 3) * (0.5 + intensityFactor * 0.5)),
                            scaleMin: leafConfig.scaleMin ?? 0.02,
                            scaleMax: leafConfig.scaleMax ?? 0.06,
                            lifetimeMin: leafConfig.lifetimeMin ?? 2.0,
                            lifetimeMax: leafConfig.lifetimeMax ?? 4.5,
                            fallSpeedMin: leafConfig.fallSpeedMin ?? 0.15,
                            fallSpeedMax: leafConfig.fallSpeedMax ?? 0.4,
                            driftSpeed: leafConfig.driftSpeed ?? 0.08,
                            swayAmpMin: leafConfig.swayAmpMin ?? 0.05,
                            swayAmpMax: leafConfig.swayAmpMax ?? 0.2,
                            swayFreqMin: leafConfig.swayFreqMin ?? 1.5,
                            swayFreqMax: leafConfig.swayFreqMax ?? 3.5,
                            spinMin: leafConfig.spinMin ?? 1.0,
                            spinMax: leafConfig.spinMax ?? 4.0,
                            opacity: leafConfig.opacity ?? 0.9,
                            ejectSpeed: leafConfig.ejectSpeed ?? 0.3
                        });
                    }
                }
            }
        }
        this._lastUVWasOverFoliage = hasValidMouseUV && isOverFoliage;

        this._updateRustleInstances(dt);
        this._updateRustleUniforms();
    }

    _spawnOrUpdateRustle(uv, intensity, velocity) {
        const rustleConfig = this.getConfig().rustleInteraction || {};
        const impulseGain = rustleConfig.impulseGain ?? 0.006;
        const maxSwayVelocity = rustleConfig.maxSwayVelocity ?? 0.08;

        let nearest = null;
        let nearestDist = Infinity;
        for (const inst of this.rustleInstances) {
            const d = inst.position.distanceTo(uv);
            if (d < nearestDist) { nearestDist = d; nearest = inst; }
        }

        const mergeRadius = 0.05;
        if (nearest && nearestDist < mergeRadius) {
            nearest.position.copy(uv);
            nearest.intensity = Math.max(nearest.intensity, intensity);
            nearest.velocity.copy(velocity);
            // Mouse injects impulse; branch sway evolves in update loop.
            nearest.swayVelocity.addScaledVector(velocity, impulseGain);
            nearest.swayVelocity.clampLength(0, maxSwayVelocity);
            nearest.alpha = 1.0;
            nearest.targetAlpha = 1.0;
            nearest.touchTime = this.time;
            return;
        }

        let wi = 0;
        for (let i = 0; i < this.rustleInstances.length; i++) {
            if (this.rustleInstances[i].alpha > 0.001) {
                this.rustleInstances[wi++] = this.rustleInstances[i];
            }
        }
        this.rustleInstances.length = wi;

        const inst = {
            position: uv.clone(),
            velocity: velocity.clone(),
            sway: new THREE.Vector2(0, 0),
            swayVelocity: velocity.clone().multiplyScalar(impulseGain).clampLength(0, maxSwayVelocity),
            intensity,
            alpha: 1.0,
            targetAlpha: 1.0,
            touchTime: this.time
        };
        this.rustleInstances.push(inst);

        if (this.rustleInstances.length > this.maxRustleInstances) {
            this.rustleInstances.shift();
        }
    }

    _updateRustleInstances(dt) {
        const rustleConfig = this.getConfig().rustleInteraction || {};
        const fadeSpeed = rustleConfig.fadeOutSpeed ?? 1.5;
        const branchStiffness = rustleConfig.branchStiffness ?? 14.0;
        const branchDamping = rustleConfig.branchDamping ?? 7.0;
        const maxSway = rustleConfig.maxSway ?? 0.05;
        // Substep spring integration to keep behavior stable across framerates.
        const maxSpringStep = Math.min(0.05, Math.max(1 / 480, rustleConfig.maxSpringStep ?? (1 / 120)));
        const substeps = Math.max(1, Math.ceil(dt / maxSpringStep));
        const stepDt = dt / substeps;
        let wi = 0;
        for (let i = 0; i < this.rustleInstances.length; i++) {
            const inst = this.rustleInstances[i];
            const age = this.time - inst.touchTime;
            if (age > 0.1) {
                inst.targetAlpha = 0;
            }

            // Damped spring branch model:
            // sway'' = -k * sway - c * sway'
            for (let s = 0; s < substeps; s++) {
                inst.swayVelocity.x += (-branchStiffness * inst.sway.x - branchDamping * inst.swayVelocity.x) * stepDt;
                inst.swayVelocity.y += (-branchStiffness * inst.sway.y - branchDamping * inst.swayVelocity.y) * stepDt;
                inst.sway.x += inst.swayVelocity.x * stepDt;
                inst.sway.y += inst.swayVelocity.y * stepDt;
                inst.sway.clampLength(0, maxSway);
            }

            if (inst.targetAlpha === 0) {
                inst.alpha = Math.max(0, inst.alpha - fadeSpeed * dt);
                inst.intensity = Math.max(0, inst.intensity - fadeSpeed * dt);
            }
            if (inst.alpha > 0.001) {
                this.rustleInstances[wi++] = inst;
            }
        }
        this.rustleInstances.length = wi;
    }

    _updateRustleUniforms() {
        if (!this.uniforms) return;
        const count = Math.min(this.rustleInstances.length, this.maxRustleInstances);
        this.uniforms.rustleInstanceCount.value = count;
        for (let i = 0; i < this.maxRustleInstances; i++) {
            if (i < count) {
                const inst = this.rustleInstances[i];
                this.uniforms[this._rustlePosList[i]].value.copy(inst.position);
                this.uniforms[this._rustleVelList[i]].value.copy(inst.sway);
                this.uniforms[this._rustleIntensityList[i]].value = inst.intensity;
                this.uniforms[this._rustleAlphaList[i]].value = inst.alpha;
            } else {
                this.uniforms[this._rustlePosList[i]].value.set(-1, -1);
                this.uniforms[this._rustleVelList[i]].value.set(0, 0);
                this.uniforms[this._rustleIntensityList[i]].value = 0;
                this.uniforms[this._rustleAlphaList[i]].value = 0;
            }
        }
    }

    // --- Init ---
    async init() {
        if (this.isInitialized) return;

        const config = this.getConfig();
        const basePath = `./assets/ParallaxBackgrounds/${this.parallax.backgroundName}/`;
        const maskPath = basePath + (config.maskPath || 'assets/bg2FoliageMask.webp');

        const loadWithFallback = async (primary, fallbacks = []) => {
            const paths = [primary, ...fallbacks];
            for (let i = 0; i < paths.length; i++) {
                const p = paths[i];
                try {
                    return await this.loadTexture(p);
                } catch (e) {
                    if (i === paths.length - 1) throw e;
                    log(`FoliageWindEffect: Fallback from ${p} to next path`);
                }
            }
            throw new Error('FoliageWindEffect: No texture paths available');
        };

        try {
            const maskTexture = this.maskTexture || await loadWithFallback(
                maskPath,
                ['assets/bg2FoliageMask.webp', 'assets/bg2FoliageMask.png']
                    .map((p) => basePath + p)
                    .filter((p) => p !== maskPath)
            );

            maskTexture.wrapS = maskTexture.wrapT = THREE.ClampToEdgeWrapping;

            if (!this.maskTexture) this.maskTexture = maskTexture;
            this.textures.push(maskTexture);

            // Deferred mask sampler build
            if (!this.maskSampler || this.maskSampler.maskTexture !== maskTexture) {
                this.maskSampler = null;
                const buildSampler = () => { this.maskSampler = this._buildMaskSampler(maskTexture); };
                if (typeof requestIdleCallback !== 'undefined') {
                    requestIdleCallback(buildSampler, { timeout: 500 });
                } else {
                    setTimeout(buildSampler, 0);
                }
            }

            const dirAngle = (config.windDirection ?? 0) * Math.PI / 180;
            const rustleConfig = config.rustleInteraction || {};

            this.uniforms = {
                map: { value: this.parallax.imageTexture },
                maskMap: { value: maskTexture },
                time: { value: 0 },
                windStrength: { value: config.windStrength ?? 0.003 },
                windSpeed: { value: config.windSpeed ?? 0.25 },
                primaryScale: { value: config.primaryScale ?? 1.5 },
                secondaryScale: { value: config.secondaryScale ?? 6.0 },
                gustStrength: { value: config.gustStrength ?? 0.001 },
                gustScale: { value: config.gustScale ?? 1.8 },
                shimmerStrength: { value: config.shimmerStrength ?? 0.03 },
                influenceCurve: { value: config.influenceCurve ?? 0.3 },
                minInfluence: { value: config.minInfluence ?? 0.0 },
                sharpness: { value: config.sharpness ?? 0.5 },
                texelSize: { value: new THREE.Vector2(
                    1 / Math.max(1, maskTexture.image?.width || 2048),
                    1 / Math.max(1, maskTexture.image?.height || 2048)
                ) },
                windEnvelope: { value: 1.0 },
                windDirection: { value: new THREE.Vector2(Math.cos(dirAngle), Math.sin(dirAngle)) },
                // Rustle uniforms
                rustleEnabled: { value: 0.0 },
                rustleStrength: { value: rustleConfig.strength ?? 0.008 },
                rustleRadius: { value: rustleConfig.radius ?? 0.08 },
                rustleInstanceCount: { value: 0 }
            };

            // Per-slot rustle instance uniforms
            for (let i = 0; i < MAX_RUSTLE_INSTANCES; i++) {
                this.uniforms[this._rustlePosList[i]] = { value: new THREE.Vector2(-1, -1) };
                this.uniforms[this._rustleVelList[i]] = { value: new THREE.Vector2(0, 0) };
                this.uniforms[this._rustleIntensityList[i]] = { value: 0 };
                this.uniforms[this._rustleAlphaList[i]] = { value: 0 };
            }

            mergeAreaPassUvBoundsUniforms(this.uniforms, config, THREE);

            this._baseWindSpeed = config.windSpeed ?? 0.25;
            this._initEnvelopeState(WIND_STATE.BLOWING);

            this.overlayMesh = this.createCoarseAreaEffectMesh(
                FRAGMENT_SHADER,
                this.uniforms,
                {
                    overlaySegments: config.overlaySegments ?? 128,
                    transparent: false,
                    depthWrite: false
                }
            );
            // After character-mask-tint (renderOrder 1): tint uses depthTest false and samples undistorted UVs,
            // so if it draws last it replaces wind with a static map in masked regions and looks misaligned at edges.
            this.overlayMesh.renderOrder = 2;
            this.syncWithParallaxMesh(this.overlayMesh, { overlayZ: PARALLAX_COARSE_OVERLAY_Z });

            // Particle emitter for falling leaves
            const leafConfig = config.leafParticles || {};
            if (leafConfig.enabled !== false && !this.particleEmitter) {
                this.particleEmitter = new FoliageParticleEmitter(this.scene, this.camera, this.renderer, basePath);
            }

            // Mouse tracking
            this._setupMouseTracking();

            this.isInitialized = true;
            log('FoliageWindEffect: Initialized successfully');
        } catch (error) {
            console.error('FoliageWindEffect: Error during initialization:', error);
            throw error;
        }
    }

    update(deltaTime) {
        if (!this.isInitialized || !this.overlayMesh || !this.uniforms) return;

        this._frameCounter++;
        const dt = Number.isFinite(deltaTime) && deltaTime > 0 ? deltaTime : 0.016;
        this.time += dt;
        this.uniforms.time.value = this.time;

        const config = this.getConfig();
        this.uniforms.windStrength.value = config.windStrength ?? this.uniforms.windStrength.value;
        this._baseWindSpeed = config.windSpeed ?? this._baseWindSpeed;
        this.uniforms.primaryScale.value = config.primaryScale ?? this.uniforms.primaryScale.value;
        this.uniforms.secondaryScale.value = config.secondaryScale ?? this.uniforms.secondaryScale.value;
        this.uniforms.gustStrength.value = config.gustStrength ?? this.uniforms.gustStrength.value;
        this.uniforms.gustScale.value = config.gustScale ?? this.uniforms.gustScale.value;
        this.uniforms.shimmerStrength.value = config.shimmerStrength ?? this.uniforms.shimmerStrength.value;
        this.uniforms.influenceCurve.value = config.influenceCurve ?? this.uniforms.influenceCurve.value;
        this.uniforms.minInfluence.value = config.minInfluence ?? this.uniforms.minInfluence.value;
        this.uniforms.sharpness.value = config.sharpness ?? this.uniforms.sharpness.value;
        syncAreaPassUvBoundsUniforms(this.uniforms, config);

        // Rustle config hot-reload
        const rustleConfig = config.rustleInteraction || {};
        this.uniforms.rustleStrength.value = rustleConfig.strength ?? this.uniforms.rustleStrength.value;
        this.uniforms.rustleRadius.value = rustleConfig.radius ?? this.uniforms.rustleRadius.value;

        // Wind direction
        const dirAngle = (config.windDirection ?? 0) * Math.PI / 180;
        this.uniforms.windDirection.value.set(Math.cos(dirAngle), Math.sin(dirAngle));

        // Envelope
        this._updateEnvelope(dt);
        this.uniforms.windEnvelope.value = this._envValue;

        // Speed variation
        this._updateSpeedVariation(dt);
        this.uniforms.windSpeed.value = this._baseWindSpeed * (1 + this._speedJitter);

        // Rustle interaction
        this._updateRustleInteraction(dt);

        // Particle emitter
        if (this.particleEmitter) {
            const leafConfig = config.leafParticles || {};
            this.particleEmitter.update(dt, leafConfig.gravity ?? 0.15);
        }
        this._updateAmbientLeafFall(dt, config);

        this.syncWithParallaxMesh(this.overlayMesh, { overlayZ: PARALLAX_COARSE_OVERLAY_Z });
    }

    cleanup() {
        // Remove event listeners
        if (this.parallax?.canvas) {
            const canvas = this.parallax.canvas;
            if (this._mouseMoveHandler) canvas.removeEventListener('mousemove', this._mouseMoveHandler);
            if (this._touchStartHandler) canvas.removeEventListener('touchstart', this._touchStartHandler);
            if (this._touchMoveHandler) canvas.removeEventListener('touchmove', this._touchMoveHandler);
            if (this._touchEndHandler) {
                canvas.removeEventListener('touchend', this._touchEndHandler);
                canvas.removeEventListener('touchcancel', this._touchEndHandler);
            }
        }
        if (this._resizeHandler) window.removeEventListener('resize', this._resizeHandler);
        if (this._scrollHandler) window.removeEventListener('scroll', this._scrollHandler);
        this._mouseMoveHandler = null;
        this._touchMoveHandler = null;
        this._touchEndHandler = null;
        this._resizeHandler = null;
        this._scrollHandler = null;

        if (this.particleEmitter) {
            this.particleEmitter.cleanup();
            this.particleEmitter = null;
        }

        this.rustleInstances = [];
        this.overlayMesh = null;
        this.uniforms = null;
        this._cachedConfig = null;
        this._cachedConfigFrame = -1;
        this._frameCounter = 0;
        super.cleanup();
    }
}

export default FoliageWindEffect;
