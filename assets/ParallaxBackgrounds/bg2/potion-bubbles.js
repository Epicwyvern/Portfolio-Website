// Potion bubbles (bg2) — liquid column between curved upper/lower menisci; bubbles rise, pop at top; slosh weighted at menisci.
// Mask top ≈ upper meniscus; mask bottom ≈ bottle floor. Meniscus shape: v += curvature*(u - curveCenterU)² (vertex at curveCenterU, default 0.5 = image center).

import BaseEffect, {
    effectConfigHexToInt,
    mergeAreaPassUvBoundsUniforms,
    syncAreaPassUvBoundsUniforms
} from '../../../js/base-effect.js';
import * as THREE from 'https://unpkg.com/three@0.172.0/build/three.module.js';

const log = (...args) => {
    if (window.location.pathname.endsWith('test-effects.html')) {
        console.log(...args);
    }
};

/** @param {string} ch @returns {number} 0 alpha, 1 red, 2 max(r,a), 3 luminance, 4 min(alpha,luminance) */
function maskChannelToFloat(ch) {
    const c = (ch || 'alphaLuminance').toLowerCase().replace(/[-_]/g, '');
    if (c === 'alphaluminance' || c === 'matte') return 4;
    if (c === 'red' || c === 'r') return 1;
    if (c === 'max' || c === 'maxra') return 2;
    if (c === 'luminance' || c === 'luma' || c === 'gray') return 3;
    return 0;
}

