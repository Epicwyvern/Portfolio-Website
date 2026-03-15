// Flame Movement Effect - Area effect for bg2: pixel displacement in masked flame region
// Uses bg2FlameMask.webp: black (0) = no effect, 1–255 = effect applied (warp existing flame pixels).

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
    uniform float displacementStrength;
    uniform float speed;
    uniform float primaryScale;
    uniform float secondaryScale;
    uniform float verticalBias;
    uniform float horizontalSway;
    uniform float flickerAmount;
    uniform float influenceMin;
    uniform float tipAccent;
    uniform float tipStart;
    uniform float tipEnd;
    uniform float showTipHighlight;

    varying vec2 vUv;

    void main() {
        float maskValue = texture2D(maskMap, vUv).r;
        float influence = clamp((maskValue - influenceMin) / max(0.0001, 1.0 - influenceMin), 0.0, 1.0);
        if (influence <= 0.001) discard;

        float t = time * speed;
        float pi = 6.2831853;
        float tipFactor = smoothstep(tipStart, tipEnd, vUv.y);
        float tipMul = 1.0 + tipAccent * tipFactor;

        float p1 = vUv.x * primaryScale + vUv.y * primaryScale * 0.7 + t;
        float p2 = vUv.x * secondaryScale * 1.3 - vUv.y * secondaryScale * 0.5 + t * 0.83 + 1.5;
        float p3 = (vUv.x - vUv.y) * primaryScale * 0.6 + t * 1.1 + 3.0;

        float dx = sin(p1 * pi) * 0.5 + sin(p2 * pi) * 0.35 + sin(p3 * pi) * 0.15;
        float dy = sin(p1 * pi + 0.7) * 0.5 + sin(p2 * pi + 1.2) * 0.35 + sin(p3 * pi + 0.3) * 0.15;

        float flicker = 1.0 + (flickerAmount * (sin(t * 4.0) * 0.5 + 0.5));
        vec2 displacement = vec2(
            (dx * horizontalSway + verticalBias * sin(t * 2.0)) * displacementStrength * flicker * influence * tipMul,
            (dy + verticalBias) * displacementStrength * flicker * influence * tipMul
        );

        vec2 displacedUv = clamp(vUv + displacement, vec2(0.0), vec2(1.0));
        vec4 color = texture2D(map, displacedUv);
        float inTip = step(tipStart, vUv.y) * step(vUv.y, tipEnd);
        vec3 tipTint = vec3(1.0, 0.2, 0.6);
        float tintMix = showTipHighlight * inTip * 0.45;
        color.rgb = mix(color.rgb, tipTint, tintMix);
        gl_FragColor = vec4(color.rgb, influence);
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
                showTipHighlight: { value: config.showTipHighlight ? 1.0 : 0.0 }
            };

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
            this.overlayMesh.renderOrder = 10000;

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

        this.syncWithParallaxMesh(this.overlayMesh);
        this.overlayMesh.position.z = 0.013;
        if (this.overlayMesh.renderOrder !== 10000) this.overlayMesh.renderOrder = 10000;
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
