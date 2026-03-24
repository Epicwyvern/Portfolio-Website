// Screen Vignette - Viewport-level vignette effect for bg2
// Operates in screen space; does not move with parallax.
// Lantern proximity: edge effect morphs from vignette (dark) to glow (warm) as mouse approaches lanterns.
// Renders to half-resolution RT for ~75% fragment cost reduction.

import BaseEffect from '../../../js/base-effect.js';
import * as THREE from 'https://unpkg.com/three@0.172.0/build/three.module.js';
import { computeCandleProximityMetrics } from './candle-flame-screen.js';

const MAX_DIRECTIONAL_GLOWS = 8;
const COMPOSITE_FRAGMENT_SHADER = `
    uniform sampler2D uVignetteTexture;
    varying vec2 vUv;
    void main() {
        gl_FragColor = texture2D(uVignetteTexture, vUv);
    }
`;

const log = (...args) => {
    if (window.location.pathname.endsWith('test-effects.html')) {
        console.log(...args);
    }
};

const DEFAULT_FRAGMENT_SHADER = `
    const int MAX_DIRECTIONAL_GLOWS = ${MAX_DIRECTIONAL_GLOWS};

    uniform vec2 uResolution;
    uniform float uTime;
    uniform float uVignetteStrength;
    uniform vec3 uVignetteColor;
    uniform float uGlowStrength;
    uniform vec3 uGlowColor;
    uniform float uInnerBlend;
    uniform float uVignetteInner;
    uniform float uVignetteOuter;
    uniform float uGlowInner;
    uniform float uGlowOuter;
    uniform float uVignetteRoundness;
    uniform float uVignetteHorizontal;
    uniform float uVignetteVertical;
    uniform float uFlickerSpeed;
    uniform float uFlickerAmount;
    uniform int uDirectionalGlowCount;
    uniform vec4 uDirectionalGlowData[MAX_DIRECTIONAL_GLOWS]; // x, y, strength, size
    uniform float uInnerFogStrength;
    uniform float uInnerRimStrength;
    uniform float uInnerRimThickness;
    uniform float uFogNoiseScale;
    uniform float uFogWarpAmount;
    uniform float uFogDriftSpeed;
    uniform float uFogDriftX;
    uniform float uFogDriftY;
    uniform float uCandleVignetteMul;

    varying vec2 vUv;

    float hash12(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
    }

    float noise2d(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        float a = hash12(i + vec2(0.0, 0.0));
        float b = hash12(i + vec2(1.0, 0.0));
        float c = hash12(i + vec2(0.0, 1.0));
        float dN = hash12(i + vec2(1.0, 1.0));
        return mix(mix(a, b, u.x), mix(c, dN, u.x), u.y);
    }

    float fbm(vec2 p) {
        float value = 0.0;
        float amp = 0.5;
        value += amp * noise2d(p); p *= 2.07; amp *= 0.5;
        value += amp * noise2d(p); p *= 2.03; amp *= 0.5;
        value += amp * noise2d(p);
        return value;
    }

    void main() {
        vec2 uv = vUv;
        vec2 ct = (uv - 0.5) * 2.0;
        float aspect = uResolution.x / uResolution.y;
        vec2 ctAspect = ct;
        ctAspect.x *= mix(1.0, 1.0 / aspect, uVignetteRoundness);
        ctAspect.x /= max(0.01, uVignetteHorizontal);
        ctAspect.y /= max(0.01, uVignetteVertical);
        float d = length(ctAspect);

        // Skip expensive center work when no edge contribution is possible.
        float minInner = min(uVignetteInner, uGlowInner);
        float centerSafeMargin = abs(uFogWarpAmount) + 0.03;
        if (d < (minInner - centerSafeMargin)) {
            gl_FragColor = vec4(0.0);
            return;
        }

        vec2 fogDrift = vec2(uFogDriftX, uFogDriftY);
        float driftLen = length(fogDrift);
        if (driftLen < 0.001) {
            fogDrift = vec2(1.0, 0.35);
            driftLen = length(fogDrift);
        }
        fogDrift /= driftLen;
        vec2 baseNoiseCoord = uv * max(0.1, uFogNoiseScale) + fogDrift * (uTime * uFogDriftSpeed * 0.1);
        // Isotropic-only warp to avoid directional (horizontal/vertical/diagonal) line artifacts.
        float fogNoiseMain = fbm(baseNoiseCoord);
        float fogNoiseDetail = noise2d(baseNoiseCoord * 1.91 + vec2(1.7, 6.3));
        float fogNoise = mix(fogNoiseMain, fogNoiseDetail, 0.12);
        float fogWarp = (fogNoise - 0.5) * 2.0 * uFogWarpAmount;
        // Very small dither helps hide subtle smoothstep banding/line artifacts.
        float dither = (hash12(uv * uResolution + vec2(uTime * 17.3, uTime * 9.1)) - 0.5) / 255.0;
        float dWarped = d + fogWarp + dither;

        float vignette = 1.0 - smoothstep(uVignetteInner, uVignetteOuter, dWarped);
        float edge = 1.0 - vignette;
        float glowBand = smoothstep(uGlowInner, uGlowOuter, dWarped);
        float edgeGlowMask = max(edge, glowBand);

        if (edgeGlowMask <= 0.0001) {
            gl_FragColor = vec4(0.0);
            return;
        }

        float flicker = 1.0 + uFlickerAmount * (
            sin(uTime * uFlickerSpeed) * 0.5 +
            sin(uTime * uFlickerSpeed * 1.7) * 0.3 +
            sin(uTime * uFlickerSpeed * 2.3) * 0.2
        );

        float directionalGlow = 0.0;
        if (uDirectionalGlowCount > 0) {
            vec2 uvVec = uv - vec2(0.5);
            vec2 uvDir = normalize(uvVec + vec2(0.00001));
            float edgeBand = edgeGlowMask;
            for (int i = 0; i < MAX_DIRECTIONAL_GLOWS; i++) {
                if (i >= uDirectionalGlowCount) break;
                vec4 glow = uDirectionalGlowData[i];
                vec2 center = glow.xy;
                float strength = glow.z;
                float size = clamp(glow.w, 0.0, 1.0);

                vec2 sourceDir = normalize((center - vec2(0.5)) + vec2(0.00001));
                float aligned = max(0.0, dot(uvDir, sourceDir));
                float angular = pow(aligned, mix(20.0, 3.0, size));

                vec2 edgeAnchor = vec2(0.5) + sourceDir * 0.48;
                float anchorDist = distance(uv, edgeAnchor);
                float anchorRadius = mix(0.20, 0.58, size);
                float anchorMask = 1.0 - smoothstep(anchorRadius, anchorRadius + 0.35, anchorDist);
                directionalGlow += angular * edgeBand * anchorMask * strength;
            }
        }
        directionalGlow = clamp(directionalGlow, 0.0, 1.0) * mix(1.0, flicker, 0.28);
        directionalGlow *= (1.0 - clamp(uInnerBlend, 0.0, 1.0) * 0.92);

        float fullEdgeGlow = 0.0;
        if (uInnerBlend > 0.001) {
            float angle = atan(ctAspect.y, ctAspect.x);
            float naturalVariation =
                0.72 +
                0.16 * sin(angle * 3.0 + uTime * 0.7) +
                0.12 * sin(angle * 6.0 - uTime * 1.25) +
                0.10 * sin(angle * 11.0 + uTime * 0.35);
            naturalVariation = clamp(naturalVariation, 0.45, 1.15);

            float fogLayer = smoothstep(uGlowInner - 0.14, uGlowOuter + 0.24, dWarped);
            float rimStart = uGlowInner + 0.02;
            float rimEnd = rimStart + max(0.01, uInnerRimThickness);
            float rimTail = rimEnd + max(0.03, uInnerRimThickness * 1.8);
            float rimLayer = smoothstep(rimStart, rimEnd, dWarped) * (1.0 - smoothstep(rimEnd, rimTail, dWarped));
            float innerShape = (fogLayer * uInnerFogStrength) + (rimLayer * uInnerRimStrength);

            fullEdgeGlow = edgeGlowMask * uGlowStrength * uInnerBlend * naturalVariation * innerShape;
            fullEdgeGlow *= mix(1.0, flicker, clamp(uInnerBlend, 0.0, 1.0));
        }

        float baseVignetteAlpha =
            edge * uVignetteStrength * (1.0 - uInnerBlend * 0.9) * clamp(uCandleVignetteMul, 0.0, 1.0);
        float glowAlpha = directionalGlow + fullEdgeGlow;
        float totalAlpha = clamp(baseVignetteAlpha + glowAlpha, 0.0, 1.0);

        vec3 combinedColor = vec3(0.0);
        if (totalAlpha > 0.0001) {
            combinedColor = (
                uVignetteColor * baseVignetteAlpha +
                uGlowColor * glowAlpha
            ) / totalAlpha;
        }

        gl_FragColor = vec4(combinedColor, totalAlpha);
    }
`;

