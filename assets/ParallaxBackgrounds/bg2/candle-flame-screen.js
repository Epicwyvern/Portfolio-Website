// Candle flame screen — UV quad pointer proximity; warm U-shaped fire border on hover.
// Renders heavy shader to a low-res RT (~90% fewer fragments), composites fullscreen (like screen-vignette).

import BaseEffect from '../../../js/base-effect.js';
import * as THREE from 'https://unpkg.com/three@0.172.0/build/three.module.js';

const log = (...args) => {
    if (window.location.pathname.endsWith('test-effects.html')) {
        console.log(...args);
    }
};

/**
 * Maps mesh UV + projection mode to canvas CSS pixels (matches pointer coords from getBoundingClientRect).
 * Used for proximity quad corners. Scratch vectors avoid per-frame allocation.
 */
export function projectFlameAnchorToCanvasPixels(parallax, camera, flame, cfg, rect, proj, wpos, uvDisp) {
    if (!parallax || !camera || !rect || !flame) return null;
    const mode = cfg.flameProjection ?? 'meshSurface';
    const t = parallax.meshTransform;
    if (!t) return null;

    camera.updateMatrixWorld(true);

    if (mode === 'texturePlane' || mode === 'texturePlaneFlipY') {
        const mw = t.baseGeometrySize?.width * t.scale ?? 1;
        const mh = t.baseGeometrySize?.height * t.scale ?? 1;
        let u = flame.x;
        let v = flame.y;
        if (mode === 'texturePlaneFlipY') v = 1 - v;
        const wx = (u - 0.5) * mw + t.position.x;
        const wy = (v - 0.5) * mh + t.position.y;
        const wz = flame.z ?? cfg.flameZ ?? 0.5;
        wpos.set(wx, wy, wz);
        if (parallax.getParallaxDisplacementForUV) {
            parallax.getParallaxDisplacementForUV(flame.x, flame.y, uvDisp);
            wpos.x += uvDisp.x;
            wpos.y += uvDisp.y;
        }
        proj.copy(wpos).project(camera);
    } else {
        if (!parallax.getWorldPositionForUV || !parallax.mesh) return null;
        parallax.mesh.updateWorldMatrix(true, false);
        const u = flame.x;
        const v = mode === 'meshSurfaceVFlip' || mode === 'meshSurfaceFlipY' ? 1 - flame.y : flame.y;
        parallax.getWorldPositionForUV(u, v, 0, wpos);
        if (parallax.getParallaxDisplacementForUV) {
            parallax.getParallaxDisplacementForUV(u, v, uvDisp);
            wpos.x += uvDisp.x;
            wpos.y += uvDisp.y;
        }
        proj.copy(wpos).project(camera);
    }

    const px = (proj.x * 0.5 + 0.5) * rect.width;
    const py = (0.5 - proj.y * 0.5) * rect.height;
    return { px, py };
}

/**
 * Maps a proximity-quad corner (UV 0–1 on the parallax texture / mesh) to canvas CSS pixels.
 * By default uses {@link SimpleParallax#getWorldPositionForUV} so the point sits on the **mesh surface**
 * (correct depth), then applies {@link SimpleParallax#getParallaxDisplacementForUV} so the quad follows
 * mouse/tilt parallax like the rendered scene. Set `proximityQuad.planarProjection` to fall back to
 * {@link projectFlameAnchorToCanvasPixels} (flat `flameProjection` plane — does not track mesh depth).
 */
export function projectProximityQuadCornerToCanvasPixels(parallax, camera, corner, cfg, quadCfg, rect, proj, wpos, uvDisp) {
    if (!parallax || !camera || !rect || !corner) return null;
    const zDef = cfg.flameZ ?? 0;
    if (quadCfg?.planarProjection === true) {
        return projectFlameAnchorToCanvasPixels(
            parallax,
            camera,
            { x: corner.x, y: corner.y, z: corner.z != null ? corner.z : zDef },
            cfg,
            rect,
            proj,
            wpos,
            uvDisp
        );
    }
    if (parallax.getWorldPositionForUV && parallax.mesh) {
        camera.updateMatrixWorld(true);
        parallax.mesh.updateWorldMatrix(true, false);
        const mode = cfg.flameProjection ?? 'meshSurface';
        const u = corner.x;
        let v = corner.y;
        const flipV =
            mode === 'meshSurfaceVFlip' ||
            mode === 'meshSurfaceFlipY' ||
            mode === 'texturePlaneFlipY';
        if (flipV) v = 1 - corner.y;
        parallax.getWorldPositionForUV(u, v, 0, wpos);
        if (parallax.getParallaxDisplacementForUV) {
            parallax.getParallaxDisplacementForUV(u, v, uvDisp);
            wpos.x += uvDisp.x;
            wpos.y += uvDisp.y;
        }
        proj.copy(wpos).project(camera);
        const px = (proj.x * 0.5 + 0.5) * rect.width;
        const py = (0.5 - proj.y * 0.5) * rect.height;
        return { px, py };
    }
    return projectFlameAnchorToCanvasPixels(
        parallax,
        camera,
        { x: corner.x, y: corner.y, z: corner.z != null ? corner.z : zDef },
        cfg,
        rect,
        proj,
        wpos,
        uvDisp
    );
}

