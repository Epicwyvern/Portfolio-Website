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
    
    // Mouse interaction uniforms - instanced system (per-slot for WebGL compatibility)
    uniform float mouseStrength;
    uniform float mouseRadius;
    uniform float mouseEnabled;
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

    vec2 addInstanceContribution(vec2 instancePos, vec2 instanceVel, float instanceAlpha) {
        if (instanceAlpha <= 0.001 || instancePos.x < 0.0 || instancePos.x > 1.0 || instancePos.y < 0.0 || instancePos.y > 1.0) return vec2(0.0);
        vec2 toInstance = vUv - instancePos;
        float distToInstance = length(toInstance);
        if (distToInstance >= mouseRadius || distToInstance < 0.001) return vec2(0.0);
        float normalizedDist = distToInstance / mouseRadius;
        float falloff = 1.0 - normalizedDist;
        falloff = falloff * falloff;
        float rippleFrequency = 15.0;
        float rippleSpeedLocal = 3.0;
        float ripplePhase = distToInstance * rippleFrequency - time * rippleSpeedLocal;
        float ripple1 = sin(ripplePhase) * 0.5 + 0.5;
        float ripple2 = sin(ripplePhase * 1.3 + 1.0) * 0.5 + 0.5;
        float ripplePattern = (ripple1 + ripple2 * 0.6) / 1.6;
        float velocityMag = length(instanceVel);
        vec2 instanceDir = velocityMag > 0.01 ? normalize(instanceVel) : vec2(0.0);
        vec2 toInstanceNorm = normalize(toInstance);
        float wakeFactor = max(0.0, dot(toInstanceNorm, instanceDir));
        float movementIntensity = min(velocityMag * 3.0, 1.0);
        float wakeIntensity = wakeFactor * wakeFactor * movementIntensity;
        float combinedIntensity = ripplePattern * (1.0 - wakeIntensity * 0.4) + wakeIntensity;
        float rippleIntensity = falloff * mouseStrength * combinedIntensity * instanceAlpha;
        return toInstanceNorm * rippleIntensity * 0.08;
    }

    void main() {
        float maskStrength = texture2D(maskMap, vUv).r;
        if (maskStrength < 0.00392) discard;

        // AMBIENT RIPPLE - Keep this completely separate and unchanged
        vec2 rippleUV = vUv * rippleScale + time * rippleSpeed;
        vec3 normal = normalize(texture2D(rippleNormal, rippleUV).xyz * 2.0 - 1.0);
        
        // MOUSE INTERACTION - Instanced system (unrolled for WebGL 1 compatibility)
        vec2 mouseDisplacement = vec2(0.0);
        if (mouseEnabled > 0.5 && mouseInstanceCount > 0) {
            if (mouseInstanceCount > 0) mouseDisplacement += addInstanceContribution(mouseInstancePos0, mouseInstanceVel0, mouseInstanceAlpha0);
            if (mouseInstanceCount > 1) mouseDisplacement += addInstanceContribution(mouseInstancePos1, mouseInstanceVel1, mouseInstanceAlpha1);
            if (mouseInstanceCount > 2) mouseDisplacement += addInstanceContribution(mouseInstancePos2, mouseInstanceVel2, mouseInstanceAlpha2);
            if (mouseInstanceCount > 3) mouseDisplacement += addInstanceContribution(mouseInstancePos3, mouseInstanceVel3, mouseInstanceAlpha3);
            if (mouseInstanceCount > 4) mouseDisplacement += addInstanceContribution(mouseInstancePos4, mouseInstanceVel4, mouseInstanceAlpha4);
            if (mouseInstanceCount > 5) mouseDisplacement += addInstanceContribution(mouseInstancePos5, mouseInstanceVel5, mouseInstanceAlpha5);
            if (mouseInstanceCount > 6) mouseDisplacement += addInstanceContribution(mouseInstancePos6, mouseInstanceVel6, mouseInstanceAlpha6);
            if (mouseInstanceCount > 7) mouseDisplacement += addInstanceContribution(mouseInstancePos7, mouseInstanceVel7, mouseInstanceAlpha7);
        }
        
        // Combine ambient ripple normal with mouse displacement
        vec2 combinedDisplacement = normal.xy + mouseDisplacement;
        
        vec2 refractedUV = vUv + combinedDisplacement * refractionStrength * maskStrength;
        vec4 bgColor = texture2D(map, refractedUV);

        gl_FragColor = vec4(bgColor.rgb, maskStrength);
    }
