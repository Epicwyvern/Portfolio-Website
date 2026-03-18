// Water Ripple Effect - Area effect for bg2: ripples on masked water regions
// Uses mask (bg2WaterBW.png) for strength 0–255 and normal map for refraction
// Uses coarse overlay geometry for performance (configurable overlaySegments)

import BaseEffect from '../../../js/base-effect.js';
import * as THREE from 'https://unpkg.com/three@0.172.0/build/three.module.js';
import WaterParticleEmitter from './water-particle-emitter.js';

const log = (...args) => {
    if (window.location.pathname.endsWith('test-effects.html')) {
        console.log(...args);
    }
};

// Default max instance counts (configurable via config.json). Higher values allow more
// simultaneous wake trail breadcrumbs + sploosh effects without eviction.
const DEFAULT_MAX_WAKE_INSTANCES = 64;
const DEFAULT_MAX_SPLOOSH_INSTANCES = 64;

const STENCIL_PREPASS_FRAGMENT = `
    uniform sampler2D maskMap;
    varying vec2 vUv;
    void main() {
        if (texture2D(maskMap, vUv).r < 0.00392) discard;
        gl_FragColor = vec4(0.0);
    }
`;

/** Ambient-only shader (no wake/sploosh) — used when simulation is disabled. */
function buildFragmentShaderAmbientOnly() {
    return `
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
        vec2 refractedUV = clamp(vUv + normal.xy * refractionStrength * maskStrength, 0.001, 0.999);
        gl_FragColor = vec4(texture2D(map, refractedUV).rgb, maskStrength);
    }
`;
}

/** Main fragment shader: ambient ripple + disturbance texture from simulation. */
function buildFragmentShaderWithDisturbance() {
    return `
    uniform sampler2D map;
    uniform sampler2D maskMap;
    uniform sampler2D rippleNormal;
    uniform sampler2D uDisturbanceTexture;
    uniform float time;
    uniform float rippleScale;
    uniform float rippleSpeed;
    uniform float refractionStrength;
    uniform float wakeTint;
    uniform float splooshTint;

    varying vec2 vUv;

    void main() {
        float maskStrength = texture2D(maskMap, vUv).r;
        if (maskStrength < 0.00392) discard;

        // AMBIENT RIPPLE
        vec2 rippleUV = vUv * rippleScale + time * rippleSpeed;
        vec3 normal = normalize(texture2D(rippleNormal, rippleUV).xyz * 2.0 - 1.0);

        // DISTURBANCE from simulation texture (displacement in R,G channels)
        vec2 disturbance = texture2D(uDisturbanceTexture, vUv).xy;

        vec2 combinedDisplacement = normal.xy + disturbance;
        vec2 refractedUV = vUv + combinedDisplacement * refractionStrength * maskStrength;
        refractedUV = clamp(refractedUV, 0.001, 0.999);
        vec4 bgColor = texture2D(map, refractedUV);

        // Subtle tint in disturbed areas
        float distMag = length(disturbance);
        float tintAmount = distMag * (wakeTint + splooshTint) * 0.5;
        vec3 tintedColor = bgColor.rgb * (1.0 - tintAmount * 0.6) + vec3(0.7, 0.85, 1.0) * tintAmount * 0.15;

        gl_FragColor = vec4(tintedColor, maskStrength);
    }
`;
}

/**
 * Builds the simulation fragment shader: diffuse + damp + inject wake/sploosh.
 * Outputs displacement (xy) to RG channels of render target.
 */