class ScreenVignetteEffect extends BaseEffect {
    constructor(scene, camera, renderer, parallaxInstance) {
        super(scene, camera, renderer, parallaxInstance);
        this.effectType = 'screen';
        this.mousePixelX = -1;
        this.mousePixelY = -1;
        this.innerBlend = 0;
        this.candleVignetteMul = 1;
        this._directionalGlowData = Array.from(
            { length: MAX_DIRECTIONAL_GLOWS },
            () => new THREE.Vector4(0, 0, 0, 0)
        );
        this._frameCounter = 0;
        this._cachedRect = null;
        this._cachedRectFrame = -1;
        this._zeroDirectionalGlowData();
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
            uInnerBlend: { value: 0 },
            uDirectionalGlowCount: { value: 0 },
            uDirectionalGlowData: { value: this._directionalGlowData },
            uFlickerSpeed: { value: this.flickerSpeed },
            uFlickerAmount: { value: this.flickerAmount },
            uInnerFogStrength: { value: this.innerFogStrength },
            uInnerRimStrength: { value: this.innerRimStrength },
            uInnerRimThickness: { value: this.innerRimThickness },
            uFogNoiseScale: { value: this.fogNoiseScale },
            uFogWarpAmount: { value: this.fogWarpAmount },
            uFogDriftSpeed: { value: this.fogDriftSpeed },
            uFogDriftX: { value: this.fogDriftX },
            uFogDriftY: { value: this.fogDriftY },
            uCandleVignetteMul: { value: 1 }
        };
        this.overlayMesh = this.createScreenEffectMesh(
            DEFAULT_FRAGMENT_SHADER,
            uniforms,
            { distanceFromCamera: 0.5, syncResolutionUniform: false }
        );
        this.scene.remove(this.overlayMesh);
        this.vignetteScene = new THREE.Scene();
        this.vignetteScene.add(this.overlayMesh);

