// Character mask tint — area effect for bg2: tints the background where a mask is non-zero.
// Uses the same coarse displaced geometry as water / foliage so the overlay tracks parallax.
// Default: sample LUMINANCE (RGB): many character masks use black=off / white=on with A=255 on all
// opaque pixels, so alpha is not the strength channel. Use maskChannel "alpha" when transparency
// encodes soft edges; "red" for water-style single-channel in R only.

import BaseEffect, { PARALLAX_COARSE_OVERLAY_Z } from '../../../js/base-effect.js';
import * as THREE from 'https://unpkg.com/three@0.172.0/build/three.module.js';

const log = (...args) => {
    if (window.location.pathname.endsWith('test-effects.html')) {
        console.log(...args);
    }
};

/** @param {string} ch @returns {number} 0 alpha, 1 red, 2 max(r,a), 3 luminance */
export function characterMaskTintChannelToFloat(ch) {
    const c = (ch || 'alpha').toLowerCase();
    if (c === 'red' || c === 'r') return 1;
    if (c === 'max' || c === 'maxRa') return 2;
    if (c === 'luminance' || c === 'luma' || c === 'gray') return 3;
    return 0;
}

const FRAGMENT_SHADER = `
    uniform sampler2D map;
    uniform sampler2D maskMap;
    uniform vec3 uTintColor;
    uniform float uTintStrength;
    uniform float uOpacity;
    uniform float uMaskSource;
    uniform float uMaskThreshold;
    uniform float uMaskInvert;

    varying vec2 vUv;

    float rawMaskSample(vec4 t) {
        if (uMaskSource > 2.5) return dot(t.rgb, vec3(0.299, 0.587, 0.114));
        if (uMaskSource > 1.5) return max(t.r, t.a);
        if (uMaskSource > 0.5) return t.r;
        return t.a;
    }

    void main() {
        vec4 ms = texture2D(maskMap, vUv);
        float m = rawMaskSample(ms);
        if (uMaskInvert > 0.5) m = 1.0 - m;

        if (m < uMaskThreshold) discard;

        float denom = max(0.00001, 1.0 - uMaskThreshold);
        float mScaled = clamp((m - uMaskThreshold) / denom, 0.0, 1.0);

        vec3 bg = texture2D(map, vUv).rgb;
        float blend = clamp(mScaled * uTintStrength * uOpacity, 0.0, 1.0);
        vec3 outRgb = mix(bg, uTintColor, blend);
        gl_FragColor = vec4(outRgb, 1.0);
    }
`;

class CharacterMaskTintEffect extends BaseEffect {
    constructor(scene, camera, renderer, parallaxInstance) {
        super(scene, camera, renderer, parallaxInstance);
        this.effectType = 'area';
        this.overlayMesh = null;
        this.uniforms = null;
        this.maskTexture = null;
    }

    getConfig() {
        return this.parallax?.config?.effects?.characterMaskTint ?? {};
    }

