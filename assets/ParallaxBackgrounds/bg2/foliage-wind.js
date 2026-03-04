// Foliage Wind Effect - Area effect for bg2: ambient wind shuffle on masked foliage
// Uses grayscale mask values as per-pixel wind influence strength (0..1)

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
    uniform float motionFloor;
    uniform float opacity;
    uniform float sharpness;
    uniform vec2 texelSize;

    varying vec2 vUv;

    void main() {
        float maskValue = texture2D(maskMap, vUv).r;
        if (maskValue <= 0.001) discard;

        float normalized = clamp((maskValue - minInfluence) / max(0.0001, 1.0 - minInfluence), 0.0, 1.0);
        float influenceRaw = pow(normalized, max(0.01, influenceCurve));
        float influence = max(influenceRaw, motionFloor);
        if (influence <= 0.001) discard;

        float t = time * windSpeed;
        float phaseA = sin((vUv.y * primaryScale + t) * 6.2831853);
        float phaseB = sin((vUv.x * secondaryScale - t * 0.73) * 6.2831853 + phaseA * 0.45);
        float gustA = sin(((vUv.x + vUv.y) * gustScale + t * 1.7) * 6.2831853);
        float gustB = sin((vUv.x * (gustScale * 0.7) - vUv.y * (gustScale * 1.3) + t * 1.1) * 6.2831853);

        float windPower = mix(0.15, 1.0, clamp(opacity, 0.0, 1.0));
        float driftX = ((phaseA * 0.65 + phaseB * 0.35) * windStrength + (gustA * 0.6 + gustB * 0.4) * gustStrength) * windPower;
        float driftY = (phaseB * windStrength * 0.45 + gustB * gustStrength * 0.35) * windPower;

        vec2 displacedUv = clamp(vUv + vec2(driftX, driftY) * influence, vec2(0.0), vec2(1.0));
        vec4 baseColor = texture2D(map, vUv);
        vec4 displacedColor = texture2D(map, displacedUv);

        // Mild unsharp mask to preserve leaf detail after UV warping.
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
        float blendAmount = clamp(influence * (0.25 + opacity * 0.75), 0.0, 1.0);
        vec3 mixedColor = mix(baseColor.rgb, sharpened, blendAmount);
        vec3 color = mixedColor * (1.0 + shimmer * shimmerStrength * influence);

        gl_FragColor = vec4(color, 1.0);
    }
`;

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
    }

    getConfig() {
        if (this._cachedConfigFrame === this._frameCounter) return this._cachedConfig;
        this._cachedConfig = this.parallax?.config?.effects?.foliageWind || {};
        this._cachedConfigFrame = this._frameCounter;
        return this._cachedConfig;
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

            this.uniforms = {
                map: { value: this.parallax.imageTexture },
                maskMap: { value: maskTexture },
                time: { value: 0 },
                windStrength: { value: config.windStrength ?? 0.0065 },
                windSpeed: { value: config.windSpeed ?? 0.25 },
                primaryScale: { value: config.primaryScale ?? 2.0 },
                secondaryScale: { value: config.secondaryScale ?? 3.5 },
                gustStrength: { value: config.gustStrength ?? 0.0025 },
                gustScale: { value: config.gustScale ?? 1.2 },
                shimmerStrength: { value: config.shimmerStrength ?? 0.02 },
                influenceCurve: { value: config.influenceCurve ?? 1.2 },
                minInfluence: { value: config.minInfluence ?? 0.0 },
                motionFloor: { value: config.motionFloor ?? 0.08 },
                opacity: { value: config.opacity ?? 0.7 },
                sharpness: { value: config.sharpness ?? 0.55 },
                texelSize: { value: new THREE.Vector2(
                    1 / Math.max(1, maskTexture.image?.width || 2048),
                    1 / Math.max(1, maskTexture.image?.height || 2048)
                ) }
            };

            this.overlayMesh = this.createCoarseAreaEffectMesh(
                FRAGMENT_SHADER,
                this.uniforms,
                {
                    overlaySegments: config.overlaySegments ?? 64,
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
        this.uniforms.windSpeed.value = config.windSpeed ?? this.uniforms.windSpeed.value;
        this.uniforms.primaryScale.value = config.primaryScale ?? this.uniforms.primaryScale.value;
        this.uniforms.secondaryScale.value = config.secondaryScale ?? this.uniforms.secondaryScale.value;
        this.uniforms.gustStrength.value = config.gustStrength ?? this.uniforms.gustStrength.value;
        this.uniforms.gustScale.value = config.gustScale ?? this.uniforms.gustScale.value;
        this.uniforms.shimmerStrength.value = config.shimmerStrength ?? this.uniforms.shimmerStrength.value;
        this.uniforms.influenceCurve.value = config.influenceCurve ?? this.uniforms.influenceCurve.value;
        this.uniforms.minInfluence.value = config.minInfluence ?? this.uniforms.minInfluence.value;
        this.uniforms.motionFloor.value = config.motionFloor ?? this.uniforms.motionFloor.value;
        this.uniforms.opacity.value = config.opacity ?? this.uniforms.opacity.value;
        this.uniforms.sharpness.value = config.sharpness ?? this.uniforms.sharpness.value;

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
