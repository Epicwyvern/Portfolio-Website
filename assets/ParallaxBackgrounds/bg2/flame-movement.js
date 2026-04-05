// Flame Movement Effect - Area effect for bg2: pixel displacement in masked flame region
// Uses bg2FlameMask.webp: black (0) = no effect, 1–255 = effect applied (warp existing flame pixels).

import BaseEffect, {
    GLSL_AREA_PASS_UV_BOUNDS_DISCARD_AND_LINE,
    GLSL_AREA_PASS_UV_BOUNDS_UNIFORMS,
    mergeAreaPassUvBoundsUniforms,
    syncAreaPassUvBoundsUniforms
} from '../../../js/base-effect.js';
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
    uniform float displacementStrength;
    uniform float speed;
    uniform float primaryScale;
    uniform float secondaryScale;
    uniform float verticalBias;
    uniform float horizontalSway;
    uniform float flickerAmount;
    uniform float influenceMin;
    uniform float tipAccent;
    uniform vec2 texelSize;
    uniform float ringWidth;
    uniform float ringAlphaMax;
    uniform float bottomDampStrength;
    uniform float bottomDampStart;
    uniform float bottomDampEnd;
    uniform float randomnessScale;
    uniform float tipStart;
    uniform float tipEnd;
    uniform float showTipHighlight;
    uniform float showBottomHighlight;
    uniform float heightScale;
    uniform float flameBaseY;
${GLSL_AREA_PASS_UV_BOUNDS_UNIFORMS}
    varying vec2 vUv;

    void main() {
${GLSL_AREA_PASS_UV_BOUNDS_DISCARD_AND_LINE}
        float maskValue = texture2D(maskMap, vUv).r;

        // Inner influence: strict mask area (fully affected)
        float innerInfluence = clamp((maskValue - influenceMin) / max(0.0001, 1.0 - influenceMin), 0.0, 1.0);

        // Soft ring: sample neighbours to slightly extend influence
        vec2 off = texelSize * max(0.0, ringWidth);
        float neighbourMax = max(
            max(texture2D(maskMap, vUv + vec2(off.x, 0.0)).r, texture2D(maskMap, vUv - vec2(off.x, 0.0)).r),
            max(texture2D(maskMap, vUv + vec2(0.0, off.y)).r, texture2D(maskMap, vUv - vec2(0.0, off.y)).r)
        );
        float expanded = clamp((neighbourMax - influenceMin) / max(0.0001, 1.0 - influenceMin), 0.0, 1.0);

        // Ring is where expanded has influence but inner is fading out
        float ring = max(0.0, expanded - innerInfluence);
        float ringAlpha = clamp(ring * ringAlphaMax, 0.0, ringAlphaMax); // semi‑transparent halo

        float alphaInfluence = innerInfluence + ringAlpha;
        if (alphaInfluence <= 0.001) {
            if (passLine * uPassBoundsHiStrength < 0.012) discard;
            float a = passLine * uPassBoundsHiStrength;
            gl_FragColor = vec4(uPassBoundsHiColor * a, a);
            return;
        }

        // Displacement is strongest in inner region, falls off in the ring
        float displacementInfluence = innerInfluence + ring * 0.25;

        // Bottom damping: reduce motion near candle base
        float bottomFactor = smoothstep(bottomDampStart, bottomDampEnd, 1.0 - vUv.y);
        float bottomMul = mix(1.0, 1.0 - bottomDampStrength, bottomFactor);

        float t = time * speed;
        float pi = 6.2831853;
        float tipFactor = smoothstep(tipStart, tipEnd, vUv.y);
        float tipMul = 1.0 + tipAccent * tipFactor;

        // Temporal banded randomness (no grain): varies mainly with height and time
        float bandPhase = vUv.y * 7.0 + time * 0.8;
        float n = sin(bandPhase) * 0.5 + 0.5;
        float randScale = 1.0 + randomnessScale * (n - 0.5);

        float p1 = (vUv.x * primaryScale + vUv.y * primaryScale * 0.7 + t) * randScale;
        float p2 = (vUv.x * secondaryScale * 1.3 - vUv.y * secondaryScale * 0.5 + t * 0.83 + 1.5) * (1.0 + randomnessScale * 0.3);
        float p3 = ((vUv.x - vUv.y) * primaryScale * 0.6 + t * 1.1 + 3.0) * (1.0 - randomnessScale * 0.2);

        float dx = sin(p1 * pi) * 0.5 + sin(p2 * pi) * 0.35 + sin(p3 * pi) * 0.15;
        float dy = sin(p1 * pi + 0.7) * 0.5 + sin(p2 * pi + 1.2) * 0.35 + sin(p3 * pi + 0.3) * 0.15;

        float flicker = 1.0 + (flickerAmount * (sin(t * 4.0) * 0.5 + 0.5));
        vec2 displacement = vec2(
            (dx * horizontalSway + verticalBias * sin(t * 2.0)) * displacementStrength * flicker * displacementInfluence * tipMul * bottomMul,
            (dy + verticalBias) * displacementStrength * flicker * displacementInfluence * tipMul * bottomMul
        );

        vec2 displacedUv = vUv + displacement;
        displacedUv.y = (displacedUv.y - flameBaseY) * heightScale + flameBaseY;
        displacedUv = clamp(displacedUv, vec2(0.0), vec2(1.0));
        vec4 color = texture2D(map, displacedUv);
        float inTip = step(tipStart, vUv.y) * step(vUv.y, tipEnd);
        vec3 tipTint = vec3(1.0, 0.2, 0.6);
        float tintMix = showTipHighlight * inTip * 0.45;
        color.rgb = mix(color.rgb, tipTint, tintMix);
        // Bottom band uses the same range as bottom damping (in the 1.0 - vUv.y space)
        float yBottom = 1.0 - vUv.y;
        float inBottom = step(bottomDampStart, yBottom) * step(yBottom, bottomDampEnd);
        vec3 bottomTint = vec3(0.2, 0.8, 1.0);
        float bottomMix = showBottomHighlight * inBottom * 0.4;
        color.rgb = mix(color.rgb, bottomTint, bottomMix);
        vec3 rgb = min(color.rgb + uPassBoundsHiColor * passLine * uPassBoundsHiStrength, vec3(1.0));
        gl_FragColor = vec4(rgb, alphaInfluence);
    }
