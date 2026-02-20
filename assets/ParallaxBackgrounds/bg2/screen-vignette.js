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
    uniform float uVignetteRoundness;
    uniform float uVignetteHorizontal;
    uniform float uVignetteVertical;

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
        float vignette = 1.0 - smoothstep(uVignetteInner, uVignetteOuter, d);
        float edge = 1.0 - vignette;
        float strength = mix(uVignetteStrength, uGlowStrength, uProximityBlend);
        vec3 col = mix(uVignetteColor, uGlowColor, uProximityBlend);
        float alpha = edge * strength;
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
        this.lanternPositionsUV = this.getLanternPositionsUV();
        const uniforms = {
            uVignetteStrength: { value: this.vignetteStrength },
            uVignetteColor: { value: this.vignetteColor },
            uVignetteInner: { value: this.vignetteInner },
            uVignetteOuter: { value: this.vignetteOuter },
            uVignetteRoundness: { value: this.vignetteRoundness },
            uVignetteHorizontal: { value: this.vignetteHorizontal },
            uVignetteVertical: { value: this.vignetteVertical },
            uGlowStrength: { value: this.glowStrengthMax },
            uGlowColor: { value: this.glowColor },
            uProximityBlend: { value: 0 }
        };
        this.overlayMesh = this.createScreenEffectMesh(
            DEFAULT_FRAGMENT_SHADER,
            uniforms,
            { distanceFromCamera: 0.5 }
        );
        this.setupMouseTracking();
        this.isInitialized = true;
        log(`ScreenVignetteEffect: Initialized with ${this.lanternPositionsUV.length} lanterns for proximity`);
    }

    getLanternPositionsUV() {
        const lanternConfig = this.parallax?.config?.effects?.lanterns;
        if (!lanternConfig?.lanterns || !Array.isArray(lanternConfig.lanterns)) return [];
        const positions = [];
        for (const l of lanternConfig.lanterns) {
            const name = l.name;
            if (this.parallax && !this.parallax.getFlag(`effects.lanterns.individual.${name}`)) continue;
            const x = l.position?.x ?? 0.5;
            const y = l.position?.y ?? 0.5;
            positions.push({ x, y });
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
        const u = localX / w + 0.5;
        const v = localY / h + 0.5;
        return new THREE.Vector2(u, v);
    }

    computeProximity(mouseUV) {
        const cfg = this.getConfig().lanternProximity ?? {};
        const radius = cfg.radius ?? 0.08;
        const enabled = cfg.enabled !== false;
        if (!enabled || this.lanternPositionsUV.length === 0) return 0;
        let minDist = 1e6;
        for (const p of this.lanternPositionsUV) {
            const dx = mouseUV.x - p.x;
            const dy = mouseUV.y - p.y;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < minDist) minDist = d;
        }
        if (minDist > radius) return 0;
        const t = 1 - minDist / radius;
        const v = Math.max(0, Math.min(1, t));
        return v * v * (3 - 2 * v);
    }

    applyConfig(config) {
        this.vignetteStrength = config.strength ?? 0.15;
        this.vignetteColor = this.parseColor(config.color ?? '0x000000');
        this.vignetteInner = config.inner ?? 0.25;
        this.vignetteOuter = config.outer ?? 1.2;
        this.vignetteRoundness = config.roundness ?? 1.0;
        this.vignetteHorizontal = config.horizontal ?? 1.0;
        this.vignetteVertical = config.vertical ?? 1.0;
        this.glowColor = this.parseColor(config.glowColor ?? '0xffdd66');
        this.glowStrengthMax = config.glowStrengthMax ?? 0.25;
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
        const mouseUV = this.getUVAtPixel(px, py);
        if (mouseUV && mouseUV.x >= 0 && mouseUV.x <= 1 && mouseUV.y >= 0 && mouseUV.y <= 1) {
            this.lastMouseUV.copy(mouseUV);
            const blend = this.computeProximity(mouseUV);
            this.proximityBlend += (blend - this.proximityBlend) * 0.12;
        } else {
            this.proximityBlend += (0 - this.proximityBlend) * 0.08;
        }
        u.uProximityBlend.value = this.proximityBlend;
    }

    updateUniformsFromConfig(config) {
        if (!this.overlayMesh?.material?.uniforms) return;
        const c = config ?? this.getConfig();
        this.applyConfig(c);
        this.lanternPositionsUV = this.getLanternPositionsUV();
        const u = this.overlayMesh.material.uniforms;
        u.uVignetteStrength.value = this.vignetteStrength;
        u.uVignetteColor.value.copy(this.vignetteColor);
        u.uVignetteInner.value = this.vignetteInner;
        u.uVignetteOuter.value = this.vignetteOuter;
        u.uVignetteRoundness.value = this.vignetteRoundness;
        u.uVignetteHorizontal.value = this.vignetteHorizontal;
        u.uVignetteVertical.value = this.vignetteVertical;
        u.uGlowColor.value.copy(this.glowColor);
    }

    cleanup() {
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
