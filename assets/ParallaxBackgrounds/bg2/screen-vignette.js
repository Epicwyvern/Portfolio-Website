// Screen Vignette - Viewport-level vignette effect for bg2
// Operates in screen space; does not move with parallax.
// Lantern proximity: edge effect morphs from vignette (dark) to glow (warm) as mouse approaches lanterns.

import BaseEffect from '../../../js/base-effect.js';
import * as THREE from 'https://unpkg.com/three@0.172.0/build/three.module.js';

const log = (...args) => {
    if (window.location.pathname.endsWith('test-effects.html')) {
        console.log(...args);
    }
};

const DEFAULT_FRAGMENT_SHADER = `
    uniform vec2 uResolution;
    uniform float uTime;
    uniform float uVignetteStrength;
    uniform vec3 uVignetteColor;
    uniform float uGlowStrength;
    uniform vec3 uGlowColor;
    uniform float uProximityBlend;
    uniform float uVignetteInner;
    uniform float uVignetteOuter;
    uniform float uGlowInner;
    uniform float uGlowOuter;
    uniform float uVignetteRoundness;
    uniform float uVignetteHorizontal;
    uniform float uVignetteVertical;
    uniform float uFlickerSpeed;
    uniform float uFlickerAmount;

    varying vec2 vUv;

    void main() {
        vec2 uv = vUv;
        vec2 ct = (uv - 0.5) * 2.0;
        float aspect = uResolution.x / uResolution.y;
        vec2 ctAspect = ct;
        ctAspect.x *= mix(1.0, 1.0 / aspect, uVignetteRoundness);
        ctAspect.x /= max(0.01, uVignetteHorizontal);
        ctAspect.y /= max(0.01, uVignetteVertical);
        float d = length(ctAspect);
        float innerVal = mix(uVignetteInner, uGlowInner, uProximityBlend);
        float outerVal = mix(uVignetteOuter, uGlowOuter, uProximityBlend);
        float vignette = 1.0 - smoothstep(innerVal, outerVal, d);
        float edge = 1.0 - vignette;
        float strength = mix(uVignetteStrength, uGlowStrength, uProximityBlend);
        vec3 col = mix(uVignetteColor, uGlowColor, uProximityBlend);
        float alpha = edge * strength;
        float flicker = 1.0 + uFlickerAmount * (
            sin(uTime * uFlickerSpeed) * 0.5 +
            sin(uTime * uFlickerSpeed * 1.7) * 0.3 +
            sin(uTime * uFlickerSpeed * 2.3) * 0.2
        );
        alpha *= mix(1.0, flicker, uProximityBlend);
        gl_FragColor = vec4(col, alpha);
    }
`;

class ScreenVignetteEffect extends BaseEffect {
    constructor(scene, camera, renderer, parallaxInstance) {
        super(scene, camera, renderer, parallaxInstance);
        this.effectType = 'screen';
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this._tmpIntersect = new THREE.Vector3();
        this.mousePixelX = -1;
        this.mousePixelY = -1;
        this.lastMouseUV = new THREE.Vector2(-1, -1);
        this.proximityBlend = 0;
    }

