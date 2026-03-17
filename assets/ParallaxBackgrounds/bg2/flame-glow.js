// Flame Glow - Point effect for bg2: radial glow around the candle flame
// Single point source with warm yellow-orange halo, smooth falloff, optional flicker.
// Uses same overlay pattern as lantern-glow but for one flame position.

import BaseEffect from '../../../js/base-effect.js';
import * as THREE from 'https://unpkg.com/three@0.172.0/build/three.module.js';

const log = (...args) => {
    if (window.location.pathname.endsWith('test-effects.html')) {
        console.log(...args);
    }
};

const FRAGMENT_SHADER = `
    uniform float uTime;
    uniform vec3 uGlowColor;
    uniform float uGlowStrength;
    uniform float uOpacity;
    uniform float uRadius;
    uniform float uAspectRatio;
    uniform float uFlickerSpeed;
    uniform float uFlickerAmount;
    uniform float uFalloffPower;
    uniform vec2 uFlamePos;

    varying vec2 vUv;

    void main() {
        vec2 delta = vUv - uFlamePos;
        delta.x /= max(0.001, uAspectRatio);
        float d = length(delta);
        if (d >= uRadius) discard;

        float t = 1.0 - d / uRadius;
        t = pow(t, uFalloffPower);
        float flicker = 1.0 + uFlickerAmount * (
            sin(uTime * uFlickerSpeed) * 0.5 +
            sin(uTime * uFlickerSpeed * 1.7) * 0.3 +
            sin(uTime * uFlickerSpeed * 2.3) * 0.2
        );
        float alpha = t * uGlowStrength * uOpacity * flicker;
        alpha = max(0.0, min(1.0, alpha));
        gl_FragColor = vec4(uGlowColor, alpha);
    }
`;

class FlameGlowEffect extends BaseEffect {
    constructor(scene, camera, renderer, parallaxInstance) {
        super(scene, camera, renderer, parallaxInstance);
        this.effectType = 'point';
        this.time = 0;
    }

    async init() {
        log('FlameGlowEffect: Initializing');
        const config = this.getConfig();
        this.applyConfig(config);

        const uniforms = this.buildUniforms();
        this.overlayMesh = this.createCoarseAreaEffectMesh(
            FRAGMENT_SHADER,
            uniforms,
            {
                overlaySegments: config.overlaySegments ?? 16,
                depthWrite: false,
                depthTest: false,
                blending: THREE.AdditiveBlending
            }
        );
        this.overlayMesh.position.z = 0.02;
        this.uniforms = uniforms;
        this.isInitialized = true;
        log('FlameGlowEffect: Initialized');
    }

    buildUniforms() {
        return {
            uTime: { value: 0 },
            uGlowColor: { value: this.glowColor },
            uGlowStrength: { value: this.glowStrength },
            uOpacity: { value: this.opacity },
            uRadius: { value: this.radius },
            uAspectRatio: { value: this.aspectRatio },
            uFlickerSpeed: { value: this.flickerSpeed },
            uFlickerAmount: { value: this.flickerAmount },
            uFalloffPower: { value: this.falloffPower },
            uFlamePos: { value: new THREE.Vector2(this.positionX, this.positionY) }
        };
    }

    applyConfig(config) {
        this.positionX = config.position?.x ?? 0.15;
        this.positionY = config.position?.y ?? 0.25;
        this.glowColor = this.parseColor(config.glowColor ?? '0xffaa44');
        this.glowStrength = config.glowStrength ?? 0.35;
        this.opacity = config.opacity ?? 1.0;
        this.radius = config.radius ?? 0.12;
        this.aspectRatio = config.aspectRatio ?? 1.0;
        this.flickerSpeed = config.flickerSpeed ?? 5;
        this.flickerAmount = config.flickerAmount ?? 0.4;
        this.falloffPower = config.falloffPower ?? 2.0;
    }

    getConfig() {
        return this.parallax?.config?.effects?.flameGlow ?? {};
    }

    parseColor(hex) {
        if (typeof hex === 'string') {
            const s = hex.replace(/^0x|^#/, '');
            const n = parseInt(s, 16);
            if (!isNaN(n)) return new THREE.Color(n);
        }
        return new THREE.Color(0xffaa44);
    }

    update(deltaTime) {
        if (!this.isInitialized || !this.overlayMesh || !this.uniforms) return;
        this.time += deltaTime;
        this.uniforms.uTime.value = this.time;
        this.uniforms.uFlamePos.value.set(this.positionX, this.positionY);
        this.syncWithParallaxMesh(this.overlayMesh);
        this.overlayMesh.position.z = 0.02;
    }

    updateUniformsFromConfig(config) {
        if (!this.uniforms) return;
        this.applyConfig(config ?? this.getConfig());
        this.uniforms.uGlowColor.value.copy(this.glowColor);
        this.uniforms.uGlowStrength.value = this.glowStrength;
        this.uniforms.uOpacity.value = this.opacity;
        this.uniforms.uRadius.value = this.radius;
        this.uniforms.uAspectRatio.value = this.aspectRatio;
        this.uniforms.uFlickerSpeed.value = this.flickerSpeed;
        this.uniforms.uFlickerAmount.value = this.flickerAmount;
        this.uniforms.uFalloffPower.value = this.falloffPower;
        this.uniforms.uFlamePos.value.set(this.positionX, this.positionY);
    }

    cleanup() {
        this.overlayMesh = null;
        this.uniforms = null;
        super.cleanup();
    }
}

export default FlameGlowEffect;