function buildSimulationFragmentShader(maxWake, maxSploosh) {
    const wakeDecls = [];
    const splooshDecls = [];
    for (let i = 0; i < maxWake; i++) {
        wakeDecls.push(`    uniform vec2 mouseInstancePos${i};`);
        wakeDecls.push(`    uniform vec2 mouseInstanceVel${i};`);
        wakeDecls.push(`    uniform float mouseInstanceAlpha${i};`);
    }
    for (let i = 0; i < maxSploosh; i++) {
        splooshDecls.push(`    uniform vec2 splooshPos${i};`);
        splooshDecls.push(`    uniform float splooshAlpha${i};`);
        splooshDecls.push(`    uniform float splooshAge${i};`);
    }

    const wakeContrib = [];
    for (let i = 0; i < maxWake; i++) {
        wakeContrib.push(`                if (mouseInstanceCount > ${i}) impulse += addWakeContribution(mouseInstancePos${i}, mouseInstanceVel${i}, mouseInstanceAlpha${i});`);
    }

    const splooshSourceVars = [];
    const splooshSourceAssign = [];
    const splooshRawSum = [];
    for (let i = 0; i < maxSploosh; i++) {
        splooshSourceVars.push(`            vec4 s${i} = vec4(0.0);`);
        splooshSourceAssign.push(`            if (splooshInstanceCount > ${i}) s${i} = splooshSourceData(splooshPos${i}, splooshAlpha${i}, splooshAge${i});`);
        splooshRawSum.push(`s${i}.xy`);
    }
    const envParts = Array.from({ length: maxSploosh }, (_, i) => `s${i}.z`);
    const buildMaxTree = (arr) => {
        if (arr.length === 1) return arr[0];
        const mid = Math.ceil(arr.length / 2);
        return `max(${buildMaxTree(arr.slice(0, mid))}, ${buildMaxTree(arr.slice(mid))})`;
    };
    const splooshCombinedEnvExpr = buildMaxTree(envParts);

    return `
    uniform sampler2D uPrevState;
    uniform sampler2D uMaskMap;
    uniform vec2 uResolution;
    uniform float uTime;
    uniform float uDiffusionStrength;
    uniform float uDampingFactor;
    uniform float uWakeImpulseStrength;
    uniform float uSplooshImpulseStrength;
    uniform float uMaxDisturbance;

    uniform float wakeStrength;
    uniform float wakeRadius;
    uniform float wakeAngle;
    uniform float wakeLength;
    uniform float wakeFrequency;
    uniform float wakeRippleSpeed;
    uniform int mouseInstanceCount;
${wakeDecls.join('\n')}

    uniform float splooshStrength;
    uniform float splooshRadius;
    uniform float splooshFrequency;
    uniform float splooshSpeed;
    uniform int splooshInstanceCount;
${splooshDecls.join('\n')}

    varying vec2 vUv;

    vec2 addWakeContribution(vec2 pos, vec2 vel, float alpha) {
        if (alpha <= 0.001) return vec2(0.0);
        float velMag = length(vel);
        if (velMag < 0.001) return vec2(0.0);
        vec2 moveDir = normalize(vel);
        vec2 perpDir = vec2(-moveDir.y, moveDir.x);
        vec2 toFrag = vUv - pos;
        float dist = length(toFrag);
        if (dist >= wakeRadius || dist < 0.0005) return vec2(0.0);
        float along = dot(toFrag, moveDir);
        float perp = dot(toFrag, perpDir);
        float absPerp = abs(perp);
        float distFalloff = 1.0 - dist / wakeRadius;
        distFalloff *= distFalloff;
        float smoothSide = perp / (absPerp + 0.005);
        vec2 displacement = vec2(0.0);
        float behind = max(0.0, -along);
        if (behind > 0.001) {
            float expectedPerp = behind * wakeAngle;
            float armDist = abs(absPerp - expectedPerp);
            float armThickness = 0.015 + behind * 0.05;
            float onArm = exp(-(armDist * armDist) / (armThickness * armThickness));
            float behindNorm = behind / max(wakeLength, 0.001);
            float lengthFade = (1.0 - smoothstep(0.6, 1.0, behindNorm)) * smoothstep(0.0, 0.01, behind);
            float phase1 = behind * wakeFrequency - uTime * wakeRippleSpeed;
            float ripple1 = sin(phase1);
            float phase2 = behind * wakeFrequency * 0.6 - uTime * wakeRippleSpeed * 0.8 + 1.5;
            float ripple2 = sin(phase2) * 0.5;
            float ripple = ripple1 + ripple2 * 0.4;
            float armIntensity = onArm * lengthFade * ripple;
            displacement += perpDir * smoothSide * armIntensity;
            float spreadPhase = dist * wakeFrequency * 0.8 - uTime * wakeRippleSpeed * 1.2;
            float spreadRipple = sin(spreadPhase) * 0.3;
            float spreadEnvelope = onArm * lengthFade * 0.4;
            displacement += normalize(toFrag) * spreadRipple * spreadEnvelope;
        }
        float ahead = max(0.0, along);
        if (ahead > 0.0 && ahead < wakeRadius * 0.3) {
            float bowFade = 1.0 - ahead / (wakeRadius * 0.3);
            bowFade *= bowFade;
            float perpFade = exp(-(absPerp * absPerp) / 0.004);
            displacement -= moveDir * bowFade * perpFade * 0.5;
        }
        float centerSpread = 0.003;
        float centerFade = exp(-(dist * dist) / centerSpread);
        if (centerFade > 0.01) displacement += normalize(toFrag) * centerFade * 0.4;
        float speedFactor = min(velMag * 2.0, 1.0);
        float smoothAlpha = alpha * alpha * (3.0 - 2.0 * alpha);
        displacement *= distFalloff * speedFactor * wakeStrength * smoothAlpha * 0.15;
        return displacement;
    }

    vec4 splooshSourceData(vec2 pos, float alpha, float age) {
        if (alpha <= 0.001 || age < 0.0) return vec4(0.0);
        vec2 toFrag = vUv - pos;
        float dist = length(toFrag);
        if (dist > splooshRadius || dist < 0.0001) return vec4(0.0);
        vec2 dir = normalize(toFrag);
        float normDist = dist / splooshRadius;
        float wavefront = age * splooshSpeed;
        float k = splooshFrequency;
        float omega = splooshSpeed * splooshFrequency;
        float wave = sin(k * dist - omega * age);
        float behindFront = smoothstep(wavefront + 0.008, wavefront - 0.005, dist);
        float spreadDecay = 1.0 / (1.0 + dist * 6.0);
        float radiusFade = 1.0 - normDist * normDist;
        float smoothAlpha = alpha * alpha * (3.0 - 2.0 * alpha);
        float waveDist = dist - wavefront;
        float envWidth = 0.012 + wavefront * 0.1;
        float gaussian = exp(-(waveDist * waveDist) / (2.0 * envWidth * envWidth));
        float burstDecay = exp(-age * 5.0);
        float burstWidth = 0.01 + age * 0.025;
        float burst = exp(-(dist * dist) / (burstWidth * burstWidth)) * burstDecay;
        vec2 waveSignal = dir * wave * spreadDecay * behindFront;
        vec2 burstSignal = dir * burst * 2.5;
        vec2 rawDisp = (waveSignal + burstSignal) * smoothAlpha * radiusFade;
        float srcEnv = gaussian * radiusFade * smoothAlpha;
        return vec4(rawDisp, srcEnv, 0.0);
    }

    void main() {
        float maskStrength = texture2D(uMaskMap, vUv).r;
        if (maskStrength < 0.00392) {
            gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
            return;
        }

        vec2 px = 1.0 / uResolution;
        vec2 uvL = clamp(vUv - vec2(px.x, 0.0), 0.0, 1.0);
        vec2 uvR = clamp(vUv + vec2(px.x, 0.0), 0.0, 1.0);
        vec2 uvU = clamp(vUv + vec2(0.0, px.y), 0.0, 1.0);
        vec2 uvD = clamp(vUv - vec2(0.0, px.y), 0.0, 1.0);
        vec2 center = texture2D(uPrevState, vUv).xy;
        float maskL = texture2D(uMaskMap, uvL).r;
        float maskR = texture2D(uMaskMap, uvR).r;
        float maskU = texture2D(uMaskMap, uvU).r;
        float maskD = texture2D(uMaskMap, uvD).r;
        vec2 left = maskL > 0.004 ? texture2D(uPrevState, uvL).xy : center;
        vec2 right = maskR > 0.004 ? texture2D(uPrevState, uvR).xy : center;
        vec2 up = maskU > 0.004 ? texture2D(uPrevState, uvU).xy : center;
        vec2 down = maskD > 0.004 ? texture2D(uPrevState, uvD).xy : center;
        vec2 blurred = (center * 2.0 + left + right + up + down) / 6.0;
        float blurredMag = length(blurred);
        float dampFactor = blurredMag > 0.02 ? uDampingFactor * 0.88 : uDampingFactor;
        vec2 damped = blurred * dampFactor;

        vec2 impulse = vec2(0.0);
        if (mouseInstanceCount > 0) {
${wakeContrib.join('\n')}
            impulse *= uWakeImpulseStrength;
        }
        if (splooshInstanceCount > 0) {
${splooshSourceVars.join('\n')}
${splooshSourceAssign.join('\n')}
            vec2 rawSum = ${splooshRawSum.join(' + ')};
            float combinedEnv = ${splooshCombinedEnvExpr};
            if (combinedEnv > 0.001) {
                float rawMag = length(rawSum);
                float satK = 3.0;
                vec2 saturatedDisp = rawMag > 0.0001 ? rawSum * (tanh(rawMag * satK) / (rawMag * satK)) : vec2(0.0);
                impulse += saturatedDisp * combinedEnv * splooshStrength * 0.15 * uSplooshImpulseStrength;
            }
        }

        vec2 result = damped + impulse;
        result *= maskStrength;
        float mag = length(result);
        if (mag > uMaxDisturbance) result *= uMaxDisturbance / mag;
        gl_FragColor = vec4(result, 0.0, 0.0);
    }
`;
}

