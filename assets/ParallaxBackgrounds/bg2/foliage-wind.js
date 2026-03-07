// Foliage Wind Effect - Area effect for bg2: ambient wind shuffle on masked foliage
// Uses grayscale mask values as per-pixel wind influence strength (0..1)
// Wind envelope state machine modulates intensity over time (blow/calm cycles)

import BaseEffect from '../../../js/base-effect.js';
import * as THREE from 'https://unpkg.com/three@0.172.0/build/three.module.js';

const log = (...args) => {
    if (window.location.pathname.endsWith('test-effects.html')) {
        console.log(...args);
    }
};

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

    // Envelope + direction (driven from JS each frame)
    uniform float windEnvelope;
    uniform vec2 windDirection;

    varying vec2 vUv;

    void main() {
        float maskValue = texture2D(maskMap, vUv).r;
        if (maskValue <= 0.001) discard;

        float normalized = clamp((maskValue - minInfluence) / max(0.0001, 1.0 - minInfluence), 0.0, 1.0);
        float influence = pow(normalized, max(0.01, influenceCurve));
        if (influence <= 0.001) discard;

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
        vec2 drift = dir * waveMag + perp * wavePerp;

        vec2 displacedUv = clamp(vUv + drift * influence, vec2(0.0), vec2(1.0));
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
    }

    getConfig() {
        if (this._cachedConfigFrame === this._frameCounter) return this._cachedConfig;
        this._cachedConfig = this.parallax?.config?.effects?.foliageWind || {};
        this._cachedConfigFrame = this._frameCounter;
        return this._cachedConfig;
    }

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
                // Hold at current calm level
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

            const dirAngle = (config.windDirection ?? 0) * Math.PI / 180;

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
                windDirection: { value: new THREE.Vector2(Math.cos(dirAngle), Math.sin(dirAngle)) }
            };

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
            this.overlayMesh.position.z = 0.012;

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

        // Wind direction (degrees in config -> vec2)
        const dirAngle = (config.windDirection ?? 0) * Math.PI / 180;
        this.uniforms.windDirection.value.set(Math.cos(dirAngle), Math.sin(dirAngle));

        // Envelope
        this._updateEnvelope(dt);
        this.uniforms.windEnvelope.value = this._envValue;

        // Speed variation
        this._updateSpeedVariation(dt);
        this.uniforms.windSpeed.value = this._baseWindSpeed * (1 + this._speedJitter);

        this.syncWithParallaxMesh(this.overlayMesh);
        this.overlayMesh.position.z = 0.012;
    }

    cleanup() {
        this.overlayMesh = null;
        this.uniforms = null;
        this._cachedConfig = null;
        this._cachedConfigFrame = -1;
        this._frameCounter = 0;
        super.cleanup();
    }
}

export default FoliageWindEffect;
