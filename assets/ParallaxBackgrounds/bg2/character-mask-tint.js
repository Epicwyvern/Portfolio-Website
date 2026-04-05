// Character mask tint — area effect for bg2: tints the background where a mask is non-zero.
// Optional burn-out / burn-in: noise-threshold dissolve with char + emissive rim; only affects
// pixels that pass the mask threshold (black / ignored regions are discarded, no burn).
// Uses the same coarse displaced geometry as water / foliage so the overlay tracks parallax.

import BaseEffect, {
    GLSL_AREA_PASS_UV_BOUNDS_DISCARD_AND_LINE,
    GLSL_AREA_PASS_UV_BOUNDS_UNIFORMS,
    mergeAreaPassUvBoundsUniforms,
    syncAreaPassUvBoundsUniforms,
    PARALLAX_COARSE_OVERLAY_Z
} from '../../../js/base-effect.js';
import * as THREE from 'https://unpkg.com/three@0.172.0/build/three.module.js';

const log = (...args) => {
    if (window.location.pathname.endsWith('test-effects.html')) {
        console.log(...args);
    }
};

/**
 * UV polygon vertices in order (closed implicitly: last edge connects to first).
 * Requires `corners` with at least 3 finite {x,y} points. Supports concave polygons.
 * @param {unknown} tp
 * @returns {Array<{x:number,y:number}>|null}
 */
export function getCharacterMaskBurnTriggerPolygonCorners(tp) {
    if (!tp || typeof tp !== 'object') return null;
    const c = /** @type {{ corners?: unknown }} */ (tp).corners;
    if (!Array.isArray(c) || c.length < 3) return null;
    const out = [];
    for (let i = 0; i < c.length; i++) {
        const p = /** @type {Record<string, unknown>} */ (c[i]);
        if (!p || typeof p !== 'object') return null;
        const x = Number(p.x);
        const y = Number(p.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        out.push({ x, y });
    }
    return out;
}

/** @param {unknown} tp @returns {boolean} */
export function characterMaskBurnTriggerPolygonHasBounds(tp) {
    return getCharacterMaskBurnTriggerPolygonCorners(tp) != null;
}

/** True when double-click should be limited to UV polygon (enabled + valid corners). */
export function characterMaskBurnTriggerPolygonIsActive(tp) {
    if (!tp || typeof tp !== 'object' || /** @type {{ enabled?: boolean }} */ (tp).enabled === false) return false;
    return characterMaskBurnTriggerPolygonHasBounds(tp);
}

/** Point-in-polygon (ray cast); works for simple polygons, convex or concave. */
export function pointInBurnTriggerPolygonUV(u, v, poly) {
    if (!poly || poly.length < 3) return false;
    const x = u;
    const y = v;
    let inside = false;
    const n = poly.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = poly[i].x;
        const yi = poly[i].y;
        const xj = poly[j].x;
        const yj = poly[j].y;
        const crossY = yj - yi;
        if (Math.abs(crossY) < 1e-12) continue;
        const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / crossY + xi;
        if (intersect) inside = !inside;
    }
    return inside;
}

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

    uniform float uBurnState;
    uniform float uBurnProgress;
    uniform float uNoiseScale;
    uniform vec2 uNoiseOffset;
    uniform float uNoiseOctaves;
    uniform float uEdgeSoftness;
    uniform float uCharWidth;
    uniform float uFireSigma;
    uniform float uCharIntensity;
    uniform float uFireStrength;
    uniform vec3 uCharColor;
    uniform vec3 uFireHot;
    uniform vec3 uFireMid;
    uniform float uTime;
    uniform float uNoiseTimeScale;
    uniform float uNoiseTimeAmount;
    uniform vec2 uNoiseSeed;