    async init() {
        log('ScreenVignetteEffect: Initializing');
        const config = this.getConfig();
        this.applyConfig(config);
        const uniforms = {
            uVignetteStrength: { value: this.vignetteStrength },
            uVignetteColor: { value: this.vignetteColor },
            uVignetteInner: { value: this.vignetteInner },
            uVignetteOuter: { value: this.vignetteOuter },
            uGlowInner: { value: this.glowInner },
            uGlowOuter: { value: this.glowOuter },
            uVignetteRoundness: { value: this.vignetteRoundness },
            uVignetteHorizontal: { value: this.vignetteHorizontal },
            uVignetteVertical: { value: this.vignetteVertical },
            uGlowStrength: { value: this.glowStrengthMax },
            uGlowColor: { value: this.glowColor },
            uProximityBlend: { value: 0 },
            uFlickerSpeed: { value: this.flickerSpeed },
            uFlickerAmount: { value: this.flickerAmount }
        };
        this.overlayMesh = this.createScreenEffectMesh(
            DEFAULT_FRAGMENT_SHADER,
            uniforms,
            { distanceFromCamera: 0.5 }
        );
        this.setupMouseTracking();
        this._lanternEnabledAt = {};
        this._refreshEnabledLanternConfigs();
        this._unsubLanternChange = this.parallax?.onLanternIndividualChange?.((name, isNowEnabled) => {
            if (isNowEnabled) this._lanternEnabledAt[name] = (performance.now() / 1000);
            this._refreshEnabledLanternConfigs();
        });
        this.isInitialized = true;
        log(`ScreenVignetteEffect: Initialized with ${this._enabledLanternConfigs.length} lanterns for proximity`);
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
            const z = l.position?.z ?? 0.5;
            this._enabledLanternConfigs.push({ name, x, y, z });
        }
    }

    getLanternPositionsUV() {
        const configs = this._enabledLanternConfigs ?? [];
        return configs.map(c => ({ x: c.x, y: c.y }));
    }

    _getLanternFadeFactor(name) {
        const dur = this.glowFadeInDuration ?? 0;
        if (dur <= 0) return 1;
        const at = this._lanternEnabledAt?.[name];
        if (at == null) return 1;
        const elapsed = (performance.now() / 1000) - at;
        return Math.min(1, elapsed / dur);
    }

    /**
     * Returns lantern world positions for screen-space proximity. Uses cached enabled configs + mesh transform.
     */
    getLanternPositionsWorld() {
        const t = this.parallax?.meshTransform;
        const configs = this._enabledLanternConfigs ?? [];
        if (!t || configs.length === 0) return [];
        const mw = t.baseGeometrySize?.width * t.scale ?? 1;
        const mh = t.baseGeometrySize?.height * t.scale ?? 1;
        const positions = [];
        for (const c of configs) {
            const wx = (c.x - 0.5) * mw + t.position.x;
            const wy = (c.y - 0.5) * mh + t.position.y;
            positions.push(new THREE.Vector3(wx, wy, c.z));
        }
        return positions;
    }

    setupMouseTracking() {
        const canvas = this.parallax?.canvas;
        if (!canvas) return;
        const handleMove = (clientX, clientY) => {
            const rect = canvas.getBoundingClientRect();
            this.mousePixelX = clientX - rect.left;
            this.mousePixelY = clientY - rect.top;
        };
        const onMouse = (e) => handleMove(e.clientX, e.clientY);
        const onTouch = (e) => {
            if (e.touches.length > 0) handleMove(e.touches[0].clientX, e.touches[0].clientY);
        };
        canvas.addEventListener('mousemove', onMouse);
        canvas.addEventListener('touchmove', onTouch, { passive: true });
        this._mouseHandler = onMouse;
        this._touchHandler = onTouch;
    }

    getUVAtPixel(pixelX, pixelY) {
        const canvas = this.parallax?.canvas;
        const t = this.parallax?.meshTransform;
        if (!canvas || !this.camera || !t) return null;
        const rect = canvas.getBoundingClientRect();
        this.mouse.x = (pixelX / rect.width) * 2 - 1;
        this.mouse.y = -((pixelY / rect.height) * 2 - 1);
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const { origin, direction } = this.raycaster.ray;
        if (Math.abs(direction.z) < 1e-6) return null;
        const d = -origin.z / direction.z;
        this._tmpIntersect.set(
            origin.x + direction.x * d,
            origin.y + direction.y * d,
            0
        );
        const scale = t.scale;
        const w = t.baseGeometrySize?.width ?? 1;
        const h = t.baseGeometrySize?.height ?? 1;
        const localX = (this._tmpIntersect.x - t.position.x) / scale;
        const localY = (this._tmpIntersect.y - t.position.y) / scale;
        let u = localX / w + 0.5;
        let v = localY / h + 0.5;
        const offset = this.uvOffset ?? { u: 0, v: 0 };
        u += offset.u ?? 0;
        v += offset.v ?? 0;
        return new THREE.Vector2(u, v);
    }

    /**
     * Screen-space proximity: project lantern world positions to pixels, compare to mouse.
     * Fixes depth/position offset (lanterns at different z or x,y appear correctly).
     */
    computeProximityScreenSpace(mousePixelX, mousePixelY) {
        const cfg = this.getConfig().lanternProximity ?? {};
        const enabled = cfg.enabled !== false;
        if (!enabled || !this.camera) return 0;
        const configs = this._enabledLanternConfigs ?? [];
        const worldPositions = this.getLanternPositionsWorld();
        if (configs.length === 0 || worldPositions.length === 0) return 0;
        const canvas = this.parallax?.canvas;
        if (!canvas) return 0;
        const rect = canvas.getBoundingClientRect();
        const radiusPixels = (cfg.radiusPixels != null ? cfg.radiusPixels : null)
            ?? (cfg.radius ?? 0.08) * Math.min(rect.width, rect.height);
        const _proj = this._projVec ?? (this._projVec = new THREE.Vector3());
        let maxContrib = 0;
        for (let i = 0; i < worldPositions.length; i++) {
            const w = worldPositions[i];
            const c = configs[i];
            const fade = this._getLanternFadeFactor(c?.name);
            if (fade <= 0) continue;
            _proj.copy(w).project(this.camera);
            const px = (_proj.x * 0.5 + 0.5) * rect.width;
            const py = (0.5 - _proj.y * 0.5) * rect.height;
            const dx = mousePixelX - px;
            const dy = mousePixelY - py;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d > radiusPixels) continue;
            const t = 1 - d / radiusPixels;
            const v = Math.max(0, Math.min(1, t));
            const contrib = v * v * (3 - 2 * v) * fade;
            if (contrib > maxContrib) maxContrib = contrib;
        }
        return maxContrib;
    }

    applyConfig(config) {
        this.vignetteStrength = config.strength ?? 0.15;
        this.vignetteColor = this.parseColor(config.color ?? '0x000000');
        this.vignetteInner = config.inner ?? 0.25;
        this.vignetteOuter = config.outer ?? 1.2;
        this.glowInner = config.glowInner ?? 0.85;
        this.glowOuter = config.glowOuter ?? 1.4;
        this.vignetteRoundness = config.roundness ?? 1.0;
        this.vignetteHorizontal = config.horizontal ?? 1.0;
        this.vignetteVertical = config.vertical ?? 1.0;
        this.glowColor = this.parseColor(config.glowColor ?? '0xffdd66');
        this.glowStrengthMax = config.glowStrengthMax ?? 0.25;
        this.glowFadeInDuration = this.parallax?.config?.effects?.lanterns?.glowFadeInDuration ?? 2;
        this.uvOffset = config.uvOffset ?? { u: 0, v: 0 };
        this.flickerSpeed = config.flickerSpeed ?? 8;
        this.flickerAmount = config.flickerAmount ?? 0.35;
    }

    getConfig() {
        if (!this.parallax?.config?.effects?.screenVignette) {
            return {};
        }
        return this.parallax.config.effects.screenVignette;
    }

    parseColor(hex) {
        if (typeof hex === 'string' && hex.startsWith('0x')) {
            const n = parseInt(hex.slice(2), 16);
            return new THREE.Color(n);
        }
        return new THREE.Color(0x000000);
    }

    update(deltaTime) {
        if (!this.isInitialized || !this.overlayMesh?.material?.uniforms) return;
        const u = this.overlayMesh.material.uniforms;
        if (u.uTime) u.uTime.value += deltaTime;

        let px = this.mousePixelX;
        let py = this.mousePixelY;
        if (px < 0 || py < 0) {
            const canvas = this.parallax?.canvas;
            if (canvas) {
                const rect = canvas.getBoundingClientRect();
                px = rect.width * 0.5;
                py = rect.height * 0.5;
            }
        }
        const blend = this.computeProximityScreenSpace(px, py);
        this.proximityBlend += (blend - this.proximityBlend) * 0.12;
        u.uProximityBlend.value = this.proximityBlend;
    }

    updateUniformsFromConfig(config) {
        if (!this.overlayMesh?.material?.uniforms) return;
        const c = config ?? this.getConfig();
        this.applyConfig(c);
        const u = this.overlayMesh.material.uniforms;
        u.uVignetteStrength.value = this.vignetteStrength;
        u.uVignetteColor.value.copy(this.vignetteColor);
        u.uVignetteInner.value = this.vignetteInner;
        u.uVignetteOuter.value = this.vignetteOuter;
        if (u.uGlowInner) u.uGlowInner.value = this.glowInner;
        if (u.uGlowOuter) u.uGlowOuter.value = this.glowOuter;
        u.uVignetteRoundness.value = this.vignetteRoundness;
        u.uVignetteHorizontal.value = this.vignetteHorizontal;
        u.uVignetteVertical.value = this.vignetteVertical;
        u.uGlowColor.value.copy(this.glowColor);
        if (u.uFlickerSpeed) u.uFlickerSpeed.value = this.flickerSpeed;
        if (u.uFlickerAmount) u.uFlickerAmount.value = this.flickerAmount;
    }

    cleanup() {
        if (typeof this._unsubLanternChange === 'function') {
            this._unsubLanternChange();
            this._unsubLanternChange = null;
        }
        const canvas = this.parallax?.canvas;
        if (canvas && this._mouseHandler) {
            canvas.removeEventListener('mousemove', this._mouseHandler);
        }
        if (canvas && this._touchHandler) {
            canvas.removeEventListener('touchmove', this._touchHandler);
        }
        super.cleanup();
    }
}

export default ScreenVignetteEffect;