`;

class WaterRippleEffect extends BaseEffect {
    constructor(scene, camera, renderer, parallaxInstance) {
        super(scene, camera, renderer, parallaxInstance);
        this.effectType = 'area';
        
        // Mouse interaction tracking - instanced system
        // Will be initialized in init() after config is loaded
        this.rippleInstances = [];
        this.maxInstances = 8;
        this.currentInstanceIndex = -1;
        this.fadeInSpeed = 0.002;
        this.fadeOutSpeed = 0.002;
        this.wasOverWater = false;
        this.lastMouseUV = new THREE.Vector2(-1, -1);
        
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
            try {
                [maskTexture, rippleTexture] = await Promise.all([
                    loadWithFallback(maskPath, ['assets/bg2WaterBW.png', 'assets/bg2WaterBW.webp'].map(f => basePath + f).filter(p => p !== maskPath)),
                    loadWithFallback(ripplePath, ['assets/waterripplenormal.jpg', 'assets/waterripplenormal.webp'].map(f => basePath + f).filter(p => p !== ripplePath))
                ]);
            } catch (textureError) {
                console.error('WaterRippleEffect: Failed to load textures. Check maskPath and ripplePath in config. Tried:', maskPath, ripplePath, textureError);
                throw textureError;
            }

            maskTexture.wrapS = maskTexture.wrapT = THREE.ClampToEdgeWrapping;
            rippleTexture.wrapS = rippleTexture.wrapT = THREE.RepeatWrapping;

            this.textures.push(maskTexture, rippleTexture);
            
            // Defer mask sampler so it doesn't block first paint (was causing long black screen)
            this.maskSampler = null;
            const scheduleMaskSampler = () => {
                if (typeof requestIdleCallback !== 'undefined') {
                    requestIdleCallback(() => { this.maskSampler = this.buildMaskSampler(maskTexture); }, { timeout: 500 });
                } else {
                    setTimeout(() => { this.maskSampler = this.buildMaskSampler(maskTexture); }, 0);
                }
            };
            scheduleMaskSampler();

            const rippleScale = config.rippleScale ?? 3.0;
            const rippleSpeed = config.rippleSpeed ?? 0.05;
            const refractionStrength = config.refractionStrength ?? 0.02;
            
            // Mouse interaction config
            const mouseConfig = config.mouseInteraction || {};
            const mouseEnabled = mouseConfig.enabled !== false; // Default enabled
            const mouseStrength = mouseConfig.strength ?? 0.5;
            const mouseRadius = mouseConfig.radius ?? 0.15;
            // Fade speeds (lower = slower fade, ~0.001 = very slow, ~0.01 = faster)
            this.fadeInSpeed = mouseConfig.fadeInSpeed ?? mouseConfig.fadeSpeed ?? 0.002;
            this.fadeOutSpeed = mouseConfig.fadeOutSpeed ?? mouseConfig.fadeSpeed ?? 0.002;
            // Hard limit: instances are removed after this many seconds (avoids runaway ripples if fade-out misbehaves)
            this.maxLifetime = mouseConfig.maxLifetime ?? 12;

            const effectUniforms = {
                map: { value: this.parallax.imageTexture },
                maskMap: { value: maskTexture },
                rippleNormal: { value: rippleTexture },
                time: { value: 0 },
                rippleScale: { value: rippleScale },
                rippleSpeed: { value: rippleSpeed },
                refractionStrength: { value: refractionStrength },
                // Mouse interaction uniforms - instanced system
                mouseStrength: { value: mouseStrength },
                mouseRadius: { value: mouseRadius },
                mouseEnabled: { value: mouseEnabled ? 1.0 : 0.0 },
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
        
        const mouseConfig = this.getConfig().mouseInteraction || {};
        if (mouseConfig.enabled === false) {
            this.uniforms.mouseEnabled.value = 0.0;
            this.rippleInstances = [];
            this.updateInstanceUniforms();
            return;
        }
        
        // Check if input is active (mouse on screen OR touch active)
        const inputActive = this.parallax.mouseOnScreen || this.isTouching;
        
        // Track current state
        let isOverWater = false;
        let currentMouseUV = null;
        let currentMouseVelocity = new THREE.Vector2(0, 0);
        
        if (inputActive) {
            // Input active - use raycasting to get accurate UV coordinates
            const mouseUV = this.getMouseUVFromRaycast();
            
            // Only consider "over water" when raycast hits AND mask at that UV is water
            if (mouseUV && mouseUV.x >= 0 && mouseUV.x <= 1 && mouseUV.y >= 0 && mouseUV.y <= 1) {
                if (this.isUVOverWater(mouseUV.x, mouseUV.y)) {
                    isOverWater = true;
                    currentMouseUV = mouseUV;
                }
                
                // Calculate velocity from previous mouse position
                if (this.lastMouseUV.x >= 0 && this.lastMouseUV.y >= 0) {
                    const deltaUV = new THREE.Vector2().subVectors(mouseUV, this.lastMouseUV);
                    const velocityScale = 1.0 / Math.max(deltaTime, 0.001);
                    currentMouseVelocity.set(
                        deltaUV.x * velocityScale,
                        deltaUV.y * velocityScale
                    );
                    const maxVelocity = 10.0;
                    currentMouseVelocity.clampLength(0, maxVelocity);
                }
                
                this.lastMouseUV.copy(mouseUV);
            }
        }
        
        // Handle instance creation and updates
        if (isOverWater && currentMouseUV) {
            // Check if this is a new entry (wasn't over water last frame)
            const isNewEntry = !this.wasOverWater;
            
            if (isNewEntry) {
                // Create new ripple instance
                this.createRippleInstance(currentMouseUV, currentMouseVelocity);
            } else {
                // Update current active instance position and velocity
                if (this.currentInstanceIndex >= 0 && this.currentInstanceIndex < this.rippleInstances.length) {
                    const instance = this.rippleInstances[this.currentInstanceIndex];
                    instance.position.copy(currentMouseUV);
                    instance.velocity.copy(currentMouseVelocity);
                    instance.targetAlpha = 1.0; // Keep fading in while over water
                }
            }
        } else {
            // Mouse left water - start fade-out on current instance
            if (this.currentInstanceIndex >= 0 && this.currentInstanceIndex < this.rippleInstances.length) {
                const instance = this.rippleInstances[this.currentInstanceIndex];
                instance.targetAlpha = 0.0; // Start fade-out immediately
                instance.velocity.multiplyScalar(0.9); // Decay velocity
            }
            this.currentInstanceIndex = -1; // No active instance
        }
        
        // Update state tracking
        this.wasOverWater = isOverWater;
        
        // Update all instances (fade in/out)
        this.updateRippleInstances(deltaTime);
        
        // Update uniforms
        this.updateInstanceUniforms();
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

        // 2) Update fade for each instance
        for (let i = 0; i < this.rippleInstances.length; i++) {
            const instance = this.rippleInstances[i];
            const isFadingIn = instance.targetAlpha > instance.alpha;
            const currentFadeSpeed = isFadingIn ? instance.fadeInSpeed : instance.fadeOutSpeed;
            const fadeTime = 1.0 / Math.max(currentFadeSpeed, 0.0001);
            const fadeFactor = Math.pow(0.5, deltaTime / fadeTime);
            instance.alpha = instance.targetAlpha + (instance.alpha - instance.targetAlpha) * fadeFactor;
            if (instance.targetAlpha === 0.0) instance.velocity.multiplyScalar(0.9);
        }

        // 3) Remove instances that have fully faded out — but never remove the current active ripple
        //    (new ripples start at alpha 0 and would otherwise be removed before they fade in)
        this.rippleInstances = this.rippleInstances.filter(inst =>
            inst.alpha > 0.001 || inst === currentRef
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
        super.cleanup();
    }
}

export default WaterRippleEffect;
