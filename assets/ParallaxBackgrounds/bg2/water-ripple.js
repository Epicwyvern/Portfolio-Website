// Water Ripple Effect - Area effect for bg2: ripples on masked water regions
// Uses mask (bg2WaterBW.png) for strength 0–255 and normal map for refraction
// Uses coarse overlay geometry for performance (configurable overlaySegments)

import BaseEffect from '../../../js/base-effect.js';
import * as THREE from 'https://unpkg.com/three@0.172.0/build/three.module.js';

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

        vec2 combinedDisplacement = normal.xy + wakeDisplacement;
        vec2 refractedUV = vUv + combinedDisplacement * refractionStrength * maskStrength;
        vec4 bgColor = texture2D(map, refractedUV);

        // Subtle tint in wake-disturbed areas: darken troughs, lighten crests
        float wakeMag = length(wakeDisplacement);
        float tintAmount = wakeMag * wakeTint;
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
        
        // Raycaster for accurate mouse-to-UV conversion
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        
        // Track actual mouse/touch pixel coordinates
        this.mousePixelX = 0;
        this.mousePixelY = 0;
        this.isTouching = false;
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
                mouseInstanceAlpha7: { value: 0 }
            };

            this.overlayMesh = this.createCoarseAreaEffectMesh(
                DEFAULT_FRAGMENT_SHADER,
                effectUniforms,
                { overlaySegments: config.overlaySegments ?? 256, depthWrite: false }
            );
            this.overlayMesh.position.z = 0.01;

            this.uniforms = effectUniforms;
            this.time = 0;
            
            // Setup mouse/touch tracking for wake interaction (restore after cleanup)
            this.setupMouseTracking();
            
            this.isInitialized = true;

            log(`WaterRippleEffect: Water ripple initialized (overlaySegments: ${config.overlaySegments ?? 256})`);
        } catch (error) {
            console.error('WaterRippleEffect: Error during initialization:', error);
            throw error;
        }
    }

    getConfig() {
        if (!this.parallax?.config?.effects?.waterRipple) {
            return {};
        }
        return this.parallax.config.effects.waterRipple;
    }

    update(deltaTime) {
        if (!this.isInitialized || !this.overlayMesh) return;

        const frameDelta = Number.isFinite(deltaTime) && deltaTime > 0 ? deltaTime : 0.016;
        this.time += frameDelta;
        if (this.uniforms?.time) this.uniforms.time.value = this.time;

        // Update mouse interaction
        this.updateMouseInteraction(frameDelta);

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
        let currentMouseVelocity = new THREE.Vector2(0, 0);
        
        if (inputActive) {
            const mouseUV = this.getMouseUVFromRaycast();
            if (mouseUV && mouseUV.x >= 0 && mouseUV.x <= 1 && mouseUV.y >= 0 && mouseUV.y <= 1) {
                if (this.isUVOverWater(mouseUV.x, mouseUV.y)) {
                    isOverWater = true;
                    currentMouseUV = mouseUV;
                }
                if (this.lastMouseUV.x >= 0 && this.lastMouseUV.y >= 0) {
                    const deltaUV = new THREE.Vector2().subVectors(mouseUV, this.lastMouseUV);
                    const velocityScale = 1.0 / Math.max(deltaTime, 0.001);
                    currentMouseVelocity.set(deltaUV.x * velocityScale, deltaUV.y * velocityScale);
                    currentMouseVelocity.clampLength(0, 10.0);
                }
                this.lastMouseUV.copy(mouseUV);
            }
        }
        
        if (isOverWater && currentMouseUV) {
            // Update velocity smoothing buffers (magnitude + direction)
            this.velocityBuffer.push(currentMouseVelocity.length());
            this.velocityVecBuffer.push(currentMouseVelocity.clone());
            while (this.velocityBuffer.length > this.velocityBufferSize) this.velocityBuffer.shift();
            while (this.velocityVecBuffer.length > this.velocityBufferSize) this.velocityVecBuffer.shift();
            const smoothedVel = this.velocityBuffer.reduce((a, b) => a + b, 0) / this.velocityBuffer.length;
            
            // Compute smoothed velocity vector (averages out micro-jitter in direction)
            const smoothedVelocity = new THREE.Vector2(0, 0);
            for (const v of this.velocityVecBuffer) smoothedVelocity.add(v);
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
        // Remove instances that have faded out completely
        this.rippleInstances = this.rippleInstances.filter(inst => inst.alpha > 0.001);
        
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

        // 1) Max lifetime: only remove *inactive* instances that have exceeded max lifetime.
        //    Never remove the current active ripple (mouse still on water).
        const maxAge = typeof this.maxLifetime === 'number' && this.maxLifetime > 0 ? this.maxLifetime : 12;
        this.rippleInstances = this.rippleInstances.filter(inst => {
            const isActive = inst === currentRef;
            if (isActive) return true;
            const age = this.time - (inst.createdAt ?? 0);
            return age < maxAge;
        });
        this.currentInstanceIndex = currentRef ? this.rippleInstances.indexOf(currentRef) : -1;

        // 2) Update fade and velocity for each instance
        for (let i = 0; i < this.rippleInstances.length; i++) {
            const instance = this.rippleInstances[i];
            
            if (instance.targetAlpha === 0.0 && instance.fadeOutStartTime !== undefined) {
                // LINEAR fade-out: guaranteed to reach exactly 0 at fadeOut duration
                const fadeOutDuration = 1.0 / Math.max(instance.fadeOutSpeed, 0.0001);
                const elapsed = this.time - instance.fadeOutStartTime;
                const t = Math.min(elapsed / fadeOutDuration, 1.0);
                instance.alpha = instance.fadeOutStartAlpha * (1.0 - t);
                if (t >= 1.0) instance.alpha = 0;
                
                // Proportionally reduce velocity so the wake pattern dissolves with the fade
                if (instance.frozenVelMag > 0) {
                    const targetVelMag = instance.frozenVelMag * (1.0 - t);
                    instance.velocity.normalize().multiplyScalar(Math.max(targetVelMag, 0.0001));
                }
            } else {
                // Fade-in: exponential approach toward targetAlpha (fast ramp-up)
                const fadeTime = 1.0 / Math.max(instance.fadeInSpeed, 0.0001);
                const fadeFactor = Math.pow(0.5, deltaTime / fadeTime);
                instance.alpha = instance.targetAlpha + (instance.alpha - instance.targetAlpha) * fadeFactor;
            }
        }

        // 3) Remove instances that have fully faded out — but never remove the current active ripple
        this.rippleInstances = this.rippleInstances.filter(inst =>
            inst.alpha > 0 || inst === currentRef
        );
        this.currentInstanceIndex = currentRef ? this.rippleInstances.indexOf(currentRef) : -1;
    }
    
    updateInstanceUniforms() {
        if (!this.uniforms) return;
        
        const count = Math.min(this.rippleInstances.length, this.maxInstances);
        this.uniforms.mouseInstanceCount.value = count;
        
        const posNames = ['mouseInstancePos0', 'mouseInstancePos1', 'mouseInstancePos2', 'mouseInstancePos3', 'mouseInstancePos4', 'mouseInstancePos5', 'mouseInstancePos6', 'mouseInstancePos7'];
        const velNames = ['mouseInstanceVel0', 'mouseInstanceVel1', 'mouseInstanceVel2', 'mouseInstanceVel3', 'mouseInstanceVel4', 'mouseInstanceVel5', 'mouseInstanceVel6', 'mouseInstanceVel7'];
        const alphaNames = ['mouseInstanceAlpha0', 'mouseInstanceAlpha1', 'mouseInstanceAlpha2', 'mouseInstanceAlpha3', 'mouseInstanceAlpha4', 'mouseInstanceAlpha5', 'mouseInstanceAlpha6', 'mouseInstanceAlpha7'];
        
        for (let i = 0; i < this.maxInstances; i++) {
            if (i < count) {
                const instance = this.rippleInstances[i];
                this.uniforms[posNames[i]].value.copy(instance.position);
                this.uniforms[velNames[i]].value.copy(instance.velocity);
                this.uniforms[alphaNames[i]].value = instance.alpha;
            } else {
                this.uniforms[posNames[i]].value.set(-1, -1);
                this.uniforms[velNames[i]].value.set(0, 0);
                this.uniforms[alphaNames[i]].value = 0.0;
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
        
        canvas.addEventListener('mousemove', handleMouseMove);
        canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
        canvas.addEventListener('touchend', handleTouchEnd);
        canvas.addEventListener('touchcancel', handleTouchEnd);
        
        // Store cleanup functions
        this._mouseMoveHandler = handleMouseMove;
        this._touchMoveHandler = handleTouchMove;
        this._touchEndHandler = handleTouchEnd;
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
        // Use raycasting to get accurate UV coordinates from mouse position
        // This is the most reliable method - it uses the actual mesh geometry
        
        if (!this.parallax || !this.parallax.canvas || !this.overlayMesh) {
            return null;
        }
        
        const canvas = this.parallax.canvas;
        const rect = canvas.getBoundingClientRect();
        
        // Convert pixel coordinates to normalized device coordinates (-1 to 1)
        this.mouse.x = ((this.mousePixelX / rect.width) * 2) - 1;
        this.mouse.y = -((this.mousePixelY / rect.height) * 2) + 1; // Invert Y axis
        
        // Update raycaster with camera and mouse position
        this.raycaster.setFromCamera(this.mouse, this.camera);
        
        // Intersect with the overlay mesh
        const intersects = this.raycaster.intersectObject(this.overlayMesh);
        
        if (intersects.length > 0) {
            const intersection = intersects[0];
            // Get UV coordinates from the intersection
            if (intersection.uv) {
                return intersection.uv.clone();
            }
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