        const scale = this.halfResScale;
        const w = Math.max(1, Math.floor(this.renderer.domElement.width * scale));
        const h = Math.max(1, Math.floor(this.renderer.domElement.height * scale));
        this.vignetteRT = new THREE.WebGLRenderTarget(w, h, {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
            type: THREE.UnsignedByteType,
            stencilBuffer: false,
            depthBuffer: false
        });
        this.overlayMesh.material.uniforms.uResolution.value.set(w, h);

        const compositeMaterial = new THREE.ShaderMaterial({
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: COMPOSITE_FRAGMENT_SHADER,
            uniforms: { uVignetteTexture: { value: this.vignetteRT.texture } },
            transparent: true,
            depthTest: false,
            depthWrite: false,
            side: THREE.FrontSide
        });
        this.compositeMesh = this._createCompositeScreenQuad(new THREE.PlaneGeometry(1, 1), compositeMaterial);
        this.scene.add(this.compositeMesh);
        this.meshes.push(this.compositeMesh);
        this.materials.push(compositeMaterial);

        // RT + uResolution (half-res): same shared canvas ResizeObserver as createScreenEffectMesh (see BaseEffect).
        this._unsubVignetteCanvasResize = this.onRendererCanvasResize(() => {
            this._invalidateRectCache();
            this._resizeVignetteRT();
        });
        this._resizeVignetteRT();

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