class WaterRippleEffect extends BaseEffect {
    constructor(scene, camera, renderer, parallaxInstance) {
        super(scene, camera, renderer, parallaxInstance);
        this.effectType = 'area';
        
        // Wake instanced system (maxInstances set from config in init)
        this.rippleInstances = [];
        this.maxInstances = DEFAULT_MAX_WAKE_INSTANCES;
        this.currentInstanceIndex = -1;
        this.fadeInSpeed = 0.002;
        this.wasOverWater = false;
        this.lastMouseUV = new THREE.Vector2(-1, -1);
        
        // Velocity smoothing for wake activation and angle stabilization
        this.velocityBuffer = [];       // magnitude buffer for activation gating
        this.velocityVecBuffer = [];    // vector buffer for direction smoothing
        this.velocityBufferSize = 5;
        this.velocityThreshold = 0.1;
        this.wakeActive = false;
        
        // Position easing — wake trails behind the mouse for a more natural feel
        // Variable: fast movement → lower easing (more lag), slow → higher (tighter tracking)
        this.positionEasingMin = 0.06;
        this.positionEasingMax = 0.3;
        this.easedPosition = new THREE.Vector2(-1, -1);
        
        // Trail breadcrumbs — frozen wake snapshots dropped along the path
        this.trailSpacing = 0.03;
        this.lastBreadcrumbPos = new THREE.Vector2(-1, -1);
        
        // Sploosh (click/tap splash) system (maxSplooshInstances set from config in init)
        this.splooshInstances = [];
        this.maxSplooshInstances = DEFAULT_MAX_SPLOOSH_INSTANCES;
        this.splooshDuration = 3.0;
        
        // Particle emitter (instantiated in init after scene is ready)
        this.particleEmitter = null;
        this.lastSprayTime = 0;
        
        // Raycaster for accurate mouse-to-UV conversion
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        
        // Track actual mouse/touch pixel coordinates
        this.mousePixelX = 0;
        this.mousePixelY = 0;
        this.isTouching = false;

        // Pre-allocated temp objects to avoid per-frame GC pressure
        this._tmpCurrentVelocity = new THREE.Vector2();
        this._tmpSmoothedVelocity = new THREE.Vector2();
        this._tmpVelDir3 = new THREE.Vector3();
        this._cachedConfig = null;
        this._cachedConfigFrame = -1;
        this._cachedRect = null;
        this._cachedRectFrame = -1;
        this._frameCounter = 0;

        // Uniform name arrays (built in init from config max counts)
        this._wakePosList = [];
        this._wakeVelList = [];
        this._wakeAlphaList = [];
        this._splooshPosList = [];
        this._splooshAlphaList = [];
        this._splooshAgeList = [];

        // Simulation (feedback-based disturbance texture)
        this.simulationEnabled = false;
        this.simRTRead = null;
        this.simRTWrite = null;
        this.simScene = null;
        this.simMesh = null;
        this.simMaterial = null;
        this.simUniforms = null;
        this._simResizeHandler = null;

        this.setupMouseTracking();
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
            // Reuse textures if already loaded
            if (this.maskTexture && this.rippleTexture) {
                maskTexture = this.maskTexture;
                rippleTexture = this.rippleTexture;
            } else {
                try {
                    [maskTexture, rippleTexture] = await Promise.all([
                        loadWithFallback(maskPath, ['assets/bg2WaterBW.png', 'assets/bg2WaterBW.webp'].map(f => basePath + f).filter(p => p !== maskPath)),
                        loadWithFallback(ripplePath, ['assets/waterripplenormal.jpg', 'assets/waterripplenormal.webp'].map(f => basePath + f).filter(p => p !== ripplePath))
                    ]);
                } catch (textureError) {
                    console.error('WaterRippleEffect: Failed to load textures. Check maskPath and ripplePath in config. Tried:', maskPath, ripplePath, textureError);
                    throw textureError;
                }
            }

            maskTexture.wrapS = maskTexture.wrapT = THREE.ClampToEdgeWrapping;
            maskTexture.minFilter = maskTexture.magFilter = THREE.LinearFilter;
            maskTexture.generateMipmaps = false;
            rippleTexture.wrapS = rippleTexture.wrapT = THREE.RepeatWrapping;

            // #region agent log
            const maskImg = maskTexture?.image;
            const bgImg = this.parallax?.imageTexture?.image;
            const maskW = maskImg?.width || maskImg?.naturalWidth || 0;
            const maskH = maskImg?.height || maskImg?.naturalHeight || 0;
            const bgW = bgImg?.width || bgImg?.naturalWidth || 0;
            const bgH = bgImg?.height || bgImg?.naturalHeight || 0;
            const maskFlipY = maskTexture?.flipY;
            const bgFlipY = this.parallax?.imageTexture?.flipY;
            // #endregion

            // Store textures for reuse if already loaded
            if (!this.maskTexture) this.maskTexture = maskTexture;
            if (!this.rippleTexture) this.rippleTexture = rippleTexture;
            
            this.textures.push(maskTexture, rippleTexture);
            
            // Defer mask sampler so it doesn't block first paint (was causing long black screen)
            // Rebuild if not already built or if texture changed
            if (!this.maskSampler || this.maskSampler.maskTexture !== maskTexture) {
                this.maskSampler = null;
                const scheduleMaskSampler = () => {
                    if (typeof requestIdleCallback !== 'undefined') {
                        requestIdleCallback(() => {
                            this.maskSampler = this.buildMaskSampler(maskTexture);
                            // #region agent log
                            const s = this.maskSampler;
                            const hasData = !!(s?.data);
                            let lowRCount = 0, lowACount = 0, highAButLowR = 0, total = 0;
                            if (hasData && s.data) {
                                const d = s.data, w = s.width, h = s.height;
                                for (let y = 0; y < h; y++) {
                                    for (let x = 0; x < w; x++) {
                                        const i = (y * w + x) * 4;
                                        const r = d[i] / 255, a = d[i+3] / 255;
                                        total++;
                                        if (r < 0.01) lowRCount++;
                                        if (a < 0.01) lowACount++;
                                        if (a > 0.5 && r < 0.01) highAButLowR++;
                                    }
                                }
                            }
                            // #endregion
                        }, { timeout: 500 });
                    } else {
                        setTimeout(() => { this.maskSampler = this.buildMaskSampler(maskTexture); }, 0);
                    }
                };
                scheduleMaskSampler();
            }

            const rippleScale = config.rippleScale ?? 3.0;
            const rippleSpeed = config.rippleSpeed ?? 0.05;
            const refractionStrength = config.refractionStrength ?? 0.02;

            // Instance limits (configurable; higher = more simultaneous wake/sploosh without eviction)
            this.maxInstances = config.maxWakeInstances ?? config.mouseInteraction?.maxWakeInstances ?? DEFAULT_MAX_WAKE_INSTANCES;
            this.maxSplooshInstances = config.maxSplooshInstances ?? config.splooshInteraction?.maxSplooshInstances ?? DEFAULT_MAX_SPLOOSH_INSTANCES;
            this._wakePosList = Array.from({ length: this.maxInstances }, (_, i) => `mouseInstancePos${i}`);
            this._wakeVelList = Array.from({ length: this.maxInstances }, (_, i) => `mouseInstanceVel${i}`);
            this._wakeAlphaList = Array.from({ length: this.maxInstances }, (_, i) => `mouseInstanceAlpha${i}`);
            this._splooshPosList = Array.from({ length: this.maxSplooshInstances }, (_, i) => `splooshPos${i}`);
            this._splooshAlphaList = Array.from({ length: this.maxSplooshInstances }, (_, i) => `splooshAlpha${i}`);
            this._splooshAgeList = Array.from({ length: this.maxSplooshInstances }, (_, i) => `splooshAge${i}`);
            
            // Wake interaction config
            const mouseConfig = config.mouseInteraction || {};
            this.fadeInSpeed = mouseConfig.fadeInSpeed ?? mouseConfig.fadeSpeed ?? 0.002;
            this.maxLifetime = mouseConfig.maxLifetime ?? 12;
            this.velocityThreshold = mouseConfig.velocityThreshold ?? 0.1;
            this.velocityBufferSize = mouseConfig.velocitySmoothing ?? 5;
            this.positionEasingMin = mouseConfig.positionEasingMin ?? 0.06;
            this.positionEasingMax = mouseConfig.positionEasingMax ?? 0.3;
            this.trailSpacing = mouseConfig.trailSpacing ?? 0.03;
            
            // Sploosh interaction config
            const splooshConfig = config.splooshInteraction || {};
            this.splooshDuration = splooshConfig.duration ?? 3.0;

            // Simulation config (feedback-based disturbance texture)
            const simConfig = config.simulation || {};
            this.simulationEnabled = simConfig.enabled === true;
            const simResolution = Math.max(64, Math.min(1024, simConfig.resolution ?? 512));
            const simDiffusion = simConfig.diffusionStrength ?? 0.5;
            const simDamping = simConfig.dampingFactor ?? 0.86;
            const simWakeContributionDuration = simConfig.wakeContributionDuration ?? 1.0;
            const simMaxDisturbance = simConfig.maxDisturbance ?? 0.08;
            const simWakeImpulse = simConfig.wakeImpulseStrength ?? 0.4;
            const simSplooshImpulse = simConfig.splooshImpulseStrength ?? 1.0;

            const effectUniforms = this.simulationEnabled ? {
                map: { value: this.parallax.imageTexture },
                maskMap: { value: maskTexture },
                rippleNormal: { value: rippleTexture },
                uDisturbanceTexture: { value: null },
                time: { value: 0 },
                rippleScale: { value: rippleScale },
                rippleSpeed: { value: rippleSpeed },
                refractionStrength: { value: refractionStrength },
                wakeTint: { value: mouseConfig.wakeTint ?? 3.0 },
                splooshTint: { value: splooshConfig.tint ?? 1.0 }
            } : {
                map: { value: this.parallax.imageTexture },
                maskMap: { value: maskTexture },
                rippleNormal: { value: rippleTexture },
                time: { value: 0 },
                rippleScale: { value: rippleScale },
                rippleSpeed: { value: rippleSpeed },
                refractionStrength: { value: refractionStrength }
            };

            const fragmentShader = this.simulationEnabled
                ? buildFragmentShaderWithDisturbance()
                : buildFragmentShaderAmbientOnly();
            this.overlayMesh = this.createCoarseAreaEffectMesh(
                fragmentShader,
                effectUniforms,
                { overlaySegments: config.overlaySegments ?? 64, depthWrite: false }
            );
            this.overlayMesh.position.z = 0.01;

            // Stencil prepass: cheap mask-only shader runs first; main water shader only runs where stencil is set
            // Share geometry with main overlay (no clone) — both meshes reference the same BufferGeometry
            const prepassGeometry = this.overlayMesh.geometry;
            const prepassUniforms = { maskMap: { value: maskTexture } };
            const prepassMaterial = new THREE.ShaderMaterial({
                vertexShader: this.parallax.getDisplacementVertexShader(),
                fragmentShader: STENCIL_PREPASS_FRAGMENT,
                uniforms: { ...this.parallax.getDisplacementUniforms(), ...prepassUniforms },
                transparent: true,
                depthWrite: false,
                colorWrite: false,
                side: THREE.DoubleSide,
                stencilWrite: true,
                stencilFunc: THREE.AlwaysStencilFunc,
                stencilFail: THREE.KeepStencilOp,
                stencilZFail: THREE.KeepStencilOp,
                stencilZPass: THREE.ReplaceStencilOp,
                stencilRef: 1
            });
            this.stencilPrepassMesh = new THREE.Mesh(prepassGeometry, prepassMaterial);
            this.stencilPrepassMesh.position.z = 0.009;
            this.stencilPrepassMesh.renderOrder = -1;
            this.meshes.push(this.stencilPrepassMesh);
            this.materials.push(prepassMaterial);
            this.scene.add(this.stencilPrepassMesh);

            const overlayMaterial = this.overlayMesh.material;
            overlayMaterial.stencilWrite = false;
            overlayMaterial.stencilFunc = THREE.EqualStencilFunc;
            overlayMaterial.stencilRef = 1;
            overlayMaterial.stencilFail = THREE.KeepStencilOp;
            overlayMaterial.stencilZFail = THREE.KeepStencilOp;
            overlayMaterial.stencilZPass = THREE.KeepStencilOp;

            // #region agent log
            const uvAttr = this.overlayMesh?.geometry?.attributes?.uv;
            if (uvAttr && uvAttr.array) {
                const arr = uvAttr.array;
                let minU = 1, maxU = 0, minV = 1, maxV = 0;
                for (let i = 0; i < arr.length; i += 2) {
                    minU = Math.min(minU, arr[i]); maxU = Math.max(maxU, arr[i]);
                    minV = Math.min(minV, arr[i+1]); maxV = Math.max(maxV, arr[i+1]);
                }
            }
            // #endregion

            this.uniforms = effectUniforms;

            if (this.simulationEnabled) {
                this.wakeContributionDuration = simWakeContributionDuration;
                this._initSimulation(maskTexture, mouseConfig, splooshConfig, simResolution, simDiffusion, simDamping, simWakeContributionDuration, simMaxDisturbance, simWakeImpulse, simSplooshImpulse);
            }
            this.time = 0;
            
            // Particle emitter for sploosh spout + speed spray
            const particleConfig = config.particleEffects || {};
            if (particleConfig.enabled !== false && !this.particleEmitter) {
                this.particleEmitter = new WaterParticleEmitter(this.scene, this.camera, this.renderer);
            }
            
            // Prepare background color sampler for particle tinting
            this._initColorSampler();
            
            // Setup mouse/touch tracking for wake interaction (restore after cleanup)
            this.setupMouseTracking();
            
            this.isInitialized = true;

            log(`WaterRippleEffect: Water ripple initialized (overlaySegments: ${config.overlaySegments ?? 64}, simulation: ${this.simulationEnabled})`);
        } catch (error) {
            console.error('WaterRippleEffect: Error during initialization:', error);
            throw error;
        }
    }

    getConfig() {
        if (this._cachedConfigFrame === this._frameCounter) return this._cachedConfig;
        this._cachedConfig = this.parallax?.config?.effects?.waterRipple || {};
        this._cachedConfigFrame = this._frameCounter;
        return this._cachedConfig;
    }

    _initSimulation(maskTexture, mouseConfig, splooshConfig, resolution, diffusionStrength, dampingFactor, wakeContributionDuration, maxDisturbance, wakeImpulseStrength, splooshImpulseStrength) {
        const w = resolution;
        const h = resolution;
        const rtOptions = {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
            type: THREE.FloatType,
            stencilBuffer: false,
            depthBuffer: false
        };
        this.simRTRead = new THREE.WebGLRenderTarget(w, h, rtOptions);
        this.simRTWrite = new THREE.WebGLRenderTarget(w, h, rtOptions);
        this.simUniforms = {
            uPrevState: { value: this.simRTRead.texture },
            uMaskMap: { value: maskTexture },
            uResolution: { value: new THREE.Vector2(w, h) },
            uTime: { value: 0 },
            uDiffusionStrength: { value: diffusionStrength },
            uDampingFactor: { value: dampingFactor },
            uMaxDisturbance: { value: maxDisturbance },
            uWakeImpulseStrength: { value: wakeImpulseStrength },
            uSplooshImpulseStrength: { value: splooshImpulseStrength },
            wakeStrength: { value: mouseConfig.wakeStrength ?? mouseConfig.strength ?? 1.0 },
            wakeRadius: { value: mouseConfig.wakeRadius ?? mouseConfig.radius ?? 0.15 },
            wakeAngle: { value: mouseConfig.wakeAngle ?? 0.35 },
            wakeLength: { value: mouseConfig.wakeLength ?? 0.25 },
            wakeFrequency: { value: mouseConfig.wakeFrequency ?? 25.0 },
            wakeRippleSpeed: { value: mouseConfig.wakeRippleSpeed ?? 2.0 },
            mouseInstanceCount: { value: 0 },
            ...Object.fromEntries(
                this._wakePosList.flatMap((name, i) => [
                    [name, { value: new THREE.Vector2(-1, -1) }],
                    [this._wakeVelList[i], { value: new THREE.Vector2(0, 0) }],
                    [this._wakeAlphaList[i], { value: 0 }]
                ])
            ),
            splooshStrength: { value: splooshConfig.strength ?? 1.5 },
            splooshRadius: { value: splooshConfig.radius ?? 0.2 },
            splooshFrequency: { value: splooshConfig.frequency ?? 20.0 },
            splooshSpeed: { value: splooshConfig.speed ?? 0.08 },
            splooshInstanceCount: { value: 0 },
            ...Object.fromEntries(
                this._splooshPosList.flatMap((name, i) => [
                    [name, { value: new THREE.Vector2(-1, -1) }],
                    [this._splooshAlphaList[i], { value: 0 }],
                    [this._splooshAgeList[i], { value: 0 }]
                ])
            )
        };
        const simVertexShader = `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `;
        this.simMaterial = new THREE.ShaderMaterial({
            vertexShader: simVertexShader,
            fragmentShader: buildSimulationFragmentShader(this.maxInstances, this.maxSplooshInstances),
            uniforms: this.simUniforms,
            depthTest: false,
            depthWrite: false
        });
        const simGeometry = new THREE.PlaneGeometry(2, 2);
        this.simMesh = new THREE.Mesh(simGeometry, this.simMaterial);
        this.simScene = new THREE.Scene();
        this.simScene.add(this.simMesh);
        this.simCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.materials.push(this.simMaterial);
        this.uniforms.uDisturbanceTexture.value = this.simRTRead.texture;
        const resizeHandler = () => this._resizeSimulationRTs();
        window.addEventListener('resize', resizeHandler);
        this._simResizeHandler = resizeHandler;
        log(`WaterRippleEffect: Simulation initialized (${w}x${h})`);
    }

    _resizeSimulationRTs(newResolution) {
        if (!this.simRTRead || !this.simRTWrite) return;
        const config = this.getConfig();
        const simConfig = config.simulation || {};
        const res = newResolution != null
            ? Math.max(64, Math.min(1024, newResolution))
            : Math.max(64, Math.min(1024, simConfig.resolution ?? 512));
        this.simRTRead.setSize(res, res);
        this.simRTWrite.setSize(res, res);
        if (this.simUniforms?.uResolution?.value) {
            this.simUniforms.uResolution.value.set(res, res);
        }
    }

    renderPrePass(renderer, camera) {
        if (!this.simulationEnabled || !this.simScene || !this.simRTRead || !this.simRTWrite) return;
        const prevRT = renderer.getRenderTarget();
        renderer.setRenderTarget(this.simRTWrite);
        renderer.clear();
        this.simUniforms.uPrevState.value = this.simRTRead.texture;
        this.simUniforms.uTime.value = this.time;
        renderer.render(this.simScene, this.simCamera);
        const tmp = this.simRTRead;
        this.simRTRead = this.simRTWrite;
        this.simRTWrite = tmp;
        this.uniforms.uDisturbanceTexture.value = this.simRTRead.texture;
        renderer.setRenderTarget(prevRT);
    }

    _getCanvasRect() {
        if (this._cachedRectFrame === this._frameCounter) return this._cachedRect;
        if (this.parallax?.canvas) {
            this._cachedRect = this.parallax.canvas.getBoundingClientRect();
        }
        this._cachedRectFrame = this._frameCounter;
        return this._cachedRect;
    }

    _invalidateRectCache() {
        this._cachedRectFrame = -1;
    }

    update(deltaTime) {
        if (!this.isInitialized || !this.overlayMesh) return;

        this._frameCounter++;
        const frameDelta = Number.isFinite(deltaTime) && deltaTime > 0 ? deltaTime : 0.016;
        this.time += frameDelta;
        if (this.uniforms?.time) this.uniforms.time.value = this.time;

        // Update mouse interaction
        this.updateMouseInteraction(frameDelta);
        this.updateSplooshInteraction(frameDelta);
        
        // Update particle emitter
        if (this.particleEmitter) {
            const particleConfig = this.getConfig().particleEffects || {};
            const gravity = particleConfig.sploosh?.gravity ?? particleConfig.spray?.gravity ?? 4.0;
            this.particleEmitter.update(frameDelta, gravity);
        }

        this.syncWithParallaxMesh(this.overlayMesh);
        this.overlayMesh.position.z = 0.01;
        if (this.stencilPrepassMesh) {
            this.syncWithParallaxMesh(this.stencilPrepassMesh);
            this.stencilPrepassMesh.position.z = 0.009;
        }
    }
    
    updateMouseInteraction(deltaTime) {
        if (!this.uniforms || !this.parallax || !this.overlayMesh) return;
        if (!this.simulationEnabled) return; // Wake only used when simulation is on

        const wakeInteraction = this.parallax.getFlag('effects.water-ripple.wakeInteraction');
        const mouseConfig = this.getConfig().mouseInteraction || {};
        const shouldBeEnabled = wakeInteraction && mouseConfig.enabled !== false;
        
        if (!shouldBeEnabled) {
            this.rippleInstances = [];
            this.updateInstanceUniforms();
            this.wakeActive = false;
            this.wasOverWater = false;
            return;
        }
        
        const inputActive = this.parallax.mouseOnScreen || this.isTouching;
        
        let isOverWater = false;
        let currentMouseUV = null;
        const currentMouseVelocity = this._tmpCurrentVelocity;
        currentMouseVelocity.set(0, 0);
        
        if (inputActive) {
            const mouseUV = this.getMouseUVFromRaycast();
            if (mouseUV && mouseUV.x >= 0 && mouseUV.x <= 1 && mouseUV.y >= 0 && mouseUV.y <= 1) {
                if (this.isUVOverWater(mouseUV.x, mouseUV.y)) {
                    isOverWater = true;
                    currentMouseUV = mouseUV;
                }
                if (this.lastMouseUV.x >= 0 && this.lastMouseUV.y >= 0) {
                    const dx = mouseUV.x - this.lastMouseUV.x;
                    const dy = mouseUV.y - this.lastMouseUV.y;
                    const velocityScale = 1.0 / Math.max(deltaTime, 0.001);
                    currentMouseVelocity.set(dx * velocityScale, dy * velocityScale);
                    currentMouseVelocity.clampLength(0, 10.0);
                }
                this.lastMouseUV.copy(mouseUV);
            }
        }
        
        if (isOverWater && currentMouseUV) {
            this.velocityBuffer.push(currentMouseVelocity.length());
            // Reuse Vector2 objects in the ring buffer instead of cloning
            if (this.velocityVecBuffer.length < this.velocityBufferSize) {
                this.velocityVecBuffer.push(new THREE.Vector2(currentMouseVelocity.x, currentMouseVelocity.y));
            } else {
                // Shift oldest out and reuse the object
                const recycled = this.velocityVecBuffer.shift();
                recycled.set(currentMouseVelocity.x, currentMouseVelocity.y);
                this.velocityVecBuffer.push(recycled);
            }
            while (this.velocityBuffer.length > this.velocityBufferSize) this.velocityBuffer.shift();
            let smoothedVelSum = 0;
            for (let vi = 0; vi < this.velocityBuffer.length; vi++) smoothedVelSum += this.velocityBuffer[vi];
            const smoothedVel = smoothedVelSum / this.velocityBuffer.length;
            
            const smoothedVelocity = this._tmpSmoothedVelocity;
            smoothedVelocity.set(0, 0);
            for (let vi = 0; vi < this.velocityVecBuffer.length; vi++) smoothedVelocity.add(this.velocityVecBuffer[vi]);
            smoothedVelocity.divideScalar(this.velocityVecBuffer.length);
            
            if (!this.wakeActive) {
                if (smoothedVel >= this.velocityThreshold) {
                    this.wakeActive = true;
                    this.easedPosition.copy(currentMouseUV);
                    this.lastBreadcrumbPos.copy(currentMouseUV);
                    this.createRippleInstance(currentMouseUV, smoothedVelocity);
                }
            } else {
                if (this.currentInstanceIndex >= 0 && this.currentInstanceIndex < this.rippleInstances.length) {
                    // Variable easing: fast movement → more lag, slow → tighter tracking
                    const maxSpeed = 3.0;
                    const speedRatio = Math.min(smoothedVel / maxSpeed, 1.0);
                    const easing = this.positionEasingMax + (this.positionEasingMin - this.positionEasingMax) * speedRatio;
                    this.easedPosition.lerp(currentMouseUV, easing);
                    const inst = this.rippleInstances[this.currentInstanceIndex];
                    inst.position.copy(this.easedPosition);
                    inst.velocity.copy(smoothedVelocity);
                    
                    // Drop trail breadcrumbs along the path
                    const distFromLastBreadcrumb = this.easedPosition.distanceTo(this.lastBreadcrumbPos);
                    if (distFromLastBreadcrumb >= this.trailSpacing) {
                        this.spawnBreadcrumb(this.easedPosition, smoothedVelocity);
                        this.lastBreadcrumbPos.copy(this.easedPosition);
                    }
                }
                if (smoothedVel < 0.01) {
                    this.deactivateCurrentWake();
                }
            }
            
            // Speed spray particles when moving fast enough through water
            if (this.particleEmitter && this.wakeActive) {
                const sprayConfig = this.getConfig().particleEffects?.spray || {};
                if (sprayConfig.enabled !== false) {
                    const sprayThreshold = sprayConfig.velocityThreshold ?? 1.5;
                    if (smoothedVel >= sprayThreshold) {
                        const worldPos = this.getWorldPosAtPixel(this.mousePixelX, this.mousePixelY);
                        if (worldPos) {
                            worldPos.z += 0.02;
                            this._tmpVelDir3.set(smoothedVelocity.x, smoothedVelocity.y, 0);
                            const sprayUV = currentMouseUV || this.easedPosition;
                            const waterColor = this._sampleBackgroundColor(sprayUV.x, sprayUV.y);
                            this.particleEmitter.emitSpray(worldPos, this._tmpVelDir3, {
                                spawnInterval: sprayConfig.spawnInterval ?? 0.05,
                                countMin: sprayConfig.count?.[0] ?? 2,
                                countMax: sprayConfig.count?.[1] ?? 4,
                                velocityUpMin: sprayConfig.velocityUp?.[0] ?? 0.3,
                                velocityUpMax: sprayConfig.velocityUp?.[1] ?? 0.8,
                                trailMin: sprayConfig.trail?.[0] ?? 0.5,
                                trailMax: sprayConfig.trail?.[1] ?? 1.5,
                                velocitySpread: sprayConfig.velocitySpread ?? 0.2,
                                lifetimeMin: sprayConfig.lifetime?.[0] ?? 0.2,
                                lifetimeMax: sprayConfig.lifetime?.[1] ?? 0.5,
                                scaleMin: sprayConfig.scale?.[0] ?? 0.01,
                                scaleMax: sprayConfig.scale?.[1] ?? 0.035,
                                opacity: sprayConfig.opacity ?? 0.8,
                                waterColor: waterColor
                            });
                        }
                    }
                }
            }
        } else {
            this.deactivateCurrentWake();
            this.velocityBuffer.length = 0;
            this.velocityVecBuffer.length = 0;
        }
        
        this.wasOverWater = isOverWater;
        this.updateRippleInstances(deltaTime);
        this.updateInstanceUniforms();
    }
    
    deactivateCurrentWake() {
        this.currentInstanceIndex = -1;
        this.wakeActive = false;
    }
    
    spawnBreadcrumb(position, velocity) {
        // Drop a frozen wake snapshot along the trail — does NOT change currentInstanceIndex
        const currentRef = this.currentInstanceIndex >= 0 ? this.rippleInstances[this.currentInstanceIndex] : null;
        
        const crumb = {
            position: position.clone(),
            velocity: velocity.clone(),
            alpha: 0.8,
            createdAt: this.time
        };
        
        this.rippleInstances.push(crumb);
        
        // If we're over max, remove the oldest non-active instance
        while (this.rippleInstances.length > this.maxInstances) {
            const removeIdx = this.rippleInstances.findIndex(inst => inst !== currentRef);
            if (removeIdx >= 0) {
                this.rippleInstances.splice(removeIdx, 1);
            } else {
                break;
            }
        }
        
        // Restore currentInstanceIndex since the array may have shifted
        this.currentInstanceIndex = currentRef ? this.rippleInstances.indexOf(currentRef) : -1;
    }
    
    createRippleInstance(position, velocity) {
        // Compact dead instances in-place
        let wi = 0;
        for (let ri = 0; ri < this.rippleInstances.length; ri++) {
            if (this.rippleInstances[ri].alpha > 0.001) {
                this.rippleInstances[wi++] = this.rippleInstances[ri];
            }
        }
        this.rippleInstances.length = wi;
        
        // Create new instance (createdAt used for max lifetime cleanup)
        const instance = {
            position: position.clone(),
            velocity: velocity.clone(),
            alpha: 0.0, // Start at 0, will fade in
            createdAt: this.time
        };
        
        this.rippleInstances.push(instance);
        this.currentInstanceIndex = this.rippleInstances.length - 1;
        
        // Limit to max instances (remove oldest if needed)
        if (this.rippleInstances.length > this.maxInstances) {
            this.rippleInstances.shift(); // Remove oldest
            this.currentInstanceIndex = this.rippleInstances.length - 1; // Update to last
        }
    }
    
    updateRippleInstances(deltaTime) {
        const currentRef = this.currentInstanceIndex >= 0 && this.rippleInstances[this.currentInstanceIndex]
            ? this.rippleInstances[this.currentInstanceIndex]
            : null;

        const maxAge = typeof this.maxLifetime === 'number' && this.maxLifetime > 0 ? this.maxLifetime : 12;

        // Single pass: update fade/velocity and compact dead instances in-place (no .filter() allocation)
        let writeIdx = 0;
        for (let i = 0; i < this.rippleInstances.length; i++) {
            const instance = this.rippleInstances[i];
            const isActive = instance === currentRef;

            // Max lifetime check (skip active)
            if (!isActive) {
                const age = this.time - (instance.createdAt ?? 0);
                if (age >= maxAge) continue;
            }

            // Update fade: simulation uses fade-in only for active wake; texture decay handles the rest
            if (isActive) {
                const fadeTime = 1.0 / Math.max(this.fadeInSpeed, 0.0001);
                const fadeFactor = Math.pow(0.5, deltaTime / fadeTime);
                instance.alpha = 1.0 + (instance.alpha - 1.0) * fadeFactor;
            }

            // Evict by lifetime only (simulation texture handles visual decay)
            if (!isActive && instance.alpha <= 0) continue;

            this.rippleInstances[writeIdx++] = instance;
        }
        this.rippleInstances.length = writeIdx;
        this.currentInstanceIndex = currentRef ? this.rippleInstances.indexOf(currentRef) : -1;
    }
    
    updateInstanceUniforms() {
        if (!this.simulationEnabled || !this.simUniforms) return;

        const count = Math.min(this.rippleInstances.length, this.maxInstances);
        this.simUniforms.mouseInstanceCount.value = count;
        const currentRef = this.currentInstanceIndex >= 0 && this.rippleInstances[this.currentInstanceIndex]
            ? this.rippleInstances[this.currentInstanceIndex]
            : null;

        for (let i = 0; i < this.maxInstances; i++) {
            if (i < count) {
                const instance = this.rippleInstances[i];
                this.simUniforms[this._wakePosList[i]].value.copy(instance.position);
                this.simUniforms[this._wakeVelList[i]].value.copy(instance.velocity);
                let alpha = instance.alpha;
                if (instance !== currentRef) {
                    const age = this.time - (instance.createdAt ?? 0);
                    const dur = this.wakeContributionDuration ?? 1.0;
                    if (age >= dur) alpha = 0;
                    else if (age > dur * 0.5) alpha *= 1.0 - (age - dur * 0.5) / (dur * 0.5);
                }
                this.simUniforms[this._wakeAlphaList[i]].value = alpha;
            } else {
                this.simUniforms[this._wakePosList[i]].value.set(-1, -1);
                this.simUniforms[this._wakeVelList[i]].value.set(0, 0);
                this.simUniforms[this._wakeAlphaList[i]].value = 0.0;
            }
        }
    }
    
    handleSploosh(pixelX, pixelY) {
        if (!this.uniforms || !this.overlayMesh) return;
        
        const splooshFlag = this.parallax.getFlag('effects.water-ripple.splooshInteraction');
        const splooshConfig = this.getConfig().splooshInteraction || {};
        if (!splooshFlag || splooshConfig.enabled === false) return;
        
        const uv = this.getUVAtPixel(pixelX, pixelY);
        if (!uv || uv.x < 0 || uv.x > 1 || uv.y < 0 || uv.y > 1) return;
        if (!this.isUVOverWater(uv.x, uv.y)) return;
        
        log(`WaterRippleEffect: Sploosh at UV (${uv.x.toFixed(3)}, ${uv.y.toFixed(3)})`);
        this.createSplooshInstance(uv);
        
        // Emit sploosh burst particles using raycast world position
        if (this.particleEmitter) {
            const worldPos = this.getWorldPosAtPixel(pixelX, pixelY);
            if (!worldPos) return;
            worldPos.z += 0.02;
            const pConfig = this.getConfig().particleEffects?.sploosh || {};
            const waterColor = this._sampleBackgroundColor(uv.x, uv.y);
            log(`WaterRippleEffect: Sploosh particles at (${worldPos.x.toFixed(3)}, ${worldPos.y.toFixed(3)}), water color: rgb(${(waterColor.r*255)|0}, ${(waterColor.g*255)|0}, ${(waterColor.b*255)|0})`);
            this.particleEmitter.emitSploosh(worldPos, {
                countMin: pConfig.count?.[0] ?? 15,
                countMax: pConfig.count?.[1] ?? 25,
                velocityUpMin: pConfig.velocityUp?.[0] ?? 1.2,
                velocityUpMax: pConfig.velocityUp?.[1] ?? 3.0,
                velocitySpread: pConfig.velocitySpread ?? 0.6,
                velocityForward: pConfig.velocityForward ?? 0.08,
                lifetimeMin: pConfig.lifetime?.[0] ?? 0.4,
                lifetimeMax: pConfig.lifetime?.[1] ?? 0.9,
                scaleMin: pConfig.scale?.[0] ?? 0.02,
                scaleMax: pConfig.scale?.[1] ?? 0.06,
                opacity: pConfig.opacity ?? 0.9,
                waterColor: waterColor
            });
        }
    }
    
    getUVAtPixel(pixelX, pixelY) {
        if (!this.parallax || !this.parallax.canvas || !this.overlayMesh) return null;
        const rect = this._getCanvasRect();
        if (!rect) return null;
        this.mouse.x = ((pixelX / rect.width) * 2) - 1;
        this.mouse.y = -((pixelY / rect.height) * 2) + 1;
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObject(this.overlayMesh);
        if (intersects.length > 0 && intersects[0].uv) {
            return intersects[0].uv.clone();
        }
        return null;
    }
    
    getWorldPosAtPixel(pixelX, pixelY) {
        if (!this.parallax || !this.parallax.canvas || !this.overlayMesh) return null;
        const rect = this._getCanvasRect();
        if (!rect) return null;
        this.mouse.x = ((pixelX / rect.width) * 2) - 1;
        this.mouse.y = -((pixelY / rect.height) * 2) + 1;
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObject(this.overlayMesh);
        if (intersects.length > 0) {
            return intersects[0].point.clone();
        }
        return null;
    }
    
    _initColorSampler() {
        if (this._colorSamplerCanvas) return;
        try {
            const tex = this.parallax?.imageTexture;
            if (!tex || !tex.image) return;
            const img = tex.image;
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth || img.width;
            canvas.height = img.naturalHeight || img.height;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(img, 0, 0);
            this._colorSamplerCanvas = canvas;
            this._colorSamplerCtx = ctx;
            log(`WaterRippleEffect: Color sampler initialized (${canvas.width}x${canvas.height})`);
        } catch (e) {
            log('WaterRippleEffect: Failed to init color sampler:', e);
        }
    }
    
    _sampleBackgroundColor(u, v) {
        if (!this._colorSamplerCtx) return { r: 0.15, g: 0.25, b: 0.35 };
        const canvas = this._colorSamplerCanvas;
        const px = Math.round(u * (canvas.width - 1));
        const py = Math.round((1 - v) * (canvas.height - 1));
        try {
            const data = this._colorSamplerCtx.getImageData(px, py, 1, 1).data;
            return { r: data[0] / 255, g: data[1] / 255, b: data[2] / 255 };
        } catch (e) {
            return { r: 0.15, g: 0.25, b: 0.35 };
        }
    }
    
    createSplooshInstance(uv) {
        let wi = 0;
        for (let ri = 0; ri < this.splooshInstances.length; ri++) {
            if (this.splooshInstances[ri].alpha > 0.001) {
                this.splooshInstances[wi++] = this.splooshInstances[ri];
            }
        }
        this.splooshInstances.length = wi;
        
        const splooshConfig = this.getConfig().splooshInteraction || {};
        const instance = {
            position: uv.clone(),
            birthTime: this.time,
            alpha: 1.0,
            duration: splooshConfig.duration ?? this.splooshDuration
        };
        
        this.splooshInstances.push(instance);
        
        if (this.splooshInstances.length > this.maxSplooshInstances) {
            this.splooshInstances.shift();
        }
    }
    
    updateSplooshInteraction(deltaTime) {
        if (!this.simulationEnabled) return; // Sploosh only used when simulation is on

        const splooshFlag = this.parallax.getFlag('effects.water-ripple.splooshInteraction');
        const splooshConfig = this.getConfig().splooshInteraction || {};
        const shouldBeEnabled = splooshFlag && splooshConfig.enabled !== false;

        if (!shouldBeEnabled) {
            this.splooshInstances = [];
            this.updateSplooshUniforms();
            return;
        }
        
        // Update alpha and compact dead instances in-place (no .filter() allocation)
        let writeIdx = 0;
        for (let i = 0; i < this.splooshInstances.length; i++) {
            const inst = this.splooshInstances[i];
            const age = this.time - inst.birthTime;
            inst.alpha = Math.max(0, 1.0 - age / inst.duration);
            if (inst.alpha > 0) {
                this.splooshInstances[writeIdx++] = inst;
            }
        }
        this.splooshInstances.length = writeIdx;
        this.updateSplooshUniforms();
    }
    
    updateSplooshUniforms() {
        if (!this.simulationEnabled || !this.simUniforms) return;

        const count = Math.min(this.splooshInstances.length, this.maxSplooshInstances);
        this.simUniforms.splooshInstanceCount.value = count;

        for (let i = 0; i < this.maxSplooshInstances; i++) {
            if (i < count) {
                const inst = this.splooshInstances[i];
                this.simUniforms[this._splooshPosList[i]].value.copy(inst.position);
                this.simUniforms[this._splooshAlphaList[i]].value = inst.alpha;
                this.simUniforms[this._splooshAgeList[i]].value = this.time - inst.birthTime;
            } else {
                this.simUniforms[this._splooshPosList[i]].value.set(-1, -1);
                this.simUniforms[this._splooshAlphaList[i]].value = 0.0;
                this.simUniforms[this._splooshAgeList[i]].value = 0.0;
            }
        }
    }
    
    setupMouseTracking() {
        // Track mouse/touch position directly from DOM events for accurate raycasting
        if (!this.parallax || !this.parallax.canvas) return;
        
        // Remove existing listeners if they exist (prevent duplicates on re-init)
        if (this._mouseMoveHandler) {
            this.parallax.canvas.removeEventListener('mousemove', this._mouseMoveHandler);
        }
        if (this._touchMoveHandler) {
            this.parallax.canvas.removeEventListener('touchmove', this._touchMoveHandler);
        }
        if (this._touchEndHandler) {
            this.parallax.canvas.removeEventListener('touchend', this._touchEndHandler);
            this.parallax.canvas.removeEventListener('touchcancel', this._touchEndHandler);
        }
        if (this._clickHandler) {
            this.parallax.canvas.removeEventListener('click', this._clickHandler);
        }
        if (this._touchStartHandler) {
            this.parallax.canvas.removeEventListener('touchstart', this._touchStartHandler);
        }
        if (this._resizeHandler) {
            window.removeEventListener('resize', this._resizeHandler);
            this._resizeHandler = null;
        }
        if (this._scrollHandler) {
            window.removeEventListener('scroll', this._scrollHandler);
            this._scrollHandler = null;
        }
        
        const canvas = this.parallax.canvas;
        
        const handleMouseMove = (event) => {
            const rect = this._getCanvasRect();
            if (!rect) return;
            this.mousePixelX = event.clientX - rect.left;
            this.mousePixelY = event.clientY - rect.top;
            this.isTouching = false;
        };
        
        const handleTouchMove = (event) => {
            event.preventDefault(); // Prevent scrolling
            if (event.touches.length > 0) {
                const rect = this._getCanvasRect();
                if (!rect) return;
                this.mousePixelX = event.touches[0].clientX - rect.left;
                this.mousePixelY = event.touches[0].clientY - rect.top;
                this.isTouching = true;
            }
        };
        
        const handleTouchEnd = () => {
            this.isTouching = false;
        };
        
        const handleClick = (event) => {
            const rect = this._getCanvasRect();
            if (!rect) return;
            const px = event.clientX - rect.left;
            const py = event.clientY - rect.top;
            this.handleSploosh(px, py);
        };
        
        const handleTouchStart = (event) => {
            if (event.touches.length > 0) {
                const rect = this._getCanvasRect();
                if (!rect) return;
                const px = event.touches[0].clientX - rect.left;
                const py = event.touches[0].clientY - rect.top;
                this.handleSploosh(px, py);
            }
        };
        
        canvas.addEventListener('mousemove', handleMouseMove);
        canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
        canvas.addEventListener('touchend', handleTouchEnd);
        canvas.addEventListener('touchcancel', handleTouchEnd);
        canvas.addEventListener('click', handleClick);
        canvas.addEventListener('touchstart', handleTouchStart, { passive: true });
        this._resizeHandler = () => this._invalidateRectCache();
        this._scrollHandler = () => this._invalidateRectCache();
        window.addEventListener('resize', this._resizeHandler);
        window.addEventListener('scroll', this._scrollHandler, { passive: true });
        
        // Store cleanup functions
        this._mouseMoveHandler = handleMouseMove;
        this._touchMoveHandler = handleTouchMove;
        this._touchEndHandler = handleTouchEnd;
        this._clickHandler = handleClick;
        this._touchStartHandler = handleTouchStart;
    }
    
    buildMaskSampler(maskTexture) {
        const img = maskTexture?.image;
        if (!img) return null;
        const w = img.width || img.naturalWidth;
        const h = img.height || img.naturalHeight;
        if (!w || !h) return null;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.drawImage(img, 0, 0);
        let data;
        try {
            data = ctx.getImageData(0, 0, w, h);
        } catch (e) {
            return null;
        }
        return { width: w, height: h, data: data.data };
    }
    
    isUVOverWater(u, v) {
        if (!this.maskSampler || !this.maskSampler.data) return false;
        const { width, height, data } = this.maskSampler;
        const x = Math.floor(Math.max(0, Math.min(1, u)) * (width - 1));
        const y = Math.floor((1 - Math.max(0, Math.min(1, v))) * (height - 1));
        const i = (y * width + x) * 4;
        const r = data[i] / 255;
        return r > 0.01;
    }
    
    getMouseUVFromRaycast() {
        if (!this.parallax || !this.parallax.canvas || !this.overlayMesh) return null;
        
        const rect = this._getCanvasRect();
        if (!rect) return null;
        
        this.mouse.x = ((this.mousePixelX / rect.width) * 2) - 1;
        this.mouse.y = -((this.mousePixelY / rect.height) * 2) + 1;
        
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObject(this.overlayMesh);
        
        if (intersects.length > 0 && intersects[0].uv) {
            return intersects[0].uv.clone();
        }
        
        return null;
    }

    updatePositionsForMeshTransform(meshTransform) {
        if (this.overlayMesh) this.syncWithParallaxMesh(this.overlayMesh);
        if (this.stencilPrepassMesh) this.syncWithParallaxMesh(this.stencilPrepassMesh);
    }

    cleanup() {
        // Clear wake instances
        this.rippleInstances = [];
        this.wakeActive = false;
        this.wasOverWater = false;
        this.lastMouseUV = new THREE.Vector2(-1, -1);
        this.easedPosition = new THREE.Vector2(-1, -1);
        this.lastBreadcrumbPos = new THREE.Vector2(-1, -1);
        this.velocityBuffer = [];
        this.velocityVecBuffer = [];
        this.isTouching = false;
        
        // Clear sploosh instances
        this.splooshInstances = [];
        
        // Clean up particle emitter
        if (this.particleEmitter) {
            this.particleEmitter.cleanup();
            this.particleEmitter = null;
        }

        // Clean up simulation
        if (this._simResizeHandler) {
            window.removeEventListener('resize', this._simResizeHandler);
            this._simResizeHandler = null;
        }
        if (this.simRTRead) {
            this.simRTRead.dispose();
            this.simRTRead = null;
        }
        if (this.simRTWrite) {
            this.simRTWrite.dispose();
            this.simRTWrite = null;
        }
        if (this.simMesh?.geometry) {
            this.simMesh.geometry.dispose();
        }
        this.simScene = null;
        this.simMesh = null;
        this.simMaterial = null;
        this.simUniforms = null;
        this.simulationEnabled = false;

        // Remove mouse/touch tracking event listeners
        if (this.parallax && this.parallax.canvas) {
            if (this._mouseMoveHandler) {
                this.parallax.canvas.removeEventListener('mousemove', this._mouseMoveHandler);
                this._mouseMoveHandler = null;
            }
            if (this._touchMoveHandler) {
                this.parallax.canvas.removeEventListener('touchmove', this._touchMoveHandler);
                this._touchMoveHandler = null;
            }
            if (this._touchEndHandler) {
                this.parallax.canvas.removeEventListener('touchend', this._touchEndHandler);
                this.parallax.canvas.removeEventListener('touchcancel', this._touchEndHandler);
                this._touchEndHandler = null;
            }
            if (this._clickHandler) {
                this.parallax.canvas.removeEventListener('click', this._clickHandler);
                this._clickHandler = null;
            }
            if (this._touchStartHandler) {
                this.parallax.canvas.removeEventListener('touchstart', this._touchStartHandler);
                this._touchStartHandler = null;
            }
        }
        if (this._resizeHandler) {
            window.removeEventListener('resize', this._resizeHandler);
            this._resizeHandler = null;
        }
        if (this._scrollHandler) {
            window.removeEventListener('scroll', this._scrollHandler);
            this._scrollHandler = null;
        }
        
        // Prepass shares geometry with overlay; avoid double-dispose
        if (this.stencilPrepassMesh) {
            this.stencilPrepassMesh.geometry = null;
        }
        this.overlayMesh = null;
        this.stencilPrepassMesh = null;
        this.uniforms = null;
        this.time = 0;
        
        // Remove textures from parent's textures array so they don't get disposed
        // We want to keep them for re-init
        if (this.maskTexture && this.textures.includes(this.maskTexture)) {
            const index = this.textures.indexOf(this.maskTexture);
            this.textures.splice(index, 1);
        }
        if (this.rippleTexture && this.textures.includes(this.rippleTexture)) {
            const index = this.textures.indexOf(this.rippleTexture);
            this.textures.splice(index, 1);
        }
        
        super.cleanup();
        
        // Restore texture references after cleanup
        if (this.maskTexture) {
            this.textures.push(this.maskTexture);
        }
        if (this.rippleTexture) {
            this.textures.push(this.rippleTexture);
        }
    }
}

export default WaterRippleEffect;
