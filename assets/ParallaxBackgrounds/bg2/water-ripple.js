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

const DEFAULT_FRAGMENT_SHADER = `
    uniform sampler2D map;
    uniform sampler2D maskMap;
    uniform sampler2D rippleNormal;
    uniform float time;
    uniform float rippleScale;
    uniform float rippleSpeed;
    uniform float refractionStrength;

    // Wake interaction uniforms (per-slot for WebGL 1 compatibility)
    uniform float mouseEnabled;
    uniform float wakeStrength;
    uniform float wakeRadius;
    uniform float wakeAngle;
    uniform float wakeLength;
    uniform float wakeFrequency;
    uniform float wakeRippleSpeed;
    uniform float wakeTint;
    uniform int mouseInstanceCount;
    uniform vec2 mouseInstancePos0;
    uniform vec2 mouseInstancePos1;
    uniform vec2 mouseInstancePos2;
    uniform vec2 mouseInstancePos3;
    uniform vec2 mouseInstancePos4;
    uniform vec2 mouseInstancePos5;
    uniform vec2 mouseInstancePos6;
    uniform vec2 mouseInstancePos7;
    uniform vec2 mouseInstanceVel0;
    uniform vec2 mouseInstanceVel1;
    uniform vec2 mouseInstanceVel2;
    uniform vec2 mouseInstanceVel3;
    uniform vec2 mouseInstanceVel4;
    uniform vec2 mouseInstanceVel5;
    uniform vec2 mouseInstanceVel6;
    uniform vec2 mouseInstanceVel7;
    uniform float mouseInstanceAlpha0;
    uniform float mouseInstanceAlpha1;
    uniform float mouseInstanceAlpha2;
    uniform float mouseInstanceAlpha3;
    uniform float mouseInstanceAlpha4;
    uniform float mouseInstanceAlpha5;
    uniform float mouseInstanceAlpha6;
    uniform float mouseInstanceAlpha7;

    // Sploosh (click/tap splash) uniforms
    uniform float splooshEnabled;
    uniform float splooshStrength;
    uniform float splooshRadius;
    uniform float splooshFrequency;
    uniform float splooshSpeed;
    uniform float splooshTint;
    uniform int splooshInstanceCount;
    uniform vec2 splooshPos0;
    uniform vec2 splooshPos1;
    uniform vec2 splooshPos2;
    uniform vec2 splooshPos3;
    uniform vec2 splooshPos4;
    uniform vec2 splooshPos5;
    uniform vec2 splooshPos6;
    uniform vec2 splooshPos7;
    uniform float splooshAlpha0;
    uniform float splooshAlpha1;
    uniform float splooshAlpha2;
    uniform float splooshAlpha3;
    uniform float splooshAlpha4;
    uniform float splooshAlpha5;
    uniform float splooshAlpha6;
    uniform float splooshAlpha7;
    uniform float splooshAge0;
    uniform float splooshAge1;
    uniform float splooshAge2;
    uniform float splooshAge3;
    uniform float splooshAge4;
    uniform float splooshAge5;
    uniform float splooshAge6;
    uniform float splooshAge7;

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

        // Smooth side factor: replaces sign(perp) to avoid center-line seam
        float smoothSide = perp / (absPerp + 0.005);

        vec2 displacement = vec2(0.0);

        // V-shaped wake behind the movement
        float behind = max(0.0, -along);
        if (behind > 0.001) {
            float expectedPerp = behind * wakeAngle;
            float armDist = abs(absPerp - expectedPerp);
            float armThickness = 0.015 + behind * 0.05;
            float onArm = exp(-(armDist * armDist) / (armThickness * armThickness));

            float behindNorm = behind / max(wakeLength, 0.001);
            float lengthFade = (1.0 - smoothstep(0.6, 1.0, behindNorm)) * smoothstep(0.0, 0.01, behind);

            // Primary ripple crests along the wake arms
            float phase1 = behind * wakeFrequency - time * wakeRippleSpeed;
            float ripple1 = sin(phase1);

            // Secondary ripple layer for richer texture
            float phase2 = behind * wakeFrequency * 0.6 - time * wakeRippleSpeed * 0.8 + 1.5;
            float ripple2 = sin(phase2) * 0.5;

            float ripple = ripple1 + ripple2 * 0.4;

            float armIntensity = onArm * lengthFade * ripple;
            displacement += perpDir * smoothSide * armIntensity;

            // Spreading ripples: faint circular rings that propagate outward from the wake
            float spreadPhase = dist * wakeFrequency * 0.8 - time * wakeRippleSpeed * 1.2;
            float spreadRipple = sin(spreadPhase) * 0.3;
            float spreadEnvelope = onArm * lengthFade * 0.4;
            displacement += normalize(toFrag) * spreadRipple * spreadEnvelope;
        }

        // Bow wave: compression ahead of the movement
        float ahead = max(0.0, along);
        if (ahead > 0.0 && ahead < wakeRadius * 0.3) {
            float bowFade = 1.0 - ahead / (wakeRadius * 0.3);
            bowFade *= bowFade;
            float perpFade = exp(-(absPerp * absPerp) / 0.004);
            displacement -= moveDir * bowFade * perpFade * 0.5;
        }

        // Center push: water displaced outward near the object
        float centerSpread = 0.003;
        float centerFade = exp(-(dist * dist) / centerSpread);
        if (centerFade > 0.01) {
            displacement += normalize(toFrag) * centerFade * 0.4;
        }

        float speedFactor = min(velMag * 2.0, 1.0);
        // Smooth alpha curve so the effect tapers naturally instead of cutting off abruptly
        float smoothAlpha = alpha * alpha * (3.0 - 2.0 * alpha);
        displacement *= distFalloff * speedFactor * wakeStrength * smoothAlpha * 0.15;

        return displacement;
    }

    // Returns vec4(rawDispX, rawDispY, wavefrontEnvelope, 0)
    // rawDisp: wave oscillation + burst, weighted by spread/behindFront but NOT Gaussian envelope
    // wavefrontEnvelope: Gaussian envelope for max-combination across sources (enables interference)
    vec4 splooshSourceData(vec2 pos, float alpha, float age) {
        if (alpha <= 0.001 || age < 0.0) return vec4(0.0);

        vec2 toFrag = vUv - pos;
        float dist = length(toFrag);
        if (dist > splooshRadius || dist < 0.0001) return vec4(0.0);

        vec2 dir = normalize(toFrag);
        float normDist = dist / splooshRadius;
        float wavefront = age * splooshSpeed;

        // Traveling circular wave
        float k = splooshFrequency;
        float omega = splooshSpeed * splooshFrequency;
        float wave = sin(k * dist - omega * age);

        // Spatial gates
        float behindFront = smoothstep(wavefront + 0.008, wavefront - 0.005, dist);
        float spreadDecay = 1.0 / (1.0 + dist * 6.0);
        float radiusFade = 1.0 - normDist * normDist;
        float smoothAlpha = alpha * alpha * (3.0 - 2.0 * alpha);

        // Wavefront Gaussian (computed separately for max-combination across sources)
        float waveDist = dist - wavefront;
        float envWidth = 0.012 + wavefront * 0.1;
        float gaussian = exp(-(waveDist * waveDist) / (2.0 * envWidth * envWidth));

        // Impact crown burst at center
        float burstDecay = exp(-age * 5.0);
        float burstWidth = 0.01 + age * 0.025;
        float burst = exp(-(dist * dist) / (burstWidth * burstWidth)) * burstDecay;

        // Raw wave signal (oscillation + burst, for interference summation)
        vec2 waveSignal = dir * wave * spreadDecay * behindFront;
        vec2 burstSignal = dir * burst * 2.5;
        vec2 rawDisp = (waveSignal + burstSignal) * smoothAlpha * radiusFade;

        // Per-source wavefront envelope (Gaussian + radius + alpha)
        float srcEnv = gaussian * radiusFade * smoothAlpha;

        return vec4(rawDisp, srcEnv, 0.0);
    }

    void main() {
        float maskStrength = texture2D(maskMap, vUv).r;
        if (maskStrength < 0.00392) discard;

        // AMBIENT RIPPLE
        vec2 rippleUV = vUv * rippleScale + time * rippleSpeed;
        vec3 normal = normalize(texture2D(rippleNormal, rippleUV).xyz * 2.0 - 1.0);

        // WAKE INTERACTION (unrolled for WebGL 1 compatibility)
        vec2 wakeDisplacement = vec2(0.0);
        if (mouseEnabled > 0.5 && mouseInstanceCount > 0) {
            if (mouseInstanceCount > 0) wakeDisplacement += addWakeContribution(mouseInstancePos0, mouseInstanceVel0, mouseInstanceAlpha0);
            if (mouseInstanceCount > 1) wakeDisplacement += addWakeContribution(mouseInstancePos1, mouseInstanceVel1, mouseInstanceAlpha1);
            if (mouseInstanceCount > 2) wakeDisplacement += addWakeContribution(mouseInstancePos2, mouseInstanceVel2, mouseInstanceAlpha2);
            if (mouseInstanceCount > 3) wakeDisplacement += addWakeContribution(mouseInstancePos3, mouseInstanceVel3, mouseInstanceAlpha3);
            if (mouseInstanceCount > 4) wakeDisplacement += addWakeContribution(mouseInstancePos4, mouseInstanceVel4, mouseInstanceAlpha4);
            if (mouseInstanceCount > 5) wakeDisplacement += addWakeContribution(mouseInstancePos5, mouseInstanceVel5, mouseInstanceAlpha5);
            if (mouseInstanceCount > 6) wakeDisplacement += addWakeContribution(mouseInstancePos6, mouseInstanceVel6, mouseInstanceAlpha6);
            if (mouseInstanceCount > 7) wakeDisplacement += addWakeContribution(mouseInstancePos7, mouseInstanceVel7, mouseInstanceAlpha7);
        }

        // SPLOOSH INTERACTION — unified wave interference (unrolled for WebGL 1)
        vec2 splooshDisplacement = vec2(0.0);
        if (splooshEnabled > 0.5 && splooshInstanceCount > 0) {
            vec4 s0 = vec4(0.0), s1 = vec4(0.0), s2 = vec4(0.0), s3 = vec4(0.0);
            vec4 s4 = vec4(0.0), s5 = vec4(0.0), s6 = vec4(0.0), s7 = vec4(0.0);
            if (splooshInstanceCount > 0) s0 = splooshSourceData(splooshPos0, splooshAlpha0, splooshAge0);
            if (splooshInstanceCount > 1) s1 = splooshSourceData(splooshPos1, splooshAlpha1, splooshAge1);
            if (splooshInstanceCount > 2) s2 = splooshSourceData(splooshPos2, splooshAlpha2, splooshAge2);
            if (splooshInstanceCount > 3) s3 = splooshSourceData(splooshPos3, splooshAlpha3, splooshAge3);
            if (splooshInstanceCount > 4) s4 = splooshSourceData(splooshPos4, splooshAlpha4, splooshAge4);
            if (splooshInstanceCount > 5) s5 = splooshSourceData(splooshPos5, splooshAlpha5, splooshAge5);
            if (splooshInstanceCount > 6) s6 = splooshSourceData(splooshPos6, splooshAlpha6, splooshAge6);
            if (splooshInstanceCount > 7) s7 = splooshSourceData(splooshPos7, splooshAlpha7, splooshAge7);

            vec2 rawSum = s0.xy + s1.xy + s2.xy + s3.xy + s4.xy + s5.xy + s6.xy + s7.xy;
            float combinedEnv = max(max(max(s0.z, s1.z), max(s2.z, s3.z)), max(max(s4.z, s5.z), max(s6.z, s7.z)));

            // Skip expensive work if this fragment is outside all sploosh envelopes
            if (combinedEnv > 0.001) {
                float rawMag = length(rawSum);
                float satK = 3.0;
                vec2 saturatedDisp = rawMag > 0.0001
                    ? rawSum * (tanh(rawMag * satK) / (rawMag * satK))
                    : vec2(0.0);

                // Mask edge attenuation (only sampled when sploosh is actually visible here)
                float edgeFade = 1.0;
                if (maskStrength < 0.5) {
                    float edgeDist = 0.003;
                    float nearEdge = min(
                        min(texture2D(maskMap, vUv + vec2(-edgeDist, 0.0)).r, texture2D(maskMap, vUv + vec2(edgeDist, 0.0)).r),
                        min(texture2D(maskMap, vUv + vec2(0.0, edgeDist)).r, texture2D(maskMap, vUv + vec2(0.0, -edgeDist)).r)
                    );
                    edgeFade = smoothstep(0.0, 0.15, nearEdge);
                }

                splooshDisplacement = saturatedDisp * combinedEnv * splooshStrength * edgeFade * 0.15;
            }
        }

        vec2 combinedDisplacement = normal.xy + wakeDisplacement + splooshDisplacement;
        vec2 refractedUV = vUv + combinedDisplacement * refractionStrength * maskStrength;
        vec4 bgColor = texture2D(map, refractedUV);

        // Subtle tint in disturbed areas: darken troughs, lighten crests
        float wakeMag = length(wakeDisplacement);
        float splooshMag = length(splooshDisplacement);
        float tintAmount = wakeMag * wakeTint + splooshMag * splooshTint;
        vec3 tintedColor = bgColor.rgb * (1.0 - tintAmount * 0.6) + vec3(0.7, 0.85, 1.0) * tintAmount * 0.15;

        gl_FragColor = vec4(tintedColor, maskStrength);
    }
`;