const FRAGMENT_SHADER = `
    uniform sampler2D map;
    uniform sampler2D maskMap;
    uniform float uTime;
    uniform float uMaskSource;
    uniform float uMaskThreshold;
    uniform float uMaskInvert;
    uniform float uOpacity;

    uniform float uLiquidShakeStrength;
    uniform float uLiquidShakeSpeed;
    uniform float uLiquidShakeScale;

    uniform float uTopY;
    uniform float uTopCurv;
    uniform float uTopCurveCenterU;
    uniform float uTopBand;
    uniform float uTopSurge;

    uniform float uBotY;
    uniform float uBotCurv;
    uniform float uBotCurveCenterU;
    uniform float uBotBand;
    uniform float uBotSurge;

    uniform float uMidSlosh;

    uniform float uPopBand;
    uniform float uBuoyancy;

    uniform float uBubbleScaleA;
    uniform float uBubbleScaleB;
    uniform float uBubbleScaleC;
    uniform float uBubbleRadiusA;
    uniform float uBubbleRadiusB;
    uniform float uBubbleRadiusC;
    uniform float uBubbleRiseSpeed;
    uniform float uBubbleDisplacement;
    uniform float uBubbleShell;
    uniform float uBubbleHighlightStrength;

    uniform float uRestrictToColumn;
    uniform vec2 uPassUvMin;
    uniform vec2 uPassUvMax;
    uniform float uPassBoundsHiStrength;
    uniform float uPassBoundsHiLineWidth;
    uniform vec3 uPassBoundsHiColor;
    uniform float uMsHiStrength;
    uniform float uMsHiLineWidth;
    uniform vec3 uMsHiTopCol;
    uniform vec3 uMsHiBotCol;

    varying vec2 vUv;

    float rawMaskSample(vec4 t) {
        if (uMaskSource > 3.5) {
            float lu = dot(t.rgb, vec3(0.299, 0.587, 0.114));
            return min(t.a, lu);
        }
        if (uMaskSource > 2.5) return dot(t.rgb, vec3(0.299, 0.587, 0.114));
        if (uMaskSource > 1.5) return max(t.r, t.a);
        if (uMaskSource > 0.5) return t.r;
        return t.a;
    }

    vec2 hash2(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
        p3 += dot(p3, p3.yxz + 33.33);
        return fract((p3.xx + p3.yz) * p3.zy);
    }

    void voronoiCell(vec2 uv, float scale, float time, float rise, float riseMod, out float md, out vec2 mv) {
        vec2 p = uv * scale;
        vec2 gi = floor(p);
        vec2 gf = fract(p);
        md = 8.0;
        mv = vec2(0.0);
        for (int j = -1; j <= 1; j++) {
            for (int i = -1; i <= 1; i++) {
                vec2 b = vec2(float(i), float(j));
                vec2 cell = gi + b;
                vec2 r = hash2(cell);
                vec2 pos = b + r - gf;
                float up = fract(r.x * 17.0 + r.y * 23.0 + time * rise * riseMod);
                pos.y += up * 1.2 - 0.6;
                float d = length(pos);
                if (d < md) {
                    md = d;
                    mv = pos;
                }
            }
        }
    }

    float bubbleShell(float d, float radius, float shellW) {
        return exp(-pow((d - radius) / max(0.012, shellW), 2.0));
    }

    void main() {
        // Skip entire heavy path outside texture UV AABB (full frame = 0–1; tighten for perf).
        if (vUv.x < uPassUvMin.x || vUv.x > uPassUvMax.x || vUv.y < uPassUvMin.y || vUv.y > uPassUvMax.y)
            discard;

        float passEdgeDist = min(
            min(vUv.x - uPassUvMin.x, uPassUvMax.x - vUv.x),
            min(vUv.y - uPassUvMin.y, uPassUvMax.y - vUv.y)
        );
        float passPw = max(0.0004, uPassBoundsHiLineWidth);
        float passLine = 0.0;
        if (uPassBoundsHiStrength > 0.0001) {
            passLine = exp(-pow(passEdgeDist / passPw, 2.0));
        }

        vec4 ms = texture2D(maskMap, vUv);
        float m = rawMaskSample(ms);
        if (uMaskInvert > 0.5) m = 1.0 - m;

        if (m < uMaskThreshold) {
            if (passLine * uPassBoundsHiStrength < 0.012) discard;
            gl_FragColor = vec4(uPassBoundsHiColor * passLine * uPassBoundsHiStrength, passLine * uPassBoundsHiStrength * uOpacity);
            return;
        }

        float denom = max(0.00001, 1.0 - uMaskThreshold);
        float mScaled = clamp((m - uMaskThreshold) / denom, 0.0, 1.0);

        float duT = vUv.x - uTopCurveCenterU;
        float duB = vUv.x - uBotCurveCenterU;
        float vT = uTopY + uTopCurv * duT * duT;
        float vB = uBotY + uBotCurv * duB * duB;
        float columnH = max(0.04, vT - vB);
        float depth01 = clamp((vUv.y - vB) / columnH, 0.0, 1.0);

        float wTopEdge = 1.0 - smoothstep(vT - uTopBand, vT + uTopBand * 0.4, vUv.y);
        float wBotEdge = smoothstep(vB - uBotBand * 0.4, vB + uBotBand, vUv.y);
        float wColumn = clamp(wTopEdge * wBotEdge, 0.0, 1.0);

        float popFade = 1.0 - smoothstep(vT - uPopBand, vT, vUv.y);
        float riseMod = 1.0 + uBuoyancy * depth01 * depth01;

        float t = uTime * uLiquidShakeSpeed;
        float wTopGauss = exp(-pow((vUv.y - vT) / max(0.016, uTopBand), 2.0));
        float wBotGauss = exp(-pow((vUv.y - vB) / max(0.016, uBotBand), 2.0));

        float alongTop = sin(t * 1.45 + vUv.x * uLiquidShakeScale + sin(t * 0.62) * 1.8);
        float alongBot = sin(t * 1.05 + vUv.x * uLiquidShakeScale * 0.85 + 1.3);
        float topHoriz = alongTop * uTopSurge * wTopGauss;
        float botHoriz = alongBot * uBotSurge * wBotGauss * 0.72;
        float topVert = sin(t * 1.88 + vUv.x * uLiquidShakeScale * 1.55) * uTopSurge * 0.42 * wTopGauss;
        float botBump = sin(t * 1.25 + vUv.x * uLiquidShakeScale * 1.1) * uBotSurge * 0.28 * wBotGauss;

        float wMot = mScaled * mix(1.0, wColumn, uRestrictToColumn);
        float midMix = (1.0 - wTopGauss * 0.75) * (1.0 - wBotGauss * 0.55) * mix(1.0, wColumn, uRestrictToColumn);
        float mid = sin(t * 2.38 + vUv.x * uLiquidShakeScale * 1.28 + vUv.y * uLiquidShakeScale * 0.48) * uMidSlosh * midMix;

        vec2 liq = vec2(
            topHoriz + botHoriz + mid * 0.88,
            topVert - botBump + mid * 0.52 + sin(t * 1.15 + vUv.y * uLiquidShakeScale * 0.95) * 0.32 * uMidSlosh * mix(1.0, wColumn, uRestrictToColumn)
        );
        vec2 liquidDisp = liq * uLiquidShakeStrength * wMot;

        float tr = uTime * uBubbleRiseSpeed;
        vec2 bubDisp = vec2(0.0);
        float hi = 0.0;

        float d1; vec2 v1;
        voronoiCell(vUv, uBubbleScaleA, tr, uBubbleRiseSpeed * 1.05, riseMod, d1, v1);
        float s1 = bubbleShell(d1, uBubbleRadiusA, uBubbleShell);
        bubDisp -= normalize(v1 + vec2(1e-5)) * s1 * uBubbleDisplacement;
        hi += s1;

        float d2; vec2 v2;
        voronoiCell(vUv + vec2(0.37, 0.19), uBubbleScaleB, tr * 1.07, uBubbleRiseSpeed * 0.93, riseMod, d2, v2);
        float s2 = bubbleShell(d2, uBubbleRadiusB, uBubbleShell * 0.92);
        bubDisp -= normalize(v2 + vec2(1e-5)) * s2 * uBubbleDisplacement;
        hi += s2;

        float d3; vec2 v3;
        voronoiCell(vUv + vec2(-0.21, 0.44), uBubbleScaleC, tr * 0.96, uBubbleRiseSpeed * 1.12, riseMod, d3, v3);
        float s3 = bubbleShell(d3, uBubbleRadiusC, uBubbleShell * 0.88);
        bubDisp -= normalize(v3 + vec2(1e-5)) * s3 * uBubbleDisplacement;
        hi += s3;

        float bubbleWeight = wMot * popFade;
        bubDisp *= bubbleWeight;
        hi *= bubbleWeight;

        vec2 disp = liquidDisp + bubDisp;
        vec2 duv = clamp(vUv + disp, vec2(0.0), vec2(1.0));
        vec3 col = texture2D(map, duv).rgb;

        float hl = clamp(hi * 0.34, 0.0, 1.0) * uBubbleHighlightStrength;
        col = min(col + vec3(hl), vec3(1.0));

        if (uMsHiStrength > 0.0001) {
            float lw = max(0.0005, uMsHiLineWidth);
            float topLine = exp(-pow((vUv.y - vT) / lw, 2.0));
            float botLine = exp(-pow((vUv.y - vB) / lw, 2.0));
            col += uMsHiTopCol * topLine * uMsHiStrength * mScaled;
            col += uMsHiBotCol * botLine * uMsHiStrength * mScaled;
            col = min(col, vec3(1.0));
        }

        if (uPassBoundsHiStrength > 0.0001) {
            col += uPassBoundsHiColor * passLine * uPassBoundsHiStrength;
            col = min(col, vec3(1.0));
        }

        gl_FragColor = vec4(col, mScaled * uOpacity);
    }
`;