function smoothstep01Proximity(x) {
    const v = Math.max(0, Math.min(1, x));
    return v * v * (3 - 2 * v);
}

function pointInConvexQuad(px, py, q) {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
        const a = q[i];
        const b = q[(i + 1) % 4];
        const cross = (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x);
        if (Math.abs(cross) > 1e-9) {
            const s = cross > 0 ? 1 : -1;
            if (sign === 0) sign = s;
            else if (sign !== s) return false;
        }
    }
    return sign !== 0;
}

function distPointToSegmentPx(px, py, ax, ay, bx, by) {
    const abx = bx - ax;
    const aby = by - ay;
    const apx = px - ax;
    const apy = py - ay;
    const ab2 = abx * abx + aby * aby;
    let t = ab2 > 1e-12 ? (apx * abx + apy * aby) / ab2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * abx;
    const cy = ay + t * aby;
    const dx = px - cx;
    const dy = py - cy;
    return Math.sqrt(dx * dx + dy * dy);
}

/** Shortest distance from point to quad edges (px space). If inside, distance to boundary is 0 for “outside” tests — use signed exterior distance instead. */
function distanceExteriorToConvexQuad(px, py, q) {
    const inside = pointInConvexQuad(px, py, q);
    if (inside) return 0;
    let minD = Infinity;
    for (let i = 0; i < 4; i++) {
        const a = q[i];
        const b = q[(i + 1) % 4];
        const d = distPointToSegmentPx(px, py, a.x, a.y, b.x, b.y);
        if (d < minD) minD = d;
    }
    return minD;
}

const DEFAULT_QUAD_OUTER_BAND = 0.15;

/**
 * Quad-only proximity: inside quad → flameProximity 1; outside → falloff within outer band.
 * vignetteTarget: 0 inside quad (when vignetteFade enabled); outside ramps to 1 over same band.
 * Requires four valid corners; otherwise no candle proximity (flame 0, vignette full).
 * @returns {{ flameProximity: number, vignetteTarget: number, quadCornersPx: Array<{x:number,y:number}>|null }}
 */
export function computeCandleProximityMetrics(parallax, camera, cfg, mousePixelX, mousePixelY, rect, scratch) {
    const s = scratch || {};
    const proj = s.proj ?? (s.proj = new THREE.Vector3());
    const wpos = s.wpos ?? (s.wpos = new THREE.Vector3());
    const uvDisp = s.uvDisp ?? (s.uvDisp = new THREE.Vector2());

    if (!parallax || !camera || !rect || cfg.enabled === false) {
        return { flameProximity: 0, vignetteTarget: 1, quadCornersPx: null };
    }
    if (!parallax.meshTransform) {
        return { flameProximity: 0, vignetteTarget: 1, quadCornersPx: null };
    }

    const minDim = Math.min(rect.width, rect.height);
    const vf = cfg.vignetteFade ?? {};
    const outerMax = cfg.proximityOuterMax ?? 0.3;

    const quadCfg = cfg.proximityQuad;
    let quadCornersPx = null;
    const corners = quadCfg?.corners;
    const hasQuad = Array.isArray(corners) && corners.length === 4;

    if (hasQuad) {
        const projected = [];
        let ok = true;
        for (let i = 0; i < 4; i++) {
            const p = projectProximityQuadCornerToCanvasPixels(
                parallax,
                camera,
                corners[i],
                cfg,
                quadCfg,
                rect,
                proj,
                wpos,
                uvDisp
            );
            if (!p) {
                ok = false;
                break;
            }
            projected.push({ x: p.px, y: p.py });
        }
        if (ok) quadCornersPx = projected;
    }

    if (!quadCornersPx) {
        return { flameProximity: 0, vignetteTarget: 1, quadCornersPx: null };
    }

    const outerBandPx =
        quadCfg.outerBandPixels != null
            ? quadCfg.outerBandPixels
            : quadCfg.outerBand != null
              ? quadCfg.outerBand * minDim
              : DEFAULT_QUAD_OUTER_BAND * minDim;
    const band = Math.max(2, outerBandPx);

    const mx = mousePixelX;
    const my = mousePixelY;
    const inside = pointInConvexQuad(mx, my, quadCornersPx);

    let flameProximity = 0;
    if (inside) {
        flameProximity = 1;
    } else {
        const d = distanceExteriorToConvexQuad(mx, my, quadCornersPx);
        if (d < band) {
            const ringRaw = (band - d) / band;
            flameProximity = outerMax * smoothstep01Proximity(ringRaw);
        }
    }

    let vignetteTarget = 1;
    if (vf.enabled !== false) {
        if (inside) {
            vignetteTarget = 0;
        } else {
            const d = distanceExteriorToConvexQuad(mx, my, quadCornersPx);
            if (d >= band) vignetteTarget = 1;
            else vignetteTarget = smoothstep01Proximity(d / band);
        }
    }

    return { flameProximity, vignetteTarget, quadCornersPx };
}