`;

class FlameMovementEffect extends BaseEffect {
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
        this._cachedConfig = this.parallax?.config?.effects?.flameMovement || {};
        this._cachedConfigFrame = this._frameCounter;
        return this._cachedConfig;
    }

    async init() {
        if (this.isInitialized) return;

        const config = this.getConfig();
        const basePath = `./assets/ParallaxBackgrounds/${this.parallax.backgroundName}/`;
        const maskPath = basePath + (config.maskPath || 'assets/bg2FlameMask.webp');

        const loadWithFallback = async (primary, fallbacks = []) => {
            const paths = [primary, ...fallbacks];
            for (let i = 0; i < paths.length; i++) {
                const p = paths[i];
                try {
                    return await this.loadTexture(p);
                } catch (e) {
                    if (i === paths.length - 1) throw e;
                    log(`FlameMovementEffect: Fallback from ${p} to next path`);
                }
            }
            throw new Error('FlameMovementEffect: No texture paths available');
        };

        try {
            const maskTexture = this.maskTexture || await loadWithFallback(
                maskPath,
                ['assets/bg2FlameMask.webp', 'assets/bg2FlameMask.png']
                    .map((p) => basePath + p)
                    .filter((p) => p !== maskPath)
            );

            maskTexture.wrapS = maskTexture.wrapT = THREE.ClampToEdgeWrapping;
            if (!this.maskTexture) this.maskTexture = maskTexture;
            this.textures.push(maskTexture);

            const tw = Math.max(1, maskTexture.image?.width || 1920);
            const th = Math.max(1, maskTexture.image?.height || 1080);
            this.uniforms = {
                map: { value: this.parallax.imageTexture },
                maskMap: { value: maskTexture },
                time: { value: 0 },
                displacementStrength: { value: config.displacementStrength ?? 0.008 },
                speed: { value: config.speed ?? 3.0 },
                primaryScale: { value: config.primaryScale ?? 25.0 },
                secondaryScale: { value: config.secondaryScale ?? 40.0 },
                verticalBias: { value: config.verticalBias ?? 0.003 },
                horizontalSway: { value: config.horizontalSway ?? 1.0 },
                flickerAmount: { value: config.flickerAmount ?? 0.4 },
                influenceMin: { value: config.influenceMin ?? 0.0 },
                tipAccent: { value: config.tipAccent ?? 0.6 },
                tipStart: { value: config.tipStart ?? 0.4 },
                tipEnd: { value: config.tipEnd ?? 0.95 },
                showTipHighlight: { value: config.showTipHighlight ? 1.0 : 0.0 },
                showBottomHighlight: { value: config.showBottomHighlight ? 1.0 : 0.0 },
                texelSize: { value: new THREE.Vector2(1 / tw, 1 / th) },
                ringWidth: { value: config.ringWidth ?? 1.0 },
                ringAlphaMax: { value: config.ringAlphaMax ?? 0.35 },
                bottomDampStrength: { value: config.bottomDampStrength ?? 0.6 },
                bottomDampStart: { value: config.bottomDampStart ?? 0.0 },
                bottomDampEnd: { value: config.bottomDampEnd ?? 0.25 },
                randomnessScale: { value: config.randomnessScale ?? 0.3 },
                heightScale: { value: 1.0 },
                flameBaseY: { value: config.flameBaseY ?? 0.82 }
            };
            mergeAreaPassUvBoundsUniforms(this.uniforms, config, THREE);

            this.overlayMesh = this.createCoarseAreaEffectMesh(
                FRAGMENT_SHADER,
                this.uniforms,
                {
                    overlaySegments: config.overlaySegments ?? 64,
                    transparent: true,
                    depthWrite: false,
                    depthTest: false
                }
            );
            this.overlayMesh.position.z = 0.013;

            this.isInitialized = true;
            log('FlameMovementEffect: Initialized successfully');
        } catch (error) {
            console.error('FlameMovementEffect: Error during initialization:', error);
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
        syncAreaPassUvBoundsUniforms(this.uniforms, config);
        const speed = config.speed ?? 3.0;
        const flickerAmount = config.flickerAmount ?? 0.4;
        const heightVariation = config.heightVariation ?? 0.06;
        const t = this.time * speed;
        const flicker = 1.0 + flickerAmount * (Math.sin(t * 4.0) * 0.5 + 0.5);
        const heightScale = 1.0 + heightVariation * Math.sin(t * 4.0);
        if (!this.parallax.flameState) this.parallax.flameState = {};
        this.parallax.flameState.flicker = flicker;
        this.parallax.flameState.heightScale = heightScale;
        this.uniforms.displacementStrength.value = config.displacementStrength ?? this.uniforms.displacementStrength.value;
        this.uniforms.speed.value = config.speed ?? this.uniforms.speed.value;
        this.uniforms.primaryScale.value = config.primaryScale ?? this.uniforms.primaryScale.value;
        this.uniforms.secondaryScale.value = config.secondaryScale ?? this.uniforms.secondaryScale.value;
        this.uniforms.verticalBias.value = config.verticalBias ?? this.uniforms.verticalBias.value;
        this.uniforms.horizontalSway.value = config.horizontalSway ?? this.uniforms.horizontalSway.value;
        this.uniforms.flickerAmount.value = config.flickerAmount ?? this.uniforms.flickerAmount.value;
        this.uniforms.influenceMin.value = config.influenceMin ?? this.uniforms.influenceMin.value;
        this.uniforms.tipAccent.value = config.tipAccent ?? this.uniforms.tipAccent.value;
        this.uniforms.tipStart.value = config.tipStart ?? this.uniforms.tipStart.value;
        this.uniforms.tipEnd.value = config.tipEnd ?? this.uniforms.tipEnd.value;
        this.uniforms.showTipHighlight.value = config.showTipHighlight ? 1.0 : 0.0;
        this.uniforms.showBottomHighlight.value = config.showBottomHighlight ? 1.0 : 0.0;
        this.uniforms.ringWidth.value = config.ringWidth ?? this.uniforms.ringWidth.value;
        this.uniforms.ringAlphaMax.value = config.ringAlphaMax ?? this.uniforms.ringAlphaMax.value;
        this.uniforms.bottomDampStrength.value = config.bottomDampStrength ?? this.uniforms.bottomDampStrength.value;
        this.uniforms.bottomDampStart.value = config.bottomDampStart ?? this.uniforms.bottomDampStart.value;
        this.uniforms.bottomDampEnd.value = config.bottomDampEnd ?? this.uniforms.bottomDampEnd.value;
        this.uniforms.randomnessScale.value = config.randomnessScale ?? this.uniforms.randomnessScale.value;
        this.uniforms.heightScale.value = heightScale;
        this.uniforms.flameBaseY.value = config.flameBaseY ?? 0.82;

        this.syncWithParallaxMesh(this.overlayMesh);
        this.overlayMesh.position.z = 0.013;
    }

    cleanup() {
        this.overlayMesh = null;
        this.uniforms = null;
        this.maskTexture = null;
        this._cachedConfig = null;
        this._cachedConfigFrame = -1;
        this._frameCounter = 0;
        super.cleanup();
    }
}

export default FlameMovementEffect;