/**
 * @param {Record<string, unknown>} config
 * @returns {object}
 */
function resolveMenisciAndLiquid(config) {
    const top = config.meniscusTop && typeof config.meniscusTop === 'object' ? config.meniscusTop : {};
    const bot = config.meniscusBottom && typeof config.meniscusBottom === 'object' ? config.meniscusBottom : {};
    return {
        topY: Number(top.uvY ?? config.meniscusUvY ?? 0.72),
        topCurv: Number(top.curvature ?? 0),
        topCurveCenterU: Math.max(0, Math.min(1, Number(top.curveCenterU ?? 0.5))),
        topBand: Number(top.band ?? config.meniscusBand ?? 0.12),
        topSurge: Number(top.surge ?? config.meniscusShakeBoost ?? 2.0),
        botY: Number(bot.uvY ?? config.meniscusBottomUvY ?? 0.08),
        botCurv: Number(bot.curvature ?? 0),
        botCurveCenterU: Math.max(0, Math.min(1, Number(bot.curveCenterU ?? 0.5))),
        botBand: Number(bot.band ?? 0.1),
        botSurge: Number(bot.surge ?? 1.15),
        midSlosh: Number(config.midColumnSlosh ?? 0.55),
        popBand: Number(config.bubblePopBand ?? 0.055),
        buoyancy: Number(config.bubbleBuoyancy ?? 0.85)
    };
}

function resolveMeniscusHighlight(config) {
    const h = config.meniscusHighlight && typeof config.meniscusHighlight === 'object' ? config.meniscusHighlight : {};
    const enabled = h.enabled === true;
    return {
        strength: enabled ? Math.max(0, Math.min(2, Number(h.strength ?? 0.45))) : 0,
        lineWidth: Math.max(0.0003, Math.min(0.04, Number(h.lineWidth ?? 0.0035))),
        top: effectConfigHexToInt(h.topColor, 0x3399ff),
        bottom: effectConfigHexToInt(h.bottomColor, 0xff8844)
    };
}