    parseColor(hex) {
        if (typeof hex === 'string') {
            const s = hex.replace(/^0x|^#/, '');
            const n = parseInt(s, 16);
            if (!isNaN(n)) return new THREE.Color(n);
        }
        return new THREE.Color(0x88ccff);
    }

    applyConfig(config) {
        const c = config ?? this.getConfig();
        this.tintColor = this.parseColor(c.tintColor ?? '0x88ccff');
        this.tintStrength = c.tintStrength ?? 0.85;
        this.opacity = c.opacity ?? 1.0;
        // false = skip depth test (draw order handles stacking). Z in update() matches foliage-wind coarse overlay.
        this.useDepthTest = c.useDepthTest === true;
        this.overlaySegments = c.overlaySegments ?? 128;
        // Default luminance: many masks use black RGB = off / white = on with A=255 on all opaque pixels.
        this.maskChannel = c.maskChannel ?? 'luminance';
        this.maskIgnoreBelow = Math.max(0, Math.min(255, Math.round(Number(c.maskIgnoreBelow) || 0)));
        this.maskInvert = c.maskInvert === true;
    }

    getMaskThresholdNormalized() {
        return this.maskIgnoreBelow / 255.0;
    }

    syncUniformsFromConfig(config) {
        if (!this.uniforms) return;
        this.applyConfig(config);
        this.uniforms.uTintColor.value.copy(this.tintColor);
        this.uniforms.uTintStrength.value = this.tintStrength;
        this.uniforms.uOpacity.value = this.opacity;
        this.uniforms.uMaskSource.value = characterMaskTintChannelToFloat(this.maskChannel);
        this.uniforms.uMaskThreshold.value = this.getMaskThresholdNormalized();
        this.uniforms.uMaskInvert.value = this.maskInvert ? 1.0 : 0.0;
    }

    async init() {
        if (this.isInitialized) return;

        const config = this.getConfig();
        this.applyConfig(config);
        const basePath = `./assets/ParallaxBackgrounds/${this.parallax.backgroundName}/`;
        const maskPath = basePath + (config.maskPath || 'assets/bg2CharacterMask.webp');

        const loadWithFallback = async (primary, fallbacks = []) => {
            const paths = [primary, ...fallbacks];
            for (let i = 0; i < paths.length; i++) {
                const p = paths[i];
                try {
                    return await this.loadTexture(p);
                } catch (e) {
                    if (i === paths.length - 1) throw e;
                    log(`CharacterMaskTintEffect: Fallback from ${p}`);
                }
            }
            throw new Error('CharacterMaskTintEffect: No mask path worked');
        };

        try {
            const maskTexture = this.maskTexture || await loadWithFallback(
                maskPath,
                ['assets/bg2CharacterMask.webp', 'assets/bg2CharacterMask.png']
                    .map((p) => basePath + p)
                    .filter((p) => p !== maskPath)
            );

            maskTexture.wrapS = maskTexture.wrapT = THREE.ClampToEdgeWrapping;
            maskTexture.minFilter = maskTexture.magFilter = THREE.LinearFilter;
            maskTexture.generateMipmaps = false;
            maskTexture.premultiplyAlpha = false;

            if (!this.maskTexture) this.maskTexture = maskTexture;
            this.textures.push(maskTexture);

            this.uniforms = {
                map: { value: this.parallax.imageTexture },
                maskMap: { value: maskTexture },
                uTintColor: { value: this.tintColor.clone() },
                uTintStrength: { value: this.tintStrength },
                uOpacity: { value: this.opacity },
                uMaskSource: { value: characterMaskTintChannelToFloat(this.maskChannel) },
                uMaskThreshold: { value: this.getMaskThresholdNormalized() },
                uMaskInvert: { value: this.maskInvert ? 1.0 : 0.0 }
            };

            this.overlayMesh = this.createCoarseAreaEffectMesh(
                FRAGMENT_SHADER,
                this.uniforms,
                {
                    overlaySegments: this.overlaySegments,
                    transparent: false,
                    depthWrite: false,
                    depthTest: this.useDepthTest,
                    polygonOffset: this.useDepthTest,
                    polygonOffsetFactor: 1,
                    polygonOffsetUnits: 1
                }
            );
            this.overlayMesh.renderOrder = 1;

            this.isInitialized = true;
            log(`CharacterMaskTintEffect: Initialized (maskChannel: ${this.maskChannel}, ignoreBelow: ${this.maskIgnoreBelow}, segments: ${this.overlaySegments})`);
        } catch (error) {
            console.error('CharacterMaskTintEffect: init failed:', error);
            throw error;
        }
    }

    update(_deltaTime) {
        if (!this.isInitialized || !this.overlayMesh || !this.uniforms) return;

        this.syncUniformsFromConfig(this.getConfig());

        this.syncWithParallaxMesh(this.overlayMesh, { overlayZ: PARALLAX_COARSE_OVERLAY_Z });

        const mat = this.overlayMesh.material;
        if (mat) {
            const wantTest = this.getConfig().useDepthTest === true;
            if (mat.depthTest !== wantTest) {
                mat.depthTest = wantTest;
                mat.polygonOffset = wantTest;
            }
        }

        if (this.parallax?.imageTexture && this.uniforms.map.value !== this.parallax.imageTexture) {
            this.uniforms.map.value = this.parallax.imageTexture;
        }
    }

    cleanup() {
        this.maskTexture = null;
        super.cleanup();
        this.overlayMesh = null;
        this.uniforms = null;
    }
}

export default CharacterMaskTintEffect;