const COMPOSITE_FRAGMENT_SHADER = `
    uniform sampler2D uFlameTexture;
    varying vec2 vUv;
    void main() {
        gl_FragColor = texture2D(uFlameTexture, vUv);
    }
`;

const SIMPLEX_NOISE_GLSL = `
vec3 mod289_3(vec3 x) {
    return x - floor(x * (1.0 / 289.0)) * 289.0;
}
vec4 mod289_4(vec4 x) {
    return x - floor(x * (1.0 / 289.0)) * 289.0;
}
vec4 permute(vec4 x) {
    return mod289_4(((x * 34.0) + 1.0) * x);
}

float snoise(vec3 v) {
    vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289_3(i);
    vec4 p = permute(permute(permute(
        i.z + vec4(0.0, i1.z, i2.z, 1.0))
        + i.y + vec4(0.0, i1.y, i2.y, 1.0))
        + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = inversesqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

float noiseStack2(vec3 pos, float falloff) {
    float noise = snoise(pos);
    float off = 1.0;
    pos *= 2.0;
    off *= falloff;
    noise = (1.0 - off) * noise + off * snoise(pos);
    return (1.0 + noise) / 2.0;
}

vec2 noiseStackUV(vec3 pos, float falloff) {
    float da = noiseStack2(pos, falloff);
    float db = noiseStack2(pos + vec3(3984.293, 423.21, 5235.19), falloff);
    return vec2(da, db);
}

// Single-octave UV for spark coordinate warp (McEwan / Shadertoy style).
vec2 noiseStackUV1Oct(vec3 pos) {
    float da = (1.0 + snoise(pos)) * 0.5;
    float db = (1.0 + snoise(pos + vec3(3984.293, 423.21, 5235.19))) * 0.5;
    return vec2(da, db);
}
`;