class PotionBubblesEffect extends BaseEffect {
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
        this._cachedConfig = this.parallax?.config?.effects?.potionBubbles || {};
        this._cachedConfigFrame = this._frameCounter;
        return this._cachedConfig;
    }

    _maskThresholdNormalized(config) {
        const raw = config.maskIgnoreBelow;
        if (raw === undefined || raw === null) {
            return Math.max(0, Math.min(1, config.maskThreshold ?? 0.02));
        }
        const n = Number(raw);
        if (!Number.isFinite(n)) return 0.02;
        const norm = Math.max(0, Math.min(1, n / 255));
        return norm <= 0 ? 1 / 255 : norm;
    }

    _syncPotionTuning(config) {
        const u = this.uniforms;
        if (!u) return;
        const M = resolveMenisciAndLiquid(config);
        u.uTopY.value = M.topY;
        u.uTopCurv.value = M.topCurv;
        u.uTopCurveCenterU.value = M.topCurveCenterU;
        u.uTopBand.value = M.topBand;
        u.uTopSurge.value = M.topSurge;
        u.uBotY.value = M.botY;
        u.uBotCurv.value = M.botCurv;
        u.uBotCurveCenterU.value = M.botCurveCenterU;
        u.uBotBand.value = M.botBand;
        u.uBotSurge.value = M.botSurge;
        u.uMidSlosh.value = M.midSlosh;
        u.uPopBand.value = M.popBand;
        u.uBuoyancy.value = M.buoyancy;

        u.uRestrictToColumn.value = config.clipMotionToColumn === true ? 1.0 : 0.0;

        syncAreaPassUvBoundsUniforms(u, config);

        const hi = resolveMeniscusHighlight(config);
        u.uMsHiStrength.value = hi.strength;
        u.uMsHiLineWidth.value = hi.lineWidth;
        u.uMsHiTopCol.value.setHex(hi.top);
        u.uMsHiBotCol.value.setHex(hi.bottom);
    }

    /** Sync meniscus / column / highlight uniforms from `parallax.config` (test page). */
    refreshMeniscusUniforms() {
        this._syncPotionTuning(this.getConfig());
    }

    async init() {
        if (this.isInitialized) return;

        const config = this.getConfig();
        const basePath = `./assets/ParallaxBackgrounds/${this.parallax.backgroundName}/`;
        const maskPath = basePath + (config.maskPath || 'assets/bg2PotionMask.webp');

        const loadWithFallback = async (primary, fallbacks = []) => {
            const paths = [primary, ...fallbacks];
            for (let i = 0; i < paths.length; i++) {
                const p = paths[i];
                try {
                    return await this.loadTexture(p);
                } catch (e) {
                    if (i === paths.length - 1) throw e;
                    log(`PotionBubblesEffect: Fallback from ${p}`);
                }
            }
            throw new Error('PotionBubblesEffect: No mask path worked');
        };

        try {
            const maskTexture = this.maskTexture || await loadWithFallback(
                maskPath,
                ['assets/bg2PotionMask.webp', 'assets/bg2PotionMask.png']
                    .map((p) => basePath + p)
                    .filter((p) => p !== maskPath)
            );

            maskTexture.wrapS = maskTexture.wrapT = THREE.ClampToEdgeWrapping;
            maskTexture.minFilter = maskTexture.magFilter = THREE.LinearFilter;
            maskTexture.generateMipmaps = false;
            maskTexture.premultiplyAlpha = false;

            if (!this.maskTexture) this.maskTexture = maskTexture;
            this.textures.push(maskTexture);

            const ch = maskChannelToFloat(config.maskChannel);
            const maskThresh = this._maskThresholdNormalized(config);
            const M = resolveMenisciAndLiquid(config);
            const hi = resolveMeniscusHighlight(config);
            const restrictCol = config.clipMotionToColumn === true ? 1.0 : 0.0;

            this.uniforms = {
                map: { value: this.parallax.imageTexture },
                maskMap: { value: maskTexture },
                uTime: { value: 0 },
                uMaskSource: { value: ch },
                uMaskThreshold: { value: maskThresh },
                uMaskInvert: { value: config.maskInvert ? 1.0 : 0.0 },
                uOpacity: { value: config.opacity ?? 1.0 },

                uLiquidShakeStrength: { value: config.liquidShakeStrength ?? 0.0038 },
                uLiquidShakeSpeed: { value: config.liquidShakeSpeed ?? 2.2 },
                uLiquidShakeScale: { value: config.liquidShakeScale ?? 28.0 },

                uTopY: { value: M.topY },
                uTopCurv: { value: M.topCurv },
                uTopCurveCenterU: { value: M.topCurveCenterU },
                uTopBand: { value: M.topBand },
                uTopSurge: { value: M.topSurge },
                uBotY: { value: M.botY },
                uBotCurv: { value: M.botCurv },
                uBotCurveCenterU: { value: M.botCurveCenterU },
                uBotBand: { value: M.botBand },
                uBotSurge: { value: M.botSurge },
                uMidSlosh: { value: M.midSlosh },
                uPopBand: { value: M.popBand },
                uBuoyancy: { value: M.buoyancy },

                uRestrictToColumn: { value: restrictCol },
                uMsHiStrength: { value: hi.strength },
                uMsHiLineWidth: { value: hi.lineWidth },
                uMsHiTopCol: { value: new THREE.Color(hi.top) },
                uMsHiBotCol: { value: new THREE.Color(hi.bottom) },

                uBubbleScaleA: { value: config.bubbleScaleA ?? 56.0 },
                uBubbleScaleB: { value: config.bubbleScaleB ?? 90.0 },
                uBubbleScaleC: { value: config.bubbleScaleC ?? 138.0 },
                uBubbleRadiusA: { value: config.bubbleRadiusA ?? 0.31 },
                uBubbleRadiusB: { value: config.bubbleRadiusB ?? 0.27 },
                uBubbleRadiusC: { value: config.bubbleRadiusC ?? 0.23 },
                uBubbleRiseSpeed: { value: config.bubbleRiseSpeed ?? 0.38 },
                uBubbleDisplacement: { value: config.bubbleDisplacement ?? 0.0024 },
                uBubbleShell: { value: config.bubbleShellThickness ?? 0.09 },
                uBubbleHighlightStrength: { value: config.bubbleHighlightStrength ?? 0.055 }
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
            this.overlayMesh.renderOrder = -1;

            this.isInitialized = true;
            log('PotionBubblesEffect: Initialized');
        } catch (error) {
            console.error('PotionBubblesEffect: init failed:', error);
            throw error;
        }
    }

    update(deltaTime) {
        if (!this.isInitialized || !this.overlayMesh || !this.uniforms) return;

        this._frameCounter++;
        const dt = Number.isFinite(deltaTime) && deltaTime > 0 ? deltaTime : 0.016;
        this.time += dt;
        this.uniforms.uTime.value = this.time;

        const c = this.getConfig();

        this.uniforms.map.value = this.parallax.imageTexture;

        this.uniforms.uMaskSource.value = maskChannelToFloat(c.maskChannel);
        this.uniforms.uMaskThreshold.value = this._maskThresholdNormalized(c);
        this.uniforms.uMaskInvert.value = c.maskInvert ? 1.0 : 0.0;
        this.uniforms.uOpacity.value = c.opacity ?? this.uniforms.uOpacity.value;

        this.uniforms.uLiquidShakeStrength.value = c.liquidShakeStrength ?? this.uniforms.uLiquidShakeStrength.value;
        this.uniforms.uLiquidShakeSpeed.value = c.liquidShakeSpeed ?? this.uniforms.uLiquidShakeSpeed.value;
        this.uniforms.uLiquidShakeScale.value = c.liquidShakeScale ?? this.uniforms.uLiquidShakeScale.value;

        this._syncPotionTuning(c);

        this.uniforms.uBubbleScaleA.value = c.bubbleScaleA ?? this.uniforms.uBubbleScaleA.value;
        this.uniforms.uBubbleScaleB.value = c.bubbleScaleB ?? this.uniforms.uBubbleScaleB.value;
        this.uniforms.uBubbleScaleC.value = c.bubbleScaleC ?? this.uniforms.uBubbleScaleC.value;
        this.uniforms.uBubbleRadiusA.value = c.bubbleRadiusA ?? this.uniforms.uBubbleRadiusA.value;
        this.uniforms.uBubbleRadiusB.value = c.bubbleRadiusB ?? this.uniforms.uBubbleRadiusB.value;
        this.uniforms.uBubbleRadiusC.value = c.bubbleRadiusC ?? this.uniforms.uBubbleRadiusC.value;
        this.uniforms.uBubbleRiseSpeed.value = c.bubbleRiseSpeed ?? this.uniforms.uBubbleRiseSpeed.value;
        this.uniforms.uBubbleDisplacement.value = c.bubbleDisplacement ?? this.uniforms.uBubbleDisplacement.value;
        this.uniforms.uBubbleShell.value = c.bubbleShellThickness ?? this.uniforms.uBubbleShell.value;
        this.uniforms.uBubbleHighlightStrength.value =
            c.bubbleHighlightStrength ?? this.uniforms.uBubbleHighlightStrength.value;

        this.syncWithParallaxMesh(this.overlayMesh);
        this.overlayMesh.position.z = c.depthBias ?? 0.011;
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

export default PotionBubblesEffect;
