// Water Ripple Effect - Area effect for bg2: ripples on masked water regions
// Uses mask (bg2WaterBW.png) for strength 0–255 and normal map for refraction
// Uses coarse overlay geometry for performance (configurable overlaySegments)

import BaseEffect from '../../../js/base-effect.js';
import * as THREE from 'https://unpkg.com/three@0.172.0/build/three.module.js';

const log = (...args) => {
    if (window.location.pathname.endsWith('test-effects.html')) {
        console.log(...args);
    }
};

const DEFAULT_FRAGMENT_SHADER = `
    uniform sampler2D map;
    uniform sampler2D maskMap;
    uniform sampler2D rippleNormal;
    uniform float time;
    uniform float rippleScale;
    uniform float rippleSpeed;
    uniform float refractionStrength;

    varying vec2 vUv;

    void main() {
        float maskStrength = texture2D(maskMap, vUv).r;
        if (maskStrength < 0.00392) discard;

        vec2 rippleUV = vUv * rippleScale + time * rippleSpeed;
        vec3 normal = normalize(texture2D(rippleNormal, rippleUV).xyz * 2.0 - 1.0);

        vec2 refractedUV = vUv + normal.xy * refractionStrength * maskStrength;
        vec4 bgColor = texture2D(map, refractedUV);

        gl_FragColor = vec4(bgColor.rgb, maskStrength);
    }
`;

class WaterRippleEffect extends BaseEffect {
    constructor(scene, camera, renderer, parallaxInstance) {
        super(scene, camera, renderer, parallaxInstance);
        this.effectType = 'area';
    }

    async init() {
        log('WaterRippleEffect: Initializing water ripple area effect');

        try {
            const config = this.getConfig();
            const basePath = `./assets/ParallaxBackgrounds/${this.parallax.backgroundName}/`;

            const maskPath = basePath + (config.maskPath || 'assets/bg2WaterBW.png');
            const ripplePath = basePath + (config.ripplePath || 'assets/waterripplenormal.jpg');

            const loadWithFallback = async (primary, fallbacks = []) => {
                const paths = [primary, ...fallbacks];
                for (const p of paths) {
                    try {
                        return await this.loadTexture(p);
                    } catch (e) {
                        if (paths.indexOf(p) === paths.length - 1) throw e;
                        log(`WaterRippleEffect: Fallback from ${p} to next path`);
                    }
                }
            };

            let maskTexture, rippleTexture;
            try {
                [maskTexture, rippleTexture] = await Promise.all([
                    loadWithFallback(maskPath, ['assets/bg2WaterBW.png', 'assets/bg2WaterBW.webp'].map(f => basePath + f).filter(p => p !== maskPath)),
                    loadWithFallback(ripplePath, ['assets/waterripplenormal.jpg', 'assets/waterripplenormal.webp'].map(f => basePath + f).filter(p => p !== ripplePath))
                ]);
            } catch (textureError) {
                console.error('WaterRippleEffect: Failed to load textures. Check maskPath and ripplePath in config. Tried:', maskPath, ripplePath, textureError);
                throw textureError;
            }

            maskTexture.wrapS = maskTexture.wrapT = THREE.ClampToEdgeWrapping;
            rippleTexture.wrapS = rippleTexture.wrapT = THREE.RepeatWrapping;

            this.textures.push(maskTexture, rippleTexture);

            const rippleScale = config.rippleScale ?? 3.0;
            const rippleSpeed = config.rippleSpeed ?? 0.05;
            const refractionStrength = config.refractionStrength ?? 0.02;

            const effectUniforms = {
                map: { value: this.parallax.imageTexture },
                maskMap: { value: maskTexture },
                rippleNormal: { value: rippleTexture },
                time: { value: 0 },
                rippleScale: { value: rippleScale },
                rippleSpeed: { value: rippleSpeed },
                refractionStrength: { value: refractionStrength }
            };

            this.overlayMesh = this.createCoarseAreaEffectMesh(
                DEFAULT_FRAGMENT_SHADER,
                effectUniforms,
                { overlaySegments: config.overlaySegments ?? 256, depthWrite: false }
            );
            this.overlayMesh.position.z = 0.01;

            this.uniforms = effectUniforms;
            this.time = 0;
            this.isInitialized = true;

            log(`WaterRippleEffect: Water ripple initialized (overlaySegments: ${config.overlaySegments ?? 256})`);
        } catch (error) {
            console.error('WaterRippleEffect: Error during initialization:', error);
            throw error;
        }
    }

    getConfig() {
        if (!this.parallax?.config?.effects?.waterRipple) {
            return {};
        }
        return this.parallax.config.effects.waterRipple;
    }

    update(deltaTime) {
        if (!this.isInitialized || !this.overlayMesh) return;

        const frameDelta = Number.isFinite(deltaTime) && deltaTime > 0 ? deltaTime : 0.016;
        this.time += frameDelta;
        if (this.uniforms?.time) this.uniforms.time.value = this.time;

        this.syncWithParallaxMesh(this.overlayMesh);
        this.overlayMesh.position.z = 0.01;
    }

    updatePositionsForMeshTransform(meshTransform) {
        if (this.overlayMesh) this.syncWithParallaxMesh(this.overlayMesh);
    }

    cleanup() {
        this.overlayMesh = null;
        this.uniforms = null;
        super.cleanup();
    }
}

export default WaterRippleEffect;