    _zeroDirectionalGlowData() {
        for (let i = 0; i < this._directionalGlowData.length; i++) {
            this._directionalGlowData[i].set(0, 0, 0, 0);
        }
    }

    _smoothstep01(x) {
        const v = Math.max(0, Math.min(1, x));
        return v * v * (3 - 2 * v);
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

    setupMouseTracking() {
        const canvas = this.parallax?.canvas;
        if (!canvas) return;
        const handleMove = (clientX, clientY) => {
            const rect = this._getCanvasRect();
            if (!rect) return;
            this.mousePixelX = clientX - rect.left;
            this.mousePixelY = clientY - rect.top;
        };
        const onMouse = (e) => handleMove(e.clientX, e.clientY);
        const onTouch = (e) => {
            if (e.touches.length > 0) handleMove(e.touches[0].clientX, e.touches[0].clientY);
        };
        canvas.addEventListener('mousemove', onMouse);
        canvas.addEventListener('touchmove', onTouch, { passive: true });
        this._resizeHandler = () => this._invalidateRectCache();
        this._scrollHandler = () => this._invalidateRectCache();
        window.addEventListener('resize', this._resizeHandler);
        window.addEventListener('scroll', this._scrollHandler, { passive: true });
        this._mouseHandler = onMouse;
        this._touchHandler = onTouch;
    }

    _invalidateRectCache() {
        this._cachedRectFrame = -1;
    }

    _getCanvasRect() {
        if (this._cachedRectFrame === this._frameCounter) return this._cachedRect;
        const canvas = this.parallax?.canvas;
        if (!canvas) return null;
        this._cachedRect = canvas.getBoundingClientRect();
        this._cachedRectFrame = this._frameCounter;
        return this._cachedRect;
    }

    _getCandleFlameScreenConfig() {
        return this.parallax?.config?.effects?.candleFlameScreen ?? {};
    }

    /**
     * 0 = vignette dark fully suppressed inside candle UV quad. 1 = full dark vignette beyond quad outer band.
     * Uses same geometry as candle flame screen (`computeCandleProximityMetrics`).
     */
    computeCandleVignetteTarget(mousePixelX, mousePixelY) {
        const candleCfg = this._getCandleFlameScreenConfig();
        const vf = candleCfg.vignetteFade ?? {};
        if (vf.enabled === false || candleCfg.enabled === false) return 1;

        const rect = this._getCanvasRect();
        if (!rect || !this.camera) return 1;
        const t = this.parallax?.meshTransform;
        if (!t) return 1;

        const scratch =
            this._candleVignetteScratch ??
            (this._candleVignetteScratch = {
                proj: this._projVec ?? (this._projVec = new THREE.Vector3()),
                wpos: this._candleFlameWorld ?? (this._candleFlameWorld = new THREE.Vector3()),
                uvDisp: this._candleFlameDisp ?? (this._candleFlameDisp = new THREE.Vector2())
            });
        const { vignetteTarget } = computeCandleProximityMetrics(
            this.parallax,
            this.camera,
            candleCfg,
            mousePixelX,
            mousePixelY,
            rect,
            scratch
        );
        return vignetteTarget;
    }

    /**
     * Computes per-lantern directional edge glows and full-edge blend target.
     * Outer radius drives directional edge glow; inner radius drives full-edge glow takeover.
     */
    computeGlowState(mousePixelX, mousePixelY) {
        const cfg = this.getConfig().lanternProximity ?? {};
        const enabled = cfg.enabled !== false;
        if (!enabled || !this.camera) {
            return { directionalGlows: [], innerBlendTarget: 0 };
        }
        const configs = this._enabledLanternConfigs ?? [];
        const t = this.parallax?.meshTransform;
        if (!t || configs.length === 0) {
            return { directionalGlows: [], innerBlendTarget: 0 };
        }
        const rect = this._getCanvasRect();
        if (!rect) return { directionalGlows: [], innerBlendTarget: 0 };
        const mw = t.baseGeometrySize?.width * t.scale ?? 1;
        const mh = t.baseGeometrySize?.height * t.scale ?? 1;

        const minDim = Math.min(rect.width, rect.height);
        const outerRadiusPixels = (cfg.outerRadiusPixels != null ? cfg.outerRadiusPixels : null)
            ?? (cfg.outerRadius ?? 0.10) * minDim;
        const innerRadiusPixels = (cfg.innerRadiusPixels != null ? cfg.innerRadiusPixels : null)
            ?? (cfg.innerRadius ?? 0.045) * minDim;
        const outerRadius = Math.max(2, outerRadiusPixels);
        const innerRadius = Math.max(1, Math.min(innerRadiusPixels, outerRadius - 1));

        const dirStrengthMin = cfg.directionalStrengthMin ?? 0.04;
        const dirStrengthMax = cfg.directionalStrengthMax ?? 0.24;
        const dirSizeMin = cfg.directionalSizeMin ?? 0.20;
        const dirSizeMax = cfg.directionalSizeMax ?? 0.92;

        const _proj = this._projVec ?? (this._projVec = new THREE.Vector3());
        const wpos = this._lanternWorldScratch ?? (this._lanternWorldScratch = new THREE.Vector3());
        const uvDisp = this._lanternDispScratch ?? (this._lanternDispScratch = new THREE.Vector2());
        const directionalGlows = [];
        let maxInnerBlend = 0;

        const useMeshUV =
            Boolean(this.parallax?.getWorldPositionForUV && this.parallax?.mesh);
        if (useMeshUV) {
            this.parallax.mesh.updateWorldMatrix(true, false);
        }
        this.camera.updateMatrixWorld(true);

        for (let i = 0; i < configs.length; i++) {
            const c = configs[i];
            const fade = this._getLanternFadeFactor(c?.name);
            if (fade <= 0) continue;

            if (useMeshUV) {
                this.parallax.getWorldPositionForUV(c.x, c.y, 0, wpos);
                if (this.parallax.getParallaxDisplacementForUV) {
                    this.parallax.getParallaxDisplacementForUV(c.x, c.y, uvDisp);
                    wpos.x += uvDisp.x;
                    wpos.y += uvDisp.y;
                }
                _proj.copy(wpos).project(this.camera);
            } else {
                const wx = (c.x - 0.5) * mw + t.position.x;
                const wy = (c.y - 0.5) * mh + t.position.y;
                const wz = c.z ?? 0.5;
                _proj.set(wx, wy, wz).project(this.camera);
            }

            const px = (_proj.x * 0.5 + 0.5) * rect.width;
            const py = (0.5 - _proj.y * 0.5) * rect.height;
            const dx = mousePixelX - px;
            const dy = mousePixelY - py;
            const d = Math.sqrt(dx * dx + dy * dy);

            if (d > outerRadius) continue;

            const outerProgressRaw = (outerRadius - d) / (outerRadius - innerRadius);
            const outerProgress = this._smoothstep01(outerProgressRaw);
            const innerRaw = (innerRadius - d) / innerRadius;
            const innerProgress = this._smoothstep01(innerRaw);
            maxInnerBlend = Math.max(maxInnerBlend, innerProgress * fade);

            const innerFadeOut = 1 - innerProgress * 0.88;
            const bMin = cfg.directionalBrightnessMin ?? 1.0;
            const bMax = cfg.directionalBrightnessMax ?? 1.0;
            const brightnessRamp = bMin + (bMax - bMin) * outerProgress;
            const strength =
                (dirStrengthMin + (dirStrengthMax - dirStrengthMin) * outerProgress) *
                fade *
                innerFadeOut *
                brightnessRamp;
            const size = dirSizeMin + (dirSizeMax - dirSizeMin) * outerProgress;
            if (strength <= 0.0001) continue;

            // Direction is driven by mouse->lantern vector so circling around a lantern moves the edge glow.
            let dirX = (px - mousePixelX);
            let dirY = (py - mousePixelY);
            const dirLen = Math.sqrt(dirX * dirX + dirY * dirY);
            if (dirLen > 1e-4) {
                dirX /= dirLen;
                dirY /= dirLen;
            } else {
                // Fallback when pointer is exactly over lantern: use screen-center reference.
                dirX = px - rect.width * 0.5;
                dirY = py - rect.height * 0.5;
                const centerLen = Math.sqrt(dirX * dirX + dirY * dirY) || 1;
                dirX /= centerLen;
                dirY /= centerLen;
            }

            directionalGlows.push({
                x: 0.5 + dirX * 0.5,
                y: 0.5 - dirY * 0.5,
                strength,
                size
            });
        }

        directionalGlows.sort((a, b) => b.strength - a.strength);
        return {
            directionalGlows: directionalGlows.slice(0, MAX_DIRECTIONAL_GLOWS),
            innerBlendTarget: maxInnerBlend
        };
    }

    _createCompositeScreenQuad(geometry, material) {
        const distanceFromCamera = 0.5;
        const fovRad = THREE.MathUtils.degToRad(45);
        const halfFov = fovRad / 2;
        const height = 2 * Math.tan(halfFov) * distanceFromCamera;
        const width = height * this.camera.aspect;
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(0, 0, this.camera.position.z - distanceFromCamera);
        mesh.scale.set(width, height, 1);
        mesh.frustumCulled = false;
        mesh.renderOrder = 9999;
        mesh.userData.isScreenEffect = true;
        mesh.userData.distanceFromCamera = distanceFromCamera;
        return mesh;
    }

    _resizeVignetteRT() {
        if (!this.vignetteRT || !this.overlayMesh?.material?.uniforms) return;
        const scale = this.halfResScale;
        const w = Math.max(1, Math.floor(this.renderer.domElement.width * scale));
        const h = Math.max(1, Math.floor(this.renderer.domElement.height * scale));
        this.vignetteRT.setSize(w, h);
        this.overlayMesh.material.uniforms.uResolution.value.set(w, h);
        this.updateScreenEffectViewport(this.compositeMesh);
    }

    applyConfig(config) {
        this.halfResScale = config.halfResScale ?? 0.5;
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
        this.flickerSpeed = config.flickerSpeed ?? 8;
        this.flickerAmount = config.flickerAmount ?? 0.35;
        this.innerFogStrength = config.innerFogStrength ?? 0.95;
        this.innerRimStrength = config.innerRimStrength ?? 0.28;
        this.innerRimThickness = config.innerRimThickness ?? 0.09;
        this.fogNoiseScale = config.fogNoiseScale ?? 5.5;
        this.fogWarpAmount = config.fogWarpAmount ?? 0.075;
        this.fogDriftSpeed = config.fogDriftSpeed ?? 0.65;
        this.fogDriftX = config.fogDriftX ?? 0.9;
        this.fogDriftY = config.fogDriftY ?? 0.35;
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

    renderPrePass(renderer, camera) {
        if (!this.isInitialized || !this.vignetteRT || !this.vignetteScene) return;
        renderer.setRenderTarget(this.vignetteRT);
        renderer.clear();
        renderer.render(this.vignetteScene, camera);
        renderer.setRenderTarget(null);
    }

    update(deltaTime) {
        if (!this.isInitialized || !this.overlayMesh?.material?.uniforms) return;
        this._frameCounter++;
        const u = this.overlayMesh.material.uniforms;
        if (u.uTime) u.uTime.value += deltaTime;

        let px = this.mousePixelX;
        let py = this.mousePixelY;
        if (px < 0 || py < 0) {
            const rect = this._getCanvasRect();
            if (rect) {
                px = rect.width * 0.5;
                py = rect.height * 0.5;
            }
        }
        const candleCfg = this._getCandleFlameScreenConfig();
        const vf = candleCfg.vignetteFade ?? {};
        const candleFadeSpeed = vf.fadeSpeed ?? candleCfg.blendSpeed ?? 0.1;
        const candleVigTarget = this.computeCandleVignetteTarget(px, py);
        this.candleVignetteMul += (candleVigTarget - this.candleVignetteMul) * candleFadeSpeed;
        if (u.uCandleVignetteMul) u.uCandleVignetteMul.value = this.candleVignetteMul;

        const glowState = this.computeGlowState(px, py);
        this.innerBlend += (glowState.innerBlendTarget - this.innerBlend) * 0.10;
        u.uInnerBlend.value = this.innerBlend;

        this._zeroDirectionalGlowData();
        const active = Math.min(MAX_DIRECTIONAL_GLOWS, glowState.directionalGlows.length);
        for (let i = 0; i < active; i++) {
            const g = glowState.directionalGlows[i];
            this._directionalGlowData[i].set(g.x, g.y, g.strength, g.size);
        }
        if (u.uDirectionalGlowCount) u.uDirectionalGlowCount.value = active;
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
        u.uGlowStrength.value = this.glowStrengthMax;
        u.uGlowColor.value.copy(this.glowColor);
        if (u.uFlickerSpeed) u.uFlickerSpeed.value = this.flickerSpeed;
        if (u.uFlickerAmount) u.uFlickerAmount.value = this.flickerAmount;
        if (u.uInnerFogStrength) u.uInnerFogStrength.value = this.innerFogStrength;
        if (u.uInnerRimStrength) u.uInnerRimStrength.value = this.innerRimStrength;
        if (u.uInnerRimThickness) u.uInnerRimThickness.value = this.innerRimThickness;
        if (u.uFogNoiseScale) u.uFogNoiseScale.value = this.fogNoiseScale;
        if (u.uFogWarpAmount) u.uFogWarpAmount.value = this.fogWarpAmount;
        if (u.uFogDriftSpeed) u.uFogDriftSpeed.value = this.fogDriftSpeed;
        if (u.uFogDriftX) u.uFogDriftX.value = this.fogDriftX;
        if (u.uFogDriftY) u.uFogDriftY.value = this.fogDriftY;
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
        if (this._resizeHandler) {
            window.removeEventListener('resize', this._resizeHandler);
            this._resizeHandler = null;
        }
        if (this._scrollHandler) {
            window.removeEventListener('scroll', this._scrollHandler);
            this._scrollHandler = null;
        }
        if (typeof this._unsubVignetteCanvasResize === 'function') {
            this._unsubVignetteCanvasResize();
            this._unsubVignetteCanvasResize = null;
        }
        if (this.vignetteRT) {
            this.vignetteRT.dispose();
            this.vignetteRT = null;
        }
        if (this.vignetteScene && this.overlayMesh) {
            this.vignetteScene.remove(this.overlayMesh);
        }
        this.vignetteScene = null;
        super.cleanup();
    }
}

export default ScreenVignetteEffect;
