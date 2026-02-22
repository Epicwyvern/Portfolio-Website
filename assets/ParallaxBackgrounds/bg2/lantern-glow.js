// Lantern Glow - Coarse overlay effect for bg2: soft glow + flicker only in lantern areas
// Uses 16x16 coarse mesh for performance; glow rendered only near lantern UV positions.
// No mouse tracking - flicker always plays where glow is visible.

import BaseEffect from '../../../js/base-effect.js';
import * as THREE from 'https://unpkg.com/three@0.172.0/build/three.module.js';

const log = (...args) => {
    if (window.location.pathname.endsWith('test-effects.html')) {
        console.log(...args);
    }
};

const MAX_LANTERNS = 16;

const DEFAULT_FRAGMENT_SHADER = `
    uniform float uTime;
    uniform vec3 uGlowColor;
    uniform float uGlowStrength;
    uniform float uRadius;
    uniform float uFlickerSpeed;
    uniform float uFlickerAmount;
    uniform int uLanternCount;
    uniform vec2 uLanternPos0;
    uniform vec2 uLanternPos1;
    uniform vec2 uLanternPos2;
    uniform vec2 uLanternPos3;
    uniform vec2 uLanternPos4;
    uniform vec2 uLanternPos5;
    uniform vec2 uLanternPos6;
    uniform vec2 uLanternPos7;
    uniform vec2 uLanternPos8;
    uniform vec2 uLanternPos9;
    uniform vec2 uLanternPos10;
    uniform vec2 uLanternPos11;
    uniform vec2 uLanternPos12;
    uniform vec2 uLanternPos13;
    uniform vec2 uLanternPos14;
    uniform vec2 uLanternPos15;

    varying vec2 vUv;

    void main() {
        float minDist = 2.0;
        for (int i = 0; i < 16; i++) {
            if (i >= uLanternCount) break;
            vec2 pos;
            if (i == 0) pos = uLanternPos0;
            else if (i == 1) pos = uLanternPos1;
            else if (i == 2) pos = uLanternPos2;
            else if (i == 3) pos = uLanternPos3;
            else if (i == 4) pos = uLanternPos4;
            else if (i == 5) pos = uLanternPos5;
            else if (i == 6) pos = uLanternPos6;
            else if (i == 7) pos = uLanternPos7;
            else if (i == 8) pos = uLanternPos8;
            else if (i == 9) pos = uLanternPos9;
            else if (i == 10) pos = uLanternPos10;
            else if (i == 11) pos = uLanternPos11;
            else if (i == 12) pos = uLanternPos12;
            else if (i == 13) pos = uLanternPos13;
            else if (i == 14) pos = uLanternPos14;
            else pos = uLanternPos15;
            float d = length(vUv - pos);
            minDist = min(minDist, d);
        }
        if (minDist >= uRadius) discard;

        float t = 1.0 - minDist / uRadius;
        t = t * t;
        float flicker = 1.0 + uFlickerAmount * (
            sin(uTime * uFlickerSpeed) * 0.5 +
            sin(uTime * uFlickerSpeed * 1.7) * 0.3 +
            sin(uTime * uFlickerSpeed * 2.3) * 0.2
        );
        float alpha = t * uGlowStrength * flicker;
        alpha = max(0.0, min(1.0, alpha));
        gl_FragColor = vec4(uGlowColor, alpha);
    }
`;

class LanternGlowEffect extends BaseEffect {
    constructor(scene, camera, renderer, parallaxInstance) {
        super(scene, camera, renderer, parallaxInstance);
        this.effectType = 'area';
        this.time = 0;
    }