class WaterRippleEffect extends BaseEffect {
    constructor(scene, camera, renderer, parallaxInstance) {
        super(scene, camera, renderer, parallaxInstance);
        this.effectType = 'area';
        
        // Wake instanced system
        this.rippleInstances = [];
        this.maxInstances = 8;
        this.currentInstanceIndex = -1;
        this.fadeInSpeed = 0.002;
        this.fadeOutSpeed = 0.002;
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
        
        // Sploosh (click/tap splash) system
        this.splooshInstances = [];
        this.maxSplooshInstances = 8;
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

        // Static uniform name arrays (avoid recreating every frame)
        this._wakePosList = ['mouseInstancePos0','mouseInstancePos1','mouseInstancePos2','mouseInstancePos3','mouseInstancePos4','mouseInstancePos5','mouseInstancePos6','mouseInstancePos7'];
        this._wakeVelList = ['mouseInstanceVel0','mouseInstanceVel1','mouseInstanceVel2','mouseInstanceVel3','mouseInstanceVel4','mouseInstanceVel5','mouseInstanceVel6','mouseInstanceVel7'];
        this._wakeAlphaList = ['mouseInstanceAlpha0','mouseInstanceAlpha1','mouseInstanceAlpha2','mouseInstanceAlpha3','mouseInstanceAlpha4','mouseInstanceAlpha5','mouseInstanceAlpha6','mouseInstanceAlpha7'];
        this._splooshPosList = ['splooshPos0','splooshPos1','splooshPos2','splooshPos3','splooshPos4','splooshPos5','splooshPos6','splooshPos7'];
        this._splooshAlphaList = ['splooshAlpha0','splooshAlpha1','splooshAlpha2','splooshAlpha3','splooshAlpha4','splooshAlpha5','splooshAlpha6','splooshAlpha7'];
        this._splooshAgeList = ['splooshAge0','splooshAge1','splooshAge2','splooshAge3','splooshAge4','splooshAge5','splooshAge6','splooshAge7'];

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
            rippleTexture.wrapS = rippleTexture.wrapT = THREE.RepeatWrapping;

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
                        requestIdleCallback(() => { this.maskSampler = this.buildMaskSampler(maskTexture); }, { timeout: 500 });
                    } else {
                        setTimeout(() => { this.maskSampler = this.buildMaskSampler(maskTexture); }, 0);
                    }
                };
                scheduleMaskSampler();
            }

            const rippleScale = config.rippleScale ?? 3.0;
            const rippleSpeed = config.rippleSpeed ?? 0.05;
            const refractionStrength = config.refractionStrength ?? 0.02;
            
            // Wake interaction config
            const mouseConfig = config.mouseInteraction || {};
            const wakeInteractionFlag = this.parallax.getFlag('effects.water-ripple.wakeInteraction');
            const mouseEnabled = wakeInteractionFlag && mouseConfig.enabled !== false;
            this.fadeInSpeed = mouseConfig.fadeInSpeed ?? mouseConfig.fadeSpeed ?? 0.002;
            this.fadeOutSpeed = mouseConfig.fadeOutSpeed ?? mouseConfig.fadeSpeed ?? 0.002;
            this.maxLifetime = mouseConfig.maxLifetime ?? 12;
            this.velocityThreshold = mouseConfig.velocityThreshold ?? 0.1;
            this.velocityBufferSize = mouseConfig.velocitySmoothing ?? 5;
            this.positionEasingMin = mouseConfig.positionEasingMin ?? 0.06;
            this.positionEasingMax = mouseConfig.positionEasingMax ?? 0.3;
            this.trailSpacing = mouseConfig.trailSpacing ?? 0.03;
            
            // Sploosh interaction config
            const splooshConfig = config.splooshInteraction || {};
            const splooshFlag = this.parallax.getFlag('effects.water-ripple.splooshInteraction');
            const splooshEnabled = splooshFlag && splooshConfig.enabled !== false;
            this.splooshDuration = splooshConfig.duration ?? 3.0;

            const effectUniforms = {
                map: { value: this.parallax.imageTexture },
                maskMap: { value: maskTexture },
                rippleNormal: { value: rippleTexture },
                time: { value: 0 },
                rippleScale: { value: rippleScale },
                rippleSpeed: { value: rippleSpeed },
                refractionStrength: { value: refractionStrength },
                // Wake uniforms
                mouseEnabled: { value: mouseEnabled ? 1.0 : 0.0 },
                wakeStrength: { value: mouseConfig.wakeStrength ?? mouseConfig.strength ?? 1.0 },
                wakeRadius: { value: mouseConfig.wakeRadius ?? mouseConfig.radius ?? 0.15 },
                wakeAngle: { value: mouseConfig.wakeAngle ?? 0.35 },
                wakeLength: { value: mouseConfig.wakeLength ?? 0.25 },
                wakeFrequency: { value: mouseConfig.wakeFrequency ?? 25.0 },
                wakeRippleSpeed: { value: mouseConfig.wakeRippleSpeed ?? 2.0 },
                wakeTint: { value: mouseConfig.wakeTint ?? 3.0 },
                // Per-slot instance uniforms
                mouseInstanceCount: { value: 0 },
                mouseInstancePos0: { value: new THREE.Vector2(-1, -1) },
                mouseInstancePos1: { value: new THREE.Vector2(-1, -1) },
                mouseInstancePos2: { value: new THREE.Vector2(-1, -1) },
                mouseInstancePos3: { value: new THREE.Vector2(-1, -1) },
                mouseInstancePos4: { value: new THREE.Vector2(-1, -1) },
                mouseInstancePos5: { value: new THREE.Vector2(-1, -1) },
                mouseInstancePos6: { value: new THREE.Vector2(-1, -1) },
                mouseInstancePos7: { value: new THREE.Vector2(-1, -1) },
                mouseInstanceVel0: { value: new THREE.Vector2(0, 0) },
                mouseInstanceVel1: { value: new THREE.Vector2(0, 0) },
                mouseInstanceVel2: { value: new THREE.Vector2(0, 0) },
                mouseInstanceVel3: { value: new THREE.Vector2(0, 0) },
                mouseInstanceVel4: { value: new THREE.Vector2(0, 0) },
                mouseInstanceVel5: { value: new THREE.Vector2(0, 0) },
                mouseInstanceVel6: { value: new THREE.Vector2(0, 0) },
                mouseInstanceVel7: { value: new THREE.Vector2(0, 0) },
                mouseInstanceAlpha0: { value: 0 },
                mouseInstanceAlpha1: { value: 0 },
                mouseInstanceAlpha2: { value: 0 },
                mouseInstanceAlpha3: { value: 0 },
                mouseInstanceAlpha4: { value: 0 },
                mouseInstanceAlpha5: { value: 0 },
                mouseInstanceAlpha6: { value: 0 },
                mouseInstanceAlpha7: { value: 0 },
                // Sploosh uniforms
                splooshEnabled: { value: splooshEnabled ? 1.0 : 0.0 },
                splooshStrength: { value: splooshConfig.strength ?? 1.5 },
                splooshRadius: { value: splooshConfig.radius ?? 0.2 },
                splooshFrequency: { value: splooshConfig.frequency ?? 20.0 },
                splooshSpeed: { value: splooshConfig.speed ?? 0.08 },
                splooshTint: { value: splooshConfig.tint ?? 1.0 },
                splooshInstanceCount: { value: 0 },
                splooshPos0: { value: new THREE.Vector2(-1, -1) },
                splooshPos1: { value: new THREE.Vector2(-1, -1) },
                splooshPos2: { value: new THREE.Vector2(-1, -1) },
                splooshPos3: { value: new THREE.Vector2(-1, -1) },
                splooshPos4: { value: new THREE.Vector2(-1, -1) },
                splooshPos5: { value: new THREE.Vector2(-1, -1) },
                splooshPos6: { value: new THREE.Vector2(-1, -1) },
                splooshPos7: { value: new THREE.Vector2(-1, -1) },
                splooshAlpha0: { value: 0 },
                splooshAlpha1: { value: 0 },
                splooshAlpha2: { value: 0 },
                splooshAlpha3: { value: 0 },
                splooshAlpha4: { value: 0 },
                splooshAlpha5: { value: 0 },
                splooshAlpha6: { value: 0 },
                splooshAlpha7: { value: 0 },
                splooshAge0: { value: 0 },
                splooshAge1: { value: 0 },
                splooshAge2: { value: 0 },
                splooshAge3: { value: 0 },
                splooshAge4: { value: 0 },
                splooshAge5: { value: 0 },
                splooshAge6: { value: 0 },
                splooshAge7: { value: 0 }
            };

            this.overlayMesh = this.createCoarseAreaEffectMesh(
                DEFAULT_FRAGMENT_SHADER,
                effectUniforms,
                { overlaySegments: config.overlaySegments ?? 64, depthWrite: false }
            );
            this.overlayMesh.position.z = 0.01;

            this.uniforms = effectUniforms;
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

            log(`WaterRippleEffect: Water ripple initialized (overlaySegments: ${config.overlaySegments ?? 64})`);
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

    _getCanvasRect() {
        if (this._cachedRectFrame === this._frameCounter) return this._cachedRect;
        if (this.parallax?.canvas) {
            this._cachedRect = this.parallax.canvas.getBoundingClientRect();
        }
        this._cachedRectFrame = this._frameCounter;
        return this._cachedRect;
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
    }
    
    updateMouseInteraction(deltaTime) {
        if (!this.uniforms || !this.parallax || !this.overlayMesh) return;
        
        const wakeInteraction = this.parallax.getFlag('effects.water-ripple.wakeInteraction');
        const mouseConfig = this.getConfig().mouseInteraction || {};
        const shouldBeEnabled = wakeInteraction && mouseConfig.enabled !== false;
        
        // Update uniform immediately when flag changes
        this.uniforms.mouseEnabled.value = shouldBeEnabled ? 1.0 : 0.0;
        
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
                    inst.targetAlpha = 1.0;
                    
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
        if (this.currentInstanceIndex >= 0 && this.currentInstanceIndex < this.rippleInstances.length) {
            const inst = this.rippleInstances[this.currentInstanceIndex];
            inst.targetAlpha = 0.0;
            inst.fadeOutStartTime = this.time;
            inst.fadeOutStartAlpha = inst.alpha;
            // Store the frozen velocity magnitude for proportional reduction during fade
            const velMag = inst.velocity.length();
            inst.frozenVelMag = Math.max(velMag, 0.05);
            if (velMag < 0.05) {
                inst.velocity.normalize().multiplyScalar(0.05);
            }
        }
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
            targetAlpha: 0.0,
            fadeOutStartTime: this.time,
            fadeOutStartAlpha: 0.8,
            fadeInSpeed: this.fadeInSpeed,
            fadeOutSpeed: this.fadeOutSpeed,
            frozenVelMag: Math.max(velocity.length(), 0.05),
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
            targetAlpha: 1.0,
            fadeInSpeed: this.fadeInSpeed,
            fadeOutSpeed: this.fadeOutSpeed,
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

            // Update fade
            if (instance.targetAlpha === 0.0 && instance.fadeOutStartTime !== undefined) {
                const fadeOutDuration = 1.0 / Math.max(instance.fadeOutSpeed, 0.0001);
                const elapsed = this.time - instance.fadeOutStartTime;
                const t = Math.min(elapsed / fadeOutDuration, 1.0);
                instance.alpha = instance.fadeOutStartAlpha * (1.0 - t);
                if (t >= 1.0) instance.alpha = 0;
                
                if (instance.frozenVelMag > 0) {
                    const targetVelMag = instance.frozenVelMag * (1.0 - t);
                    instance.velocity.normalize().multiplyScalar(Math.max(targetVelMag, 0.0001));
                }
            } else {
                const fadeTime = 1.0 / Math.max(instance.fadeInSpeed, 0.0001);
                const fadeFactor = Math.pow(0.5, deltaTime / fadeTime);
                instance.alpha = instance.targetAlpha + (instance.alpha - instance.targetAlpha) * fadeFactor;
            }

            // Remove fully faded (but never remove active)
            if (instance.alpha <= 0 && !isActive) continue;

            this.rippleInstances[writeIdx++] = instance;
        }
        this.rippleInstances.length = writeIdx;
        this.currentInstanceIndex = currentRef ? this.rippleInstances.indexOf(currentRef) : -1;
    }
    
    updateInstanceUniforms() {
        if (!this.uniforms) return;
        
        const count = Math.min(this.rippleInstances.length, this.maxInstances);
        this.uniforms.mouseInstanceCount.value = count;
        
        for (let i = 0; i < this.maxInstances; i++) {
            if (i < count) {
                const instance = this.rippleInstances[i];
                this.uniforms[this._wakePosList[i]].value.copy(instance.position);
                this.uniforms[this._wakeVelList[i]].value.copy(instance.velocity);
                this.uniforms[this._wakeAlphaList[i]].value = instance.alpha;
            } else {
                this.uniforms[this._wakePosList[i]].value.set(-1, -1);
                this.uniforms[this._wakeVelList[i]].value.set(0, 0);
                this.uniforms[this._wakeAlphaList[i]].value = 0.0;
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
        if (!this.uniforms) return;
        
        const splooshFlag = this.parallax.getFlag('effects.water-ripple.splooshInteraction');
        const splooshConfig = this.getConfig().splooshInteraction || {};
        const shouldBeEnabled = splooshFlag && splooshConfig.enabled !== false;
        
        this.uniforms.splooshEnabled.value = shouldBeEnabled ? 1.0 : 0.0;
        
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
        if (!this.uniforms) return;
        
        const count = Math.min(this.splooshInstances.length, this.maxSplooshInstances);
        this.uniforms.splooshInstanceCount.value = count;
        
        for (let i = 0; i < this.maxSplooshInstances; i++) {
            if (i < count) {
                const inst = this.splooshInstances[i];
                this.uniforms[this._splooshPosList[i]].value.copy(inst.position);
                this.uniforms[this._splooshAlphaList[i]].value = inst.alpha;
                this.uniforms[this._splooshAgeList[i]].value = this.time - inst.birthTime;
            } else {
                this.uniforms[this._splooshPosList[i]].value.set(-1, -1);
                this.uniforms[this._splooshAlphaList[i]].value = 0.0;
                this.uniforms[this._splooshAgeList[i]].value = 0.0;
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
        
        const canvas = this.parallax.canvas;
        
        const handleMouseMove = (event) => {
            const rect = canvas.getBoundingClientRect();
            this.mousePixelX = event.clientX - rect.left;
            this.mousePixelY = event.clientY - rect.top;
            this.isTouching = false;
        };
        
        const handleTouchMove = (event) => {
            event.preventDefault(); // Prevent scrolling
            if (event.touches.length > 0) {
                const rect = canvas.getBoundingClientRect();
                this.mousePixelX = event.touches[0].clientX - rect.left;
                this.mousePixelY = event.touches[0].clientY - rect.top;
                this.isTouching = true;
            }
        };
        
        const handleTouchEnd = () => {
            this.isTouching = false;
        };
        
        const handleClick = (event) => {
            const rect = canvas.getBoundingClientRect();
            const px = event.clientX - rect.left;
            const py = event.clientY - rect.top;
            this.handleSploosh(px, py);
        };
        
        const handleTouchStart = (event) => {
            if (event.touches.length > 0) {
                const rect = canvas.getBoundingClientRect();
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
        
        this.overlayMesh = null;
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