${GLSL_AREA_PASS_UV_BOUNDS_UNIFORMS}
    varying vec2 vUv;

    float rawMaskSample(vec4 t) {
        if (uMaskSource > 2.5) return dot(t.rgb, vec3(0.299, 0.587, 0.114));
        if (uMaskSource > 1.5) return max(t.r, t.a);
        if (uMaskSource > 0.5) return t.r;
        return t.a;
    }

    // Fract/dot hash — stable for large lattice indices (unlike sin(dot(huge)) in float32).
    vec2 hash2(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
        p3 += dot(p3, p3.yxz + 33.33);
        return fract((p3.xx + p3.yz) * p3.zy);
    }

    float vhash(vec2 p) {
        return hash2(p).x;
    }

    // Value noise with quintic smoothstep (smoother across cell edges than cubic; same gritty FBM character).
    float noise2(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
        return mix(
            mix(vhash(i + vec2(0.0, 0.0)), vhash(i + vec2(1.0, 0.0)), u.x),
            mix(vhash(i + vec2(0.0, 1.0)), vhash(i + vec2(1.0, 1.0)), u.x),
            u.y
        );
    }

    float fbmOct(vec2 p) {
        float v = 0.0;
        float a = 0.5;
        mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
        for (int i = 0; i < 5; i++) {
            if (float(i) >= uNoiseOctaves) break;
            v += a * noise2(p);
            p = rot * p * 2.05 + 17.0;
            a *= 0.5;
        }
        return v;
    }

    void main() {
${GLSL_AREA_PASS_UV_BOUNDS_DISCARD_AND_LINE}
        vec4 ms = texture2D(maskMap, vUv);
        float m = rawMaskSample(ms);
        if (uMaskInvert > 0.5) m = 1.0 - m;

        if (m < uMaskThreshold) {
            if (passLine * uPassBoundsHiStrength < 0.012) discard;
            float a = passLine * uPassBoundsHiStrength;
            gl_FragColor = vec4(uPassBoundsHiColor * a, a);
            return;
        }

        float denom = max(0.00001, 1.0 - uMaskThreshold);
        float mScaled = clamp((m - uMaskThreshold) / denom, 0.0, 1.0);

        vec3 bg = texture2D(map, vUv).rgb;
        float blend = clamp(mScaled * uTintStrength * uOpacity, 0.0, 1.0);
        vec3 passB = uPassBoundsHiColor * passLine * uPassBoundsHiStrength;

        if (uBurnState < 1.5) {
            gl_FragColor = vec4(min(mix(bg, uTintColor, blend) + passB, vec3(1.0)), 1.0);
            return;
        }

        if (uBurnState < 2.5) {
            gl_FragColor = vec4(min(bg + passB, vec3(1.0)), 1.0);
            return;
        }

        float keep = 1.0;
        float rim = 0.0;
        float charAmt = 0.0;

        vec2 wind = vec2(uTime * uNoiseTimeScale) * uNoiseTimeAmount;
        vec2 nuv = vUv * uNoiseScale + uNoiseOffset + uNoiseSeed + wind;
        float n = clamp(fbmOct(nuv), 0.0, 1.0);

        float edgeS = max(uEdgeSoftness, 0.0001);
        float thresh = mix(-edgeS, 1.0 + edgeS, uBurnProgress);
        keep = smoothstep(thresh, thresh + edgeS, n);

        float dt = n - thresh;
        rim = exp(-(dt * dt) / max(uFireSigma * uFireSigma, 1e-8));

        charAmt = (1.0 - smoothstep(thresh + 0.0001, thresh + uCharWidth, n))
            * smoothstep(thresh - edgeS, thresh + uCharWidth * 0.5, n);

        vec3 baseCol = mix(bg, uTintColor, blend * keep);
        baseCol = mix(baseCol, uCharColor, charAmt * uCharIntensity * blend);
        vec3 fireCol = mix(uFireMid, uFireHot, rim);
        baseCol = clamp(baseCol + fireCol * rim * uFireStrength * blend, 0.0, 1.0);
        baseCol = min(baseCol + passB, vec3(1.0));

        gl_FragColor = vec4(baseCol, 1.0);
    }