const FLAME_PASS_FRAGMENT_SHADER = `
    uniform vec2 uResolution;
    uniform float uTime;
    uniform float uIntensity;
    uniform float uBorderReach;
    uniform float uCoordScale;
    uniform float uTimeScale;
    uniform float uSheenPower;
    uniform float uFlameExp;
    uniform float uStackFalloff;
    uniform float uStrength;
    uniform float uSootStrength;
    uniform vec3 uColorCore;
    uniform vec3 uColorTip;
    uniform vec3 uColorSoot;
    uniform float uSideFadeStart;
    uniform float uSideFadeEnd;
    uniform float uOutputBoost;
    uniform float uXfuelMin;
    uniform float uSparkStrength;
    uniform float uSparkGridSize;
    uniform float uSparkFlowAdvect;
    uniform float uFlowWobbleAmp;
    uniform float uFlowWobbleSpeed;
    uniform float uEdgeFuelMix;
    uniform float uEdgeXfuelTarget;
    uniform float uEdgeFuelBottomFalloff;
    uniform float uEdgeFuelSideFalloff;
    uniform float uSideEdgeFuelWeight;
    uniform float uSideRiseMaxPull;
    uniform float uSideRiseWallSpan;
    uniform float uSideRiseFragLift;

    varying vec2 vUv;

    ${SIMPLEX_NOISE_GLSL}

    float sideVerticalMask(float yNorm) {
        return 1.0 - smoothstep(uSideFadeStart, uSideFadeEnd, yNorm);
    }

    float hash12(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
    }

    vec2 fireSheet(vec2 frag, float xpart, float ypartClipped, float realTime, vec3 seed, float xfuel) {
        float ypartClippedn = 1.0 - ypartClipped;

        vec3 position = vec3(uCoordScale * frag, 0.0) + seed;

        // Rise is vertical (negative Y in noise space + timing); horizontal is symmetric wobble only
        // — no (0.5 - xpart) term (that biased the whole field left / right).
        float flowX = uFlowWobbleAmp * sin((xpart - 0.5) * 6.2831853 + realTime * uFlowWobbleSpeed) * pow(ypartClippedn, 4.0);
        vec3 flow = vec3(
            flowX,
            -2.0 * xfuel * pow(ypartClippedn, 64.0),
            0.0
        );
        vec3 timing = realTime * vec3(0.0, -1.7, 1.1) + flow;

        vec3 displacePos = vec3(1.0, 0.5, 1.0) * 2.4 * position + realTime * vec3(0.01, -0.7, 1.3);
        vec2 uvD = noiseStackUV(displacePos, uStackFalloff);
        vec3 displace3 = vec3(uvD, 0.0);

        vec3 noiseCoord = vec3(2.0, 1.0, 1.0) * position + timing + 0.4 * displace3;
        float noise = noiseStack2(noiseCoord, uStackFalloff);

        float expn = uFlameExp * xfuel;
        float flames = pow(max(ypartClipped, 0.0001), expn) * pow(clamp(noise, 0.001, 0.999), expn);

        float ypartClippedFalloff = clamp(2.0 - ypartClipped * 1.22, 0.0, 1.0);
        float f = ypartClippedFalloff * pow(max(1.0 - flames * flames * flames, 0.0), uSheenPower);
        float fff = f * f * f;
        return vec2(f, fff);
    }

    void main() {
        float aspect = uResolution.x / max(1.0, uResolution.y);

        if (uIntensity <= 0.001) {
            gl_FragColor = vec4(0.0);
            return;
        }

        vec2 frag = gl_FragCoord.xy;
        float xNorm = frag.x / max(1.0, uResolution.x);
        float yNorm = frag.y / max(1.0, uResolution.y);
        float rt = uTime * uTimeScale;
        float reach = max(0.02, uBorderReach);

        float sm = sideVerticalMask(yNorm);
        float db = clamp(yNorm / reach, 0.0, 1.0);
        float dl = clamp(xNorm * aspect / reach, 0.0, 1.0);
        float dr = clamp((1.0 - xNorm) * aspect / reach, 0.0, 1.0);
        float hWalls = min(dl, dr);

        // Side "shelf" fix: when sm→0, min(db, mix(1,hWalls,sm)) jumps to db. Pull effective y
        // downward on wall columns so fireSheet samples the field as if lower on the wall — wisps
        // keep rising past the logical side cutoff instead of clipping to a horizontal line.
        float span = max(0.06, uSideRiseWallSpan);
        float nearL = 1.0 - smoothstep(0.0, span, dl);
        float nearR = 1.0 - smoothstep(0.0, span, dr);
        float wallCol = max(nearL, nearR);
        float riseRamp = smoothstep(uSideFadeStart, uSideFadeEnd, yNorm);
        float yPull = wallCol * riseRamp * uSideRiseMaxPull;
        float yEff = clamp(yNorm - yPull, 0.0, 1.0);
        float smEff = sideVerticalMask(yEff);
        float dbEff = clamp(yEff / reach, 0.0, 1.0);
        float hBlendEff = mix(1.0, hWalls, smEff);
        float hU = min(dbEff, hBlendEff);

        float fragLiftPx = wallCol * riseRamp * uSideRiseFragLift * uResolution.y;
        vec2 fragFire = frag - vec2(0.0, fragLiftPx);
        // Must use true horizontal position for xpart. mix(xNorm, yNorm, sm*0.45) at the bottom
        // has yNorm≈0 so xpart≈0.55*xNorm — that squashes [0,1]→[0,0.55] and makes
        // xfuel = 1-|2*xpart-1| peak toward the RIGHT (bottom-right hotspot, thin center).
        float xpart = xNorm;

        // Bell-shaped in x (McEwan) is strong at screen center, weak at left/right — bad for a U border.
        // Blend toward high xfuel when close to the bottom band or to either vertical side.
        float xfuBell = max(uXfuelMin, 1.0 - abs(2.0 * xNorm - 1.0));
        float nearBottom = 1.0 - smoothstep(0.0, max(0.04, uEdgeFuelBottomFalloff), db);
        float dWall = min(dl, dr);
        float nearWall = sm * (1.0 - smoothstep(0.0, max(0.02, uEdgeFuelSideFalloff), dWall)) * uSideEdgeFuelWeight;
        float edgeBlend = clamp(max(nearBottom, nearWall), 0.0, 1.0);
        float xfu = mix(xfuBell, uEdgeXfuelTarget, uEdgeFuelMix * edgeBlend);

        float ypn = 1.0 - hU;
        float flowXSpark = uFlowWobbleAmp * sin((xpart - 0.5) * 6.2831853 + rt * uFlowWobbleSpeed) * pow(ypn, 4.0);
        float flowYSpark = -2.0 * xfu * pow(ypn, 64.0);

        vec2 m = fireSheet(fragFire, xpart, hU, rt, vec3(1223.0, 6434.0, 8425.0), xfu);
        float f = m.x;
        float fff = m.y;

        vec3 smokePos = vec3(uCoordScale * frag, 0.0) + vec3(500.0, 2000.0, 300.0);
        float smokeN = 0.5 + snoise(0.4 * smokePos + vec3(rt * 0.9, rt * 1.1, rt * 0.2)) * 0.5;
        float xfuelG = max(0.2, 1.0 - abs(2.0 * xNorm - 1.0));
        float smokeAmt = uSootStrength * (1.0 - f) * pow(xfuelG, 2.0) * yNorm * smokeN * 0.65;

        float bottomBand = 1.0 - smoothstep(0.0, 0.32, yNorm);
        vec3 sparkRgb = vec3(0.0);
        if (yNorm < 0.38) {
            float PI_SP = 3.14159265359;
            float gsz = max(6.0, uSparkGridSize);
            vec2 sparkCoord = frag.xy - vec2(0.0, 190.0 * rt);
            vec3 sparkWarpIn = vec3(0.01 * sparkCoord.xy, 0.01 * 30.0 * uTime);
            sparkCoord -= 30.0 * noiseStackUV1Oct(sparkWarpIn);
            sparkCoord += uSparkFlowAdvect * vec2(flowXSpark, flowYSpark);
            if (mod(sparkCoord.y / gsz, 2.0) < 1.0) {
                sparkCoord.x += 0.5 * gsz;
            }
            vec2 sparkGridIndex = floor(sparkCoord / gsz);
            float sparkRandom = hash12(sparkGridIndex + vec2(4.71, 2.18));
            float lifeDenom = max(0.5, 24.0 - 20.0 * sparkRandom);
            float sparkLife = min(10.0 * (1.0 - min((sparkGridIndex.y + (190.0 * rt / gsz)) / lifeDenom, 1.0)), 1.0);

            vec3 sparkTone = mix(uColorCore, uColorTip, 0.38);
            vec3 sparksOut = vec3(0.0);
            if (sparkLife > 0.001) {
                float sparkSize = xfu * xfu * sparkRandom * 0.08;
                float sparkRadians = 999.0 * sparkRandom * 2.0 * PI_SP + 2.0 * uTime;
                vec2 sparkCircular = vec2(sin(sparkRadians), cos(sparkRadians));
                vec2 sparkOffset = (0.5 - sparkSize) * gsz * sparkCircular;
                vec2 sparkModulus = mod(sparkCoord + sparkOffset, gsz) - 0.5 * vec2(gsz);
                float sparkLength = length(sparkModulus);
                float denom = max(0.0001, sparkSize * gsz);
                float sparksGray = max(0.0, 1.0 - sparkLength / denom);
                sparksOut = sparkLife * sparksGray * sparkTone * (uSparkStrength * 1.35);
            }
            float edgeSparkMask = max(f, bottomBand * 0.85);
            sparkRgb = sparksOut * bottomBand * mix(0.5, 1.0, edgeSparkMask);
        }

        vec3 fireRgb =
            uColorCore * (0.18 + 1.05 * f) +
            uColorTip * (fff * 1.05) +
            uColorSoot * ((1.0 - f) * 0.2 * uSootStrength);
        vec3 smokeRgb = uColorSoot * smokeAmt * 0.45;
        vec3 rgb = (fireRgb + smokeRgb + sparkRgb) * uOutputBoost;

        float vis = uStrength * uIntensity;
        vec3 outRgb = min(rgb * vis, vec3(3.0));
        gl_FragColor = vec4(outRgb, 1.0);
    }
`;