    async init() {
        log('LanternGlowEffect: Initializing');
        const config = this.getConfig();
        this.applyConfig(config);
        this._refreshEnabledLanternConfigs();
        this._unsubLanternChange = this.parallax?.onLanternIndividualChange?.(
            () => this._refreshEnabledLanternConfigs()
        );
        const positions = this._enabledLanternConfigs ?? [];
        if (positions.length === 0) {
            log('LanternGlowEffect: No lanterns enabled, skipping overlay');
            this.isInitialized = true;
            return;
        }

        const uniforms = this.buildUniforms();
        this.overlayMesh = this.createCoarseAreaEffectMesh(
            DEFAULT_FRAGMENT_SHADER,
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
        log(`LanternGlowEffect: Initialized with ${positions.length} lanterns (16x${config.overlaySegments ?? 16} grid)`);
    }

    _refreshEnabledLanternConfigs() {
        this._enabledLanternConfigs = [];
        const cfg = this.parallax?.config?.effects?.lanterns;
        if (!this.parallax || !cfg?.lanterns) return;
        for (const l of cfg.lanterns) {
            const name = l.name;
            if (this.parallax.getFlag(`effects.lanterns.individual.${name}`) === false) continue;
            const x = l.position?.x ?? 0.5;
            const y = l.position?.y ?? 0.5;
            this._enabledLanternConfigs.push({ x, y });
            if (this._enabledLanternConfigs.length >= MAX_LANTERNS) break;
        }
    }

    buildUniforms() {
        const u = {
            uTime: { value: 0 },
            uGlowColor: { value: this.glowColor },
            uGlowStrength: { value: this.glowStrength },
            uRadius: { value: this.radius },
            uFlickerSpeed: { value: this.flickerSpeed },
            uFlickerAmount: { value: this.flickerAmount },
            uLanternCount: { value: 0 }
        };
        for (let i = 0; i < MAX_LANTERNS; i++) {
            u[`uLanternPos${i}`] = { value: new THREE.Vector2(-10, -10) };
        }
        return u;
    }

    applyConfig(config) {
        this.glowColor = this.parseColor(config.glowColor ?? '0xffdd66');
        this.glowStrength = config.glowStrength ?? 0.3;
        this.radius = config.radius ?? 0.12;
        this.flickerSpeed = config.flickerSpeed ?? 8;
        this.flickerAmount = config.flickerAmount ?? 0.35;
    }

    getConfig() {
        return this.parallax?.config?.effects?.lanternGlow ?? {};
    }

    parseColor(hex) {
        if (typeof hex === 'string' && hex.startsWith('0x')) {
            const n = parseInt(hex.slice(2), 16);
            return new THREE.Color(n);
        }
        return new THREE.Color(0xffdd66);
    }

    update(deltaTime) {
        if (!this.isInitialized || !this.overlayMesh || !this.uniforms) return;
        this.time += deltaTime;
        this.uniforms.uTime.value = this.time;
        const positions = this._enabledLanternConfigs ?? [];
        const count = Math.min(positions.length, MAX_LANTERNS);
        this.uniforms.uLanternCount.value = count;
        for (let i = 0; i < MAX_LANTERNS; i++) {
            const u = this.uniforms[`uLanternPos${i}`];
            if (i < count) {
                const p = positions[i];
                u.value.set(p.x, p.y);
            } else {
                u.value.set(-10, -10);
            }
        }
        this.syncWithParallaxMesh(this.overlayMesh);
        this.overlayMesh.position.z = 0.02;
    }

    updateUniformsFromConfig(config) {
        if (!this.uniforms) return;
        this.applyConfig(config ?? this.getConfig());
        this.uniforms.uGlowColor.value.copy(this.glowColor);
        this.uniforms.uGlowStrength.value = this.glowStrength;
        this.uniforms.uRadius.value = this.radius;
        this.uniforms.uFlickerSpeed.value = this.flickerSpeed;
        this.uniforms.uFlickerAmount.value = this.flickerAmount;
    }

    cleanup() {
        if (typeof this._unsubLanternChange === 'function') {
            this._unsubLanternChange();
            this._unsubLanternChange = null;
        }
        this.overlayMesh = null;
        this.uniforms = null;
        super.cleanup();
    }
}

export default LanternGlowEffect;