`;

class CharacterMaskTintEffect extends BaseEffect {
    constructor(scene, camera, renderer, parallaxInstance) {
        super(scene, camera, renderer, parallaxInstance);
        this.effectType = 'area';
        this.overlayMesh = null;
        this.uniforms = null;
        this.maskTexture = null;

        this.burnProgress = 0;
        this.burnTarget = 0;
        this.burnBurntOut = false;
        this._burnDblClickHandler = null;
        this._pointerNdc = new THREE.Vector2();
        this._raycaster = new THREE.Raycaster();
        this._syncSkip = 0;
        /** @type {null | 0 | 1} Next burn target after current animation settles; soft queue for double-click during dissolve. */
        this._burnQueuedTarget = null;
    }

    getConfig() {
        return this.parallax?.config?.effects?.characterMaskTint ?? {};
    }

    getBurnConfig() {
        const c = this.getConfig();
        return c.burn && typeof c.burn === 'object' ? c.burn : {};
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
        this.useDepthTest = c.useDepthTest === true;
        this.overlaySegments = c.overlaySegments ?? 128;
        this.maskChannel = c.maskChannel ?? 'luminance';
        this.maskIgnoreBelow = Math.max(0, Math.min(255, Math.round(Number(c.maskIgnoreBelow) || 0)));
        this.maskInvert = c.maskInvert === true;

        const b = c.burn && typeof c.burn === 'object' ? c.burn : null;
        this.burnEnabled = b ? b.enabled !== false : false;
        const br = b || {};
        this.burnNoiseScale = Number(br.noiseScale) > 0 ? Number(br.noiseScale) : 5.0;
        this.burnNoiseOffset = new THREE.Vector2(
            Number(br.noiseOffset?.x) || 0,
            Number(br.noiseOffset?.y) || 0
        );
        this.burnEdgeSoftness = Math.max(0.001, Number(br.edgeSoftness) || 0.07);
        this.burnCharWidth = Math.max(0.001, Number(br.charWidth) || 0.1);
        this.burnFireSigma = Math.max(0.001, Number(br.fireSigma) || 0.035);
        this.burnCharIntensity = Math.max(0, Number(br.charIntensity) ?? 0.75);
        this.burnFireStrength = Math.max(0, Number(br.fireStrength) ?? 1.15);
        this.burnCharColor = this.parseColor(br.charColor ?? '0x2a1810');
        this.burnFireHot = this.parseColor(br.fireHot ?? '0xfff0c8');
        this.burnFireMid = this.parseColor(br.fireMid ?? '0xff6a1a');
        this.burnOutDuration = Math.max(0.05, Number(br.burnOutDuration) || 2.2);
        this.burnInDuration = Math.max(0.05, Number(br.burnInDuration) || 2.8);
        this.burnNoiseTimeScale = Number(br.noiseTimeScale) || 0.15;
        this.burnNoiseTimeAmount = Number(br.noiseTimeAmount) || 0.08;
        this.burnNoiseOctaves = Math.max(2, Math.min(5, Math.round(Number(br.noiseOctaves) || 3)));
        this.burnNoiseSeedRandomize = br.noiseSeedRandomize !== false;
        const ns = br.noiseSeed;
        this.burnNoiseSeedFixed =
            ns && typeof ns === 'object'
                ? new THREE.Vector2(Number(ns.x) || 0, Number(ns.y) || 0)
                : null;
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

        this.uniforms.uBurnProgress.value = this.burnProgress;
        this.uniforms.uNoiseScale.value = this.burnNoiseScale;
        this.uniforms.uNoiseOffset.value.copy(this.burnNoiseOffset);
        if (this.uniforms.uNoiseOctaves) {
            this.uniforms.uNoiseOctaves.value = this.burnNoiseOctaves;
        }
        this.uniforms.uEdgeSoftness.value = this.burnEdgeSoftness;
        this.uniforms.uCharWidth.value = this.burnCharWidth;
        this.uniforms.uFireSigma.value = this.burnFireSigma;
        this.uniforms.uCharIntensity.value = this.burnCharIntensity;
        this.uniforms.uFireStrength.value = this.burnFireStrength;
        this.uniforms.uCharColor.value.copy(this.burnCharColor);
        this.uniforms.uFireHot.value.copy(this.burnFireHot);
        this.uniforms.uFireMid.value.copy(this.burnFireMid);
    }

    /** @returns {boolean} true if fully burnt out (idle at progress 1) */
    isBurntOut() {
        return this.burnBurntOut;
    }

    /** True while progress is still moving toward burnTarget (blocks reversing direction). */
    _isBurnAnimating() {
        const eps = 0.002;
        return Math.abs(this.burnProgress - this.burnTarget) > eps;
    }

    /** When settled, start a queued opposite burn (seed rolled once on start). */
    _drainBurnQueueIfAny() {
        if (this._burnQueuedTarget === null) return;
        const q = this._burnQueuedTarget;
        this._burnQueuedTarget = null;
        if (Math.abs(q - this.burnTarget) < 0.01) return;
        this._rollBurnNoiseSeed();
        this.burnTarget = /** @type {0|1} */ (q);
        this.burnBurntOut = false;
    }

    _rollBurnNoiseSeed() {
        if (!this.uniforms?.uNoiseSeed) return;
        if (this.burnNoiseSeedFixed) {
            this.uniforms.uNoiseSeed.value.copy(this.burnNoiseSeedFixed);
            return;
        }
        if (!this.burnNoiseSeedRandomize) return;
        this.uniforms.uNoiseSeed.value.set(
            Math.random() * 2400 - 1200,
            Math.random() * 2400 - 1200
        );
    }

    /** Start animating toward burnt-out (tint gone on mask; shows raw bg in shader). */
    triggerBurnOut() {
        if (!this.burnEnabled) return;
        if (this._isBurnAnimating()) {
            if (this.burnTarget > 0.5) {
                if (this._burnQueuedTarget === 0) this._burnQueuedTarget = null;
            } else {
                this._burnQueuedTarget = 1;
            }
            return;
        }
        this._rollBurnNoiseSeed();
        this.burnTarget = 1;
        this.burnBurntOut = false;
        this._burnQueuedTarget = null;
    }

    /** Start animating back to full tint on mask. */
    triggerBurnIn() {
        if (!this.burnEnabled) return;
        if (this._isBurnAnimating()) {
            if (this.burnTarget < 0.5) {
                if (this._burnQueuedTarget === 1) this._burnQueuedTarget = null;
            } else {
                this._burnQueuedTarget = 0;
            }
            return;
        }
        this._rollBurnNoiseSeed();
        this.burnTarget = 0;
        this.burnBurntOut = false;
        this._burnQueuedTarget = null;
    }

    /** Toggle between full tint and burnt out (for testing / simple UX). */
    toggleBurn() {
        if (!this.burnEnabled) return;
        if (this._isBurnAnimating()) {
            const towardBurnt = this.burnTarget > 0.5;
            const opposite = towardBurnt ? 0 : 1;
            if (this._burnQueuedTarget === null) {
                this._burnQueuedTarget = /** @type {0|1} */ (opposite);
            } else if (this._burnQueuedTarget === opposite) {
                this._burnQueuedTarget = null;
            } else {
                this._burnQueuedTarget = /** @type {0|1} */ (opposite);
            }
            return;
        }
        if (this.burnProgress > 0.5 || this.burnBurntOut) {
            this.triggerBurnIn();
        } else {
            this.triggerBurnOut();
        }
    }

    _getUvFromPointerEvent(event) {
        if (!this.overlayMesh || !this.renderer?.domElement || !this.camera) return null;
        const rect = this.renderer.domElement.getBoundingClientRect();
        const w = rect.width || 1;
        const h = rect.height || 1;
        this._pointerNdc.x = ((event.clientX - rect.left) / w) * 2 - 1;
        this._pointerNdc.y = -((event.clientY - rect.top) / h) * 2 + 1;
        this._raycaster.setFromCamera(this._pointerNdc, this.camera);
        const hits = this._raycaster.intersectObject(this.overlayMesh, false);
        if (hits.length > 0 && hits[0].uv) return hits[0].uv;
        return null;
    }

    _uvInsideBurnTriggerPolygon(uv) {
        const tp = this.getBurnConfig().interaction?.triggerPolygon;
        if (!characterMaskBurnTriggerPolygonIsActive(tp)) return true;
        const corners = getCharacterMaskBurnTriggerPolygonCorners(tp);
        if (!corners) return true;
        return pointInBurnTriggerPolygonUV(uv.x, uv.y, corners);
    }

    _attachBurnInteraction() {
        const canvas = this.renderer?.domElement;
        if (!canvas || this._burnDblClickHandler) return;
        if (!this.getBurnConfig().interaction?.doubleClickToggle) return;

        this._burnDblClickHandler = (e) => {
            if (!this.isInitialized || !this.burnEnabled) return;
            const tp = this.getBurnConfig().interaction?.triggerPolygon;
            if (characterMaskBurnTriggerPolygonIsActive(tp)) {
                const uv = this._getUvFromPointerEvent(e);
                if (!uv || !this._uvInsideBurnTriggerPolygon(uv)) return;
            }
            e.preventDefault();
            this.toggleBurn();
        };
        canvas.addEventListener('dblclick', this._burnDblClickHandler);
    }

    _detachBurnInteraction() {
        const canvas = this.renderer?.domElement;
        if (canvas && this._burnDblClickHandler) {
            canvas.removeEventListener('dblclick', this._burnDblClickHandler);
        }
        this._burnDblClickHandler = null;
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
                uMaskInvert: { value: this.maskInvert ? 1.0 : 0.0 },

                uBurnState: { value: this.burnEnabled ? 1.0 : 0.0 },
                uBurnProgress: { value: this.burnProgress },
                uNoiseScale: { value: this.burnNoiseScale },
                uNoiseOffset: { value: this.burnNoiseOffset.clone() },
                uNoiseOctaves: { value: this.burnNoiseOctaves },
                uEdgeSoftness: { value: this.burnEdgeSoftness },
                uCharWidth: { value: this.burnCharWidth },
                uFireSigma: { value: this.burnFireSigma },
                uCharIntensity: { value: this.burnCharIntensity },
                uFireStrength: { value: this.burnFireStrength },
                uCharColor: { value: this.burnCharColor.clone() },
                uFireHot: { value: this.burnFireHot.clone() },
                uFireMid: { value: this.burnFireMid.clone() },
                uTime: { value: 0 },
                uNoiseTimeScale: { value: this.burnNoiseTimeScale },
                uNoiseTimeAmount: { value: this.burnNoiseTimeAmount },
                uNoiseSeed: { value: new THREE.Vector2(0, 0) }
            };
            mergeAreaPassUvBoundsUniforms(this.uniforms, config, THREE);

            this.syncUniformsFromConfig(config);
            if (this.uniforms.uNoiseSeed) {
                if (this.burnNoiseSeedFixed) {
                    this.uniforms.uNoiseSeed.value.copy(this.burnNoiseSeedFixed);
                } else if (this.burnNoiseSeedRandomize) {
                    this._rollBurnNoiseSeed();
                }
            }

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

            this.burnProgress = 0;
            this.burnTarget = 0;
            this.burnBurntOut = false;
            this._burnQueuedTarget = null;
            if (this.uniforms.uBurnProgress) this.uniforms.uBurnProgress.value = 0;

            this._detachBurnInteraction();
            this._attachBurnInteraction();

            this.isInitialized = true;
            log(`CharacterMaskTintEffect: Initialized (maskChannel: ${this.maskChannel}, burn: ${this.burnEnabled})`);
        } catch (error) {
            console.error('CharacterMaskTintEffect: init failed:', error);
            throw error;
        }
    }

    update(deltaTime) {
        if (!this.isInitialized || !this.overlayMesh || !this.uniforms) return;

        const dt = typeof deltaTime === 'number' && deltaTime > 0 ? deltaTime : 1 / 60;

        if (this.burnEnabled) {
            const dur = this.burnTarget >= 0.5 ? this.burnOutDuration : this.burnInDuration;
            const speed = 1 / dur;
            const eps = 0.002;
            if (Math.abs(this.burnProgress - this.burnTarget) > eps) {
                const dir = this.burnTarget > this.burnProgress ? 1 : -1;
                this.burnProgress = THREE.MathUtils.clamp(
                    this.burnProgress + dir * speed * dt,
                    0,
                    1
                );
            } else {
                this.burnProgress = this.burnTarget;
                if (this.burnProgress >= 1 - eps) {
                    this.burnBurntOut = true;
                } else if (this.burnProgress <= eps) {
                    this.burnBurntOut = false;
                }
                this._drainBurnQueueIfAny();
            }
        }

        let burnCheapMode = 0;
        if (this.burnEnabled) {
            const eps = 0.002;
            const settled = Math.abs(this.burnProgress - this.burnTarget) <= eps;
            if (settled && this.burnProgress <= eps) burnCheapMode = 1;
            else if (settled && this.burnProgress >= 1 - eps) burnCheapMode = 2;
            else burnCheapMode = 0;
        }

        let burnState = 0;
        if (!this.burnEnabled) burnState = 0;
        else if (burnCheapMode === 1) burnState = 1;
        else if (burnCheapMode === 2) burnState = 2;
        else burnState = 3;

        if (this.uniforms.uBurnState) {
            this.uniforms.uBurnState.value = burnState;
        }
        if (this.uniforms.uBurnProgress) {
            this.uniforms.uBurnProgress.value = this.burnProgress;
        }

        if (this.uniforms.uTime && this.burnEnabled && burnCheapMode === 0) {
            this.uniforms.uTime.value += dt;
        }

        const dissolveActive = this.burnEnabled && burnState >= 2.9;
        this._syncSkip = (this._syncSkip + 1) % 3;
        const cfgPass = this.getConfig();
        syncAreaPassUvBoundsUniforms(this.uniforms, cfgPass);
        if (dissolveActive || !this.burnEnabled || this._syncSkip === 0) {
            this.syncUniformsFromConfig(cfgPass);
        } else if (this.parallax?.imageTexture && this.uniforms.map) {
            this.uniforms.map.value = this.parallax.imageTexture;
        }

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

        const wantDbl = this.getBurnConfig().interaction?.doubleClickToggle === true;
        if (wantDbl && !this._burnDblClickHandler) {
            this._attachBurnInteraction();
        } else if (!wantDbl && this._burnDblClickHandler) {
            this._detachBurnInteraction();
        }
    }

    cleanup() {
        this._detachBurnInteraction();
        this._burnQueuedTarget = null;
        this.maskTexture = null;
        super.cleanup();
        this.overlayMesh = null;
        this.uniforms = null;
    }
}

export default CharacterMaskTintEffect;