class CandleFlameScreenEffect extends BaseEffect {
    constructor(scene, camera, renderer, parallaxInstance) {
        super(scene, camera, renderer, parallaxInstance);
        this.effectType = 'screen';
        this.mousePixelX = -1;
        this.mousePixelY = -1;
        this.proximityBlend = 0;
        this._frameCounter = 0;
        this._cachedRect = null;
        this._cachedRectFrame = -1;
    }

    getConfig() {
        return this.parallax?.config?.effects?.candleFlameScreen ?? {};
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

    _ensureQuadDebugOverlay() {
        if (this._quadDebugSvg) return;
        const canvas = this.parallax?.canvas;
        const parent = canvas?.parentElement;
        if (!canvas || !parent) return;
        const pos = getComputedStyle(parent).position;
        if (pos === 'static' || pos === '') parent.style.position = 'relative';
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('data-candle-quad-debug', '1');
        svg.style.position = 'absolute';
        svg.style.pointerEvents = 'none';
        svg.style.zIndex = '10';
        svg.style.overflow = 'visible';
        const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        svg.appendChild(poly);
        parent.appendChild(svg);
        this._quadDebugSvg = svg;
        this._quadDebugPoly = poly;
    }

    _updateQuadDebugOverlay(quadCornersPx) {
        const q = this.getConfig().proximityQuad ?? {};
        const want = q.highlight === true;
        if (!want) {
            if (this._quadDebugSvg) this._quadDebugSvg.style.display = 'none';
            return;
        }
        this._ensureQuadDebugOverlay();
        if (!this._quadDebugSvg || !this._quadDebugPoly) return;
        const canvas = this.parallax?.canvas;
        if (!canvas || !quadCornersPx || quadCornersPx.length !== 4) {
            this._quadDebugSvg.style.display = 'none';
            return;
        }
        this._quadDebugSvg.style.display = 'block';
        this._quadDebugSvg.style.left = `${canvas.offsetLeft}px`;
        this._quadDebugSvg.style.top = `${canvas.offsetTop}px`;
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        this._quadDebugSvg.style.width = `${w}px`;
        this._quadDebugSvg.style.height = `${h}px`;
        this._quadDebugSvg.setAttribute('viewBox', `0 0 ${w} ${h}`);
        this._quadDebugSvg.setAttribute('width', '100%');
        this._quadDebugSvg.setAttribute('height', '100%');
        const pts = quadCornersPx.map((p) => `${p.x},${p.y}`).join(' ');
        this._quadDebugPoly.setAttribute('points', pts);
        this._quadDebugPoly.setAttribute('fill', q.highlightFill ?? 'rgba(255, 140, 40, 0.22)');
        this._quadDebugPoly.setAttribute('stroke', q.highlightStroke ?? 'rgba(255, 220, 120, 0.85)');
        this._quadDebugPoly.setAttribute('stroke-width', String(q.highlightStrokeWidth ?? 2));
    }

    computeInnerProximity(mousePixelX, mousePixelY) {
        const cfg = this.getConfig();
        const rect = this._getCanvasRect();
        if (!rect || !this.camera) return 0;
        const scratch =
            this._proxScratch ??
            (this._proxScratch = {
                proj: this._projVec ?? (this._projVec = new THREE.Vector3()),
                wpos: this._flameWorldScratch ?? (this._flameWorldScratch = new THREE.Vector3()),
                uvDisp: this._flameDispScratch ?? (this._flameDispScratch = new THREE.Vector2())
            });
        return computeCandleProximityMetrics(
            this.parallax,
            this.camera,
            cfg,
            mousePixelX,
            mousePixelY,
            rect,
            scratch
        ).flameProximity;
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
        mesh.renderOrder = 10000;
        mesh.userData.isScreenEffect = true;
        mesh.userData.distanceFromCamera = distanceFromCamera;
        return mesh;
    }

    applyConfig(config) {
        this.halfResScale = config.halfResScale ?? 0.35;
        this.borderReach = config.borderReach ?? 0.17;
        this.coordScale = config.coordScale ?? 0.0065;
        this.timeScale = config.timeScale ?? 0.52;
        this.sheenPower = config.sheenPower ?? 5.5;
        this.flameExp = config.flameExp ?? 0.26;
        this.stackFalloff = config.stackFalloff ?? 0.42;
        this.sootStrength = config.sootStrength ?? 0.32;
        this.strength = config.strength ?? 0.52;
        this.blendSpeed = config.blendSpeed ?? 0.1;
        this.colorCore = this.parseColor(config.colorCore ?? '0xffe8b0');
        this.colorTip = this.parseColor(config.colorTip ?? '0xff6610');
        this.colorSoot = this.parseColor(config.colorSoot ?? '0x3d1810');
        this.sideFadeStart = config.sideFadeStart ?? 0.36;
        this.sideFadeEnd = config.sideFadeEnd ?? 0.52;
        this.outputBoost = config.outputBoost ?? 2.2;
        this.xfuelMin = config.xfuelMin ?? 0.45;
        this.sparkStrength = config.sparkStrength ?? 0.85;
        this.sparkGridSize = config.sparkGridSize ?? 28.0;
        this.sparkFlowAdvect = config.sparkFlowAdvect ?? 42.0;
        this.flowWobbleAmp = config.flowWobbleAmp ?? 1.15;
        this.flowWobbleSpeed = config.flowWobbleSpeed ?? 0.48;
        this.edgeFuelMix = config.edgeFuelMix ?? 0.78;
        this.edgeXfuelTarget = config.edgeXfuelTarget ?? 0.95;
        this.edgeFuelBottomFalloff = config.edgeFuelBottomFalloff ?? 0.52;
        this.edgeFuelSideFalloff = config.edgeFuelSideFalloff ?? 0.48;
        this.sideEdgeFuelWeight = config.sideEdgeFuelWeight ?? 1.0;
        this.sideRiseMaxPull = config.sideRiseMaxPull ?? 0.18;
        this.sideRiseWallSpan = config.sideRiseWallSpan ?? 0.38;
        this.sideRiseFragLift = config.sideRiseFragLift ?? 0.38;
    }

    parseColor(hex) {
        if (typeof hex === 'string') {
            const s = hex.replace(/^0x|^#/, '');
            const n = parseInt(s, 16);
            if (!isNaN(n)) return new THREE.Color(n);
        }
        return new THREE.Color(0xffaa44);
    }

    _resizeFlameRT() {
        if (!this.flameRT || !this.flamePassMesh?.material?.uniforms) return;
        const scale = this.halfResScale;
        const w = Math.max(1, Math.floor(this.renderer.domElement.width * scale));
        const h = Math.max(1, Math.floor(this.renderer.domElement.height * scale));
        this.flameRT.setSize(w, h);
        this.flamePassMesh.material.uniforms.uResolution.value.set(w, h);
        this.updateScreenEffectViewport(this.compositeMesh);
    }

    init() {
        log('CandleFlameScreenEffect: Initializing');
        const config = this.getConfig();
        this.applyConfig(config);

        const uniforms = {
            uIntensity: { value: 0 },
            uBorderReach: { value: this.borderReach },
            uCoordScale: { value: this.coordScale },
            uTimeScale: { value: this.timeScale },
            uSheenPower: { value: this.sheenPower },
            uFlameExp: { value: this.flameExp },
            uStackFalloff: { value: this.stackFalloff },
            uStrength: { value: this.strength },
            uSootStrength: { value: this.sootStrength },
            uColorCore: { value: this.colorCore.clone() },
            uColorTip: { value: this.colorTip.clone() },
            uColorSoot: { value: this.colorSoot.clone() },
            uSideFadeStart: { value: this.sideFadeStart },
            uSideFadeEnd: { value: this.sideFadeEnd },
            uOutputBoost: { value: this.outputBoost },
            uXfuelMin: { value: this.xfuelMin },
            uSparkStrength: { value: this.sparkStrength },
            uSparkGridSize: { value: this.sparkGridSize },
            uSparkFlowAdvect: { value: this.sparkFlowAdvect },
            uFlowWobbleAmp: { value: this.flowWobbleAmp },
            uFlowWobbleSpeed: { value: this.flowWobbleSpeed },
            uEdgeFuelMix: { value: this.edgeFuelMix },
            uEdgeXfuelTarget: { value: this.edgeXfuelTarget },
            uEdgeFuelBottomFalloff: { value: this.edgeFuelBottomFalloff },
            uEdgeFuelSideFalloff: { value: this.edgeFuelSideFalloff },
            uSideEdgeFuelWeight: { value: this.sideEdgeFuelWeight },
            uSideRiseMaxPull: { value: this.sideRiseMaxPull },
            uSideRiseWallSpan: { value: this.sideRiseWallSpan },
            uSideRiseFragLift: { value: this.sideRiseFragLift }
        };

        this.flamePassMesh = this.createScreenEffectMesh(FLAME_PASS_FRAGMENT_SHADER, uniforms, {
            blending: THREE.NoBlending,
            depthTest: false,
            depthWrite: false,
            syncResolutionUniform: false
        });
        this.scene.remove(this.flamePassMesh);
        this.flameScene = new THREE.Scene();
        this.flameScene.add(this.flamePassMesh);

        const scale = this.halfResScale;
        const w = Math.max(1, Math.floor(this.renderer.domElement.width * scale));
        const h = Math.max(1, Math.floor(this.renderer.domElement.height * scale));
        this.flameRT = new THREE.WebGLRenderTarget(w, h, {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
            type: THREE.UnsignedByteType,
            stencilBuffer: false,
            depthBuffer: false
        });
        this.flamePassMesh.material.uniforms.uResolution.value.set(w, h);

        const compositeMaterial = new THREE.ShaderMaterial({
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: COMPOSITE_FRAGMENT_SHADER,
            uniforms: { uFlameTexture: { value: this.flameRT.texture } },
            transparent: true,
            depthTest: false,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.FrontSide
        });
        this.compositeMesh = this._createCompositeScreenQuad(new THREE.PlaneGeometry(1, 1), compositeMaterial);
        this.compositeMesh.visible = false;
        this.scene.add(this.compositeMesh);
        this.meshes.push(this.compositeMesh);
        this.materials.push(compositeMaterial);

        this._unsubFlameResize = this.onRendererCanvasResize(() => {
            this._invalidateRectCache();
            this._resizeFlameRT();
        });
        this._resizeFlameRT();

        this.uniforms = this.flamePassMesh.material.uniforms;
        this.setupMouseTracking();
        this.isInitialized = true;
        log('CandleFlameScreenEffect: Initialized (half-res RT)');
    }

    update(deltaTime) {
        if (!this.isInitialized || !this.uniforms) return;
        this._frameCounter++;
        this.uniforms.uTime.value += deltaTime;

        let px = this.mousePixelX;
        let py = this.mousePixelY;
        if (px < 0 || py < 0) {
            const rect = this._getCanvasRect();
            if (rect) {
                px = rect.width * 0.5;
                py = rect.height * 0.5;
            }
        }
        const rect = this._getCanvasRect();
        const scratch =
            this._proxScratch ??
            (this._proxScratch = {
                proj: this._projVec ?? (this._projVec = new THREE.Vector3()),
                wpos: this._flameWorldScratch ?? (this._flameWorldScratch = new THREE.Vector3()),
                uvDisp: this._flameDispScratch ?? (this._flameDispScratch = new THREE.Vector2())
            });
        const metrics = rect
            ? computeCandleProximityMetrics(this.parallax, this.camera, this.getConfig(), px, py, rect, scratch)
            : { flameProximity: 0, quadCornersPx: null };
        this._updateQuadDebugOverlay(metrics.quadCornersPx);
        const target = metrics.flameProximity;
        this.proximityBlend += (target - this.proximityBlend) * this.blendSpeed;
        this.uniforms.uIntensity.value = this.proximityBlend;

        if (this.compositeMesh) {
            this.compositeMesh.visible = this.proximityBlend > 0.002;
        }
    }

    renderPrePass(renderer, camera) {
        if (!this.isInitialized || !this.flameRT || !this.flameScene || !this.flamePassMesh) return;
        if (this.proximityBlend < 0.002) return;

        renderer.setRenderTarget(this.flameRT);
        renderer.clear();
        renderer.render(this.flameScene, camera);
        renderer.setRenderTarget(null);
    }

    updateUniformsFromConfig(config) {
        if (!this.uniforms) return;
        this.applyConfig(config ?? this.getConfig());
        const u = this.uniforms;
        u.uBorderReach.value = this.borderReach;
        u.uCoordScale.value = this.coordScale;
        u.uTimeScale.value = this.timeScale;
        u.uSheenPower.value = this.sheenPower;
        u.uFlameExp.value = this.flameExp;
        u.uStackFalloff.value = this.stackFalloff;
        u.uStrength.value = this.strength;
        u.uSootStrength.value = this.sootStrength;
        u.uColorCore.value.copy(this.colorCore);
        u.uColorTip.value.copy(this.colorTip);
        u.uColorSoot.value.copy(this.colorSoot);
        u.uSideFadeStart.value = this.sideFadeStart;
        u.uSideFadeEnd.value = this.sideFadeEnd;
        u.uOutputBoost.value = this.outputBoost;
        u.uXfuelMin.value = this.xfuelMin;
        u.uSparkStrength.value = this.sparkStrength;
        u.uSparkGridSize.value = this.sparkGridSize;
        u.uSparkFlowAdvect.value = this.sparkFlowAdvect;
        u.uFlowWobbleAmp.value = this.flowWobbleAmp;
        u.uFlowWobbleSpeed.value = this.flowWobbleSpeed;
        u.uEdgeFuelMix.value = this.edgeFuelMix;
        u.uEdgeXfuelTarget.value = this.edgeXfuelTarget;
        u.uEdgeFuelBottomFalloff.value = this.edgeFuelBottomFalloff;
        u.uEdgeFuelSideFalloff.value = this.edgeFuelSideFalloff;
        u.uSideEdgeFuelWeight.value = this.sideEdgeFuelWeight;
        u.uSideRiseMaxPull.value = this.sideRiseMaxPull;
        u.uSideRiseWallSpan.value = this.sideRiseWallSpan;
        u.uSideRiseFragLift.value = this.sideRiseFragLift;
    }

    cleanup() {
        if (typeof this._unsubFlameResize === 'function') {
            this._unsubFlameResize();
            this._unsubFlameResize = null;
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
        if (this.flameScene && this.flamePassMesh) {
            this.flameScene.remove(this.flamePassMesh);
        }
        if (this.flameRT) {
            this.flameRT.dispose();
            this.flameRT = null;
        }
        this.flameScene = null;
        this.flamePassMesh = null;
        this.uniforms = null;
        if (this._quadDebugSvg?.parentElement) {
            this._quadDebugSvg.parentElement.removeChild(this._quadDebugSvg);
        }
        this._quadDebugSvg = null;
        this._quadDebugPoly = null;
        super.cleanup();
    }
}

export default CandleFlameScreenEffect;
