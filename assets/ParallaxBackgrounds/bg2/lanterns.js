// Lantern Effect - Twinkling and shining lanterns for bg2 magical scene
// Uses flare_1.png for particle-based twinkling effect with growth, fade, and overlay

import BaseEffect from '../../../js/base-effect.js';
import * as THREE from 'https://unpkg.com/three@0.172.0/build/three.module.js';

const log = (...args) => {
    if (window.location.pathname.endsWith('test-effects.html')) {
        console.log(...args);
    }
};

class LanternEffect extends BaseEffect {
    async init() {
        log('LanternEffect: Initializing twinkling lantern effect');
        
        try {
            // Load the flare texture for lanterns (only if not already loaded)
            if (!this.flareTexture) {
                this.flareTexture = await this.loadTexture('./assets/ParallaxBackgrounds/bg2/assets/flare_1.png');
                log('LanternEffect: Successfully loaded flare texture');
            }
            
            // Load lantern configuration from parallax config (store full config for reference)
            if (!this.fullLanternConfig) {
                this.fullLanternConfig = await this.loadLanternConfig();
                log('LanternEffect: Loaded lantern configuration:', this.fullLanternConfig);
            }
            const lanternConfig = this.fullLanternConfig;
            
            log(`LanternEffect: Creating ${lanternConfig.lanterns.length} lantern systems`);
            
            // Positions are baked into the mesh: config stores UV (0-1). World position is computed
            // each frame via parallax.getWorldPositionForUV(mesh.localToWorld)—no manual sync.
            this.lanternSystems = [];
            lanternConfig.lanterns.forEach((lanternData, index) => {
                try {
                    // Merge with defaults - create all systems; runtime flag controls visibility
                    const config = { ...lanternConfig.defaults, ...lanternData };
                    const lanternName = config.name;
                    
                    // Config coordinates are image UV (u,v) 0-1; Z comes from mesh surface at that UV
                    const basePosition = new THREE.Vector3(
                        config.position.x ?? 0.5,
                        config.position.y ?? 0.5,
                        0 // Z ignored; getWorldPositionForUV derives it from mesh geometry
                    );
                    
                    if (index === 0) log(`LanternEffect: Sample lantern system - basePosition (UV):`, basePosition);
                    
                    // Create lantern system; originPosition filled each frame from getWorldPositionForUV
                    const lanternSystem = {
                        name: config.name,
                        index: index,
                        originPosition: new THREE.Vector3(), // Filled each frame from mesh
                        basePosition: basePosition,
                        config: config,
                        particles: [], // Array of active particles
                        nextParticleTime: 0, // When to spawn next particle
                    };
                    
                    this.lanternSystems.push(lanternSystem);
                    log(`LanternEffect: Created lantern system ${index} (${config.name})`);
                    
                } catch (error) {
                    console.error(`LanternEffect: Error creating lantern system ${index}:`, error);
                }
            });
            
            this._refreshDisabledLanterns();
            this._unsubLanternChange = this.parallax?.onLanternIndividualChange?.(
                () => this._refreshDisabledLanterns()
            );
            
            if (lanternConfig.clickToToggle !== false) {
                this.setupClickToToggle();
            }
            
            // Initialize animation properties
            this.time = 0;
            this.isInitialized = true;
            
            log(`LanternEffect: Successfully initialized with ${this.lanternSystems.length} lantern systems`);
            
        } catch (error) {
            console.error('LanternEffect: Error during initialization:', error);
            throw error;
        }
    }
    
    update(deltaTime) {
        if (!this.isInitialized) {
            return;
        }
        
        // Initialize time if undefined
        if (this.time === undefined) {
            this.time = 0;
            log('LanternEffect: Initialized time in update method');
        }
        
        // Update animation time
        const frameDelta = Number.isFinite(deltaTime) && deltaTime > 0 ? deltaTime : 0.016;
        this.time += frameDelta;
        
        // Update each lantern system
        this.lanternSystems.forEach((system, systemIndex) => {
            try {
                if (this._disabledLanterns?.has(system.name)) {
                    if (system.particles.length > 0) {
                        system.particles.forEach((p) => {
                            this.scene.remove(p.mesh);
                            p.mesh.geometry.dispose();
                            p.mesh.material.dispose();
                        });
                        system.particles.length = 0;
                    }
                    return;
                }
                // Bake position from mesh (UV -> world via mesh.localToWorld)
                this.parallax?.getWorldPositionForUV(
                    system.basePosition.x, system.basePosition.y, 0,
                    system.originPosition
                );
                // Check if we need to spawn a new particle
                if (this.time >= system.nextParticleTime && system.particles.length < system.config.count) {
                    this.spawnParticle(system);
                    
                    // Schedule next particle spawn
                    const spawnInterval = 1.0 / (system.config.newParticleSpeed || 1.0);
                    const randomDelay = (Math.random() - 0.5) * spawnInterval * 0.5; // Add some randomness
                    system.nextParticleTime = this.time + spawnInterval + randomDelay;
                }
                
                // Update existing particles
                for (let i = system.particles.length - 1; i >= 0; i--) {
                    const particle = system.particles[i];
                    
                    // Update particle age
                    particle.age += frameDelta;
                    
                    // Check if particle has exceeded its lifetime
                    if (particle.age >= particle.lifetime) {
                // Remove particle
                this.scene.remove(particle.mesh);
                particle.mesh.geometry.dispose();
                particle.mesh.material.dispose();
                system.particles.splice(i, 1);
                continue;
                    }
                    
                    // Update particle animation
                    this.updateParticle(particle, system);
                }
                
            } catch (error) {
                console.error(`LanternEffect: Error updating lantern system ${systemIndex}:`, error);
            }
        });
    }
    
    _getClickRadius(system) {
        const growth = system.config?.growthSpeed ?? 2.0;
        const lifetime = system.config?.lifetime ?? 2.5;
        const scale = system.config?.scale ?? 1.0;
        const finalSize = growth * lifetime * scale;
        const radius = finalSize * 8;
        return Math.max(14, Math.min(60, radius));
    }

    _findLanternAtClientXY(clientX, clientY) {
        const canvas = this.parallax?.canvas;
        const camera = this.camera;
        if (!canvas || !camera || !this.lanternSystems?.length) return null;
        const rect = canvas.getBoundingClientRect();
        const mouseX = clientX - rect.left;
        const mouseY = clientY - rect.top;
        const _proj = this._projVec ?? (this._projVec = new THREE.Vector3());
        let closest = null;
        let closestDist = Infinity;
        for (const system of this.lanternSystems) {
            if (!system?.originPosition) continue;
            _proj.copy(system.originPosition).project(camera);
            if (_proj.z < -1 || _proj.z > 1) continue;
            const sx = (_proj.x * 0.5 + 0.5) * rect.width;
            const sy = (0.5 - _proj.y * 0.5) * rect.height;
            const radius = this._getClickRadius(system);
            const dx = mouseX - sx;
            const dy = mouseY - sy;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d <= radius && d < closestDist) {
                closestDist = d;
                closest = system;
            }
        }
        return closest;
    }

    setupClickToToggle() {
        const canvas = this.parallax?.canvas;
        if (!canvas) return;
        const tapMaxDurationMs = 280;
        const tapMoveThresholdPx = 12;
        this._activeTouchToggle = null;
        this._lastTouchEndAt = 0;

        const handleClick = (e) => {
            // Ignore synthetic click events generated right after touch interactions.
            if (performance.now() - (this._lastTouchEndAt || 0) < 700) return;
            const system = this._findLanternAtClientXY(e.clientX, e.clientY);
            if (system) {
                const name = system.name;
                const current = this.parallax.getFlag(`effects.lanterns.individual.${name}`);
                this.parallax.setFlag(`effects.lanterns.individual.${name}`, !current);
            }
        };

        const handleTouchStart = (e) => {
            const t = e.touches && e.touches[0];
            if (!t) return;
            this._activeTouchToggle = {
                id: t.identifier,
                startX: t.clientX,
                startY: t.clientY,
                startTime: performance.now(),
                moved: false
            };
        };

        const handleTouchMove = (e) => {
            if (!this._activeTouchToggle) return;
            let activeTouch = null;
            for (let i = 0; i < e.touches.length; i++) {
                const t = e.touches[i];
                if (t.identifier === this._activeTouchToggle.id) {
                    activeTouch = t;
                    break;
                }
            }
            if (!activeTouch) return;
            const dx = activeTouch.clientX - this._activeTouchToggle.startX;
            const dy = activeTouch.clientY - this._activeTouchToggle.startY;
            if ((dx * dx + dy * dy) > (tapMoveThresholdPx * tapMoveThresholdPx)) {
                this._activeTouchToggle.moved = true;
            }
        };

        const handleTouchEnd = (e) => {
            const state = this._activeTouchToggle;
            this._lastTouchEndAt = performance.now();
            if (!state) return;

            let changed = null;
            for (let i = 0; i < e.changedTouches.length; i++) {
                const t = e.changedTouches[i];
                if (t.identifier === state.id) {
                    changed = t;
                    break;
                }
            }
            this._activeTouchToggle = null;
            if (!changed) return;

            const duration = performance.now() - state.startTime;
            if (state.moved || duration > tapMaxDurationMs) return;

            const system = this._findLanternAtClientXY(changed.clientX, changed.clientY);
            if (system) {
                e.preventDefault();
                const name = system.name;
                const current = this.parallax.getFlag(`effects.lanterns.individual.${name}`);
                this.parallax.setFlag(`effects.lanterns.individual.${name}`, !current);
            }
        };

        const handleTouchCancel = () => {
            this._activeTouchToggle = null;
        };

        canvas.addEventListener('click', handleClick);
        canvas.addEventListener('touchstart', handleTouchStart, { passive: true });
        canvas.addEventListener('touchmove', handleTouchMove, { passive: true });
        canvas.addEventListener('touchend', handleTouchEnd, { passive: false });
        canvas.addEventListener('touchcancel', handleTouchCancel, { passive: true });
        this._clickHandler = handleClick;
        this._touchStartHandler = handleTouchStart;
        this._touchMoveHandler = handleTouchMove;
        this._touchHandler = handleTouchEnd;
        this._touchCancelHandler = handleTouchCancel;
    }

    _refreshDisabledLanterns() {
        this._disabledLanterns = new Set();
        const cfg = this.parallax?.config?.effects?.lanterns;
        if (!this.parallax || !cfg?.lanterns) return;
        for (const l of cfg.lanterns) {
            const name = l.name;
            if (this.parallax.getFlag(`effects.lanterns.individual.${name}`) === false) {
                this._disabledLanterns.add(name);
            }
        }
    }
    
    spawnParticle(system) {
        try {
            // Get blend mode from config
            const blendMode = this.getBlendMode(system.config.blendMode || 'AdditiveBlending');
            const depthWrite = system.config.depthWrite !== undefined ? system.config.depthWrite : false;
            const depthTest = system.config.depthTest !== undefined ? system.config.depthTest : false;
            const alphaTest = system.config.alphaTest || 0.01;
            
            // Create particle mesh with configurable blend mode
            // depthTest: true = sample depth buffer so nearer mesh (e.g. foreground tree) occludes the flare
            // depthWrite: usually false for transparent/additive so we do not overwrite scene depth incorrectly
            // depthTest: false (default) = glow draws on top of everything
            // Position uses exact mesh depth for perfect parallax alignment
            const particle = this.createPlaneMesh(
                0.1, // Base size - will be scaled
                0.1, 
                this.flareTexture, 
                system.originPosition.clone(),
                {
                    transparent: true,
                    alphaTest: alphaTest,
                    blending: blendMode,
                    side: THREE.DoubleSide,
                    depthWrite: depthWrite,
                    depthTest: depthTest
                }
            );
            
            // Random rotation for this particle
            const randomRotation = Math.random() * Math.PI * 2;
            particle.rotation.z = randomRotation;
            
            // Create particle data
            const particleData = {
                mesh: particle,
                age: 0,
                lifetime: system.config.lifetime * (0.7 + Math.random() * 0.6), // Random lifetime variation
                growthSpeed: system.config.growthSpeed || 2.0,
                baseScale: system.config.scale || 1.0, // Base scale multiplier for the growth
                maxOpacity: system.config.opacity || 0.8,
                color: system.config.color || 0xffaa44,
                initialRotation: randomRotation,
                colorObj: new THREE.Color(system.config.color || 0xffaa44),
                glowColor: new THREE.Color(system.config.color || 0xffaa44)
            };
            
            // Store reference to system for parallax movement
            particle.userData = {
                system: system,
                particleData: particleData
            };
            
            system.particles.push(particleData);
            
        } catch (error) {
            console.error('LanternEffect: Error spawning particle:', error);
        }
    }
    
    updateParticle(particle, system) {
        try {
            const mesh = particle.mesh;
            const lifeProgress = particle.age / particle.lifetime;
            
            // Continuous growth animation: grows throughout lifetime based on growthSpeed
            const currentScale = particle.growthSpeed * particle.age * particle.baseScale;
            mesh.scale.set(currentScale, currentScale, 1);
            
            // Opacity animation: fade in, stay bright, then fade out
            let opacityProgress;
            if (lifeProgress < 0.2) {
                // Fade in phase (0 to 20% of lifetime)
                opacityProgress = lifeProgress / 0.2;
                opacityProgress = this.easeOutQuad(opacityProgress);
            } else if (lifeProgress < 0.7) {
                // Bright phase (20% to 70% of lifetime)
                opacityProgress = 1.0;
            } else {
                // Fade out phase (70% to 100% of lifetime)
                const fadeProgress = (lifeProgress - 0.7) / 0.3;
                opacityProgress = 1.0 - this.easeInQuad(fadeProgress);
            }
            
            mesh.material.opacity = opacityProgress * particle.maxOpacity;
            
            // Color tinting for glow effect
            const currentOpacity = mesh.material.opacity;
            const normalizedOpacity = currentOpacity / particle.maxOpacity;
            const glowIntensity = 0.5 + normalizedOpacity * 0.5;
            particle.glowColor.copy(particle.colorObj).multiplyScalar(glowIntensity);
            mesh.material.color.copy(particle.glowColor);
            
            // Apply parallax movement - same formula as mesh vertex shader; full displacement for perfect alignment
            let parallaxOffsetX = 0;
            let parallaxOffsetY = 0;
            if (this.parallax?.getParallaxDisplacementForUV) {
                const disp = this.parallax.getParallaxDisplacementForUV(
                    system.basePosition.x, system.basePosition.y
                );
                parallaxOffsetX = disp.x;
                parallaxOffsetY = disp.y;
            }
            // World Z: mesh surface at lantern UV. Optional depthBias (world units) moves the quad toward +Z
            // (camera sits on +Z) so depthTest can ignore parallax-stretched edge geometry while the solid
            // trunk still occludes. Tune per lantern when depthTest is true.
            const db = system.config.depthBias;
            const zBias = typeof db === 'number' && Number.isFinite(db) ? db : 0;
            mesh.position.x = system.originPosition.x + parallaxOffsetX;
            mesh.position.y = system.originPosition.y + parallaxOffsetY;
            mesh.position.z = system.originPosition.z + zBias;
                
            } catch (error) {
            console.error('LanternEffect: Error updating particle:', error);
        }
    }
    
    // Blend mode configuration helper
    getBlendMode(blendModeString) {
        const blendModes = {
            'NoBlending': THREE.NoBlending,
            'NormalBlending': THREE.NormalBlending,
            'AdditiveBlending': THREE.AdditiveBlending,
            'SubtractiveBlending': THREE.SubtractiveBlending,
            'MultiplyBlending': THREE.MultiplyBlending,
            'CustomBlending': THREE.CustomBlending
        };
        
        return blendModes[blendModeString] || THREE.AdditiveBlending;
    }
    
    // Easing functions for smooth animations
    easeOutCubic(t) {
        return 1 - Math.pow(1 - t, 3);
    }
    
    easeInCubic(t) {
        return t * t * t;
    }
    
    easeOutQuad(t) {
        return 1 - (1 - t) * (1 - t);
    }
    
    easeInQuad(t) {
        return t * t;
    }
    
    easeInOutQuart(t) {
        return t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2;
    }
    
    easeOutBack(t) {
        const c1 = 1.70158;
        const c3 = c1 + 1;
        return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    }
    
    // No-op: lantern positions are baked into the mesh via getWorldPositionForUV (UV -> mesh.localToWorld)
    updatePositionsForMeshTransform(_meshTransform) {
        // Positions computed each frame from parallax.getWorldPositionForUV in update()
    }
    
    // Calculate what the mesh transform would be at a canonical/reference viewport size
    calculateCanonicalMeshTransform() {
        // Get reference viewport size from config
        const referenceViewport = this.parallax.config.settings.referenceViewport || { width: 1920, height: 1080 };
        const REFERENCE_WIDTH = referenceViewport.width;
        const REFERENCE_HEIGHT = referenceViewport.height;
        
        log(`LanternEffect: Calculating canonical transform for reference viewport: ${REFERENCE_WIDTH}x${REFERENCE_HEIGHT}`);
        
        // Replicate the same mesh transform calculation from parallax.js but for reference viewport
        const containerAspect = REFERENCE_WIDTH / REFERENCE_HEIGHT;
        const imageAspect = this.parallax.depthData.width / this.parallax.depthData.height;
        const cameraZ = this.parallax.camera.position.z; // Use same camera Z as current
        const visibleHeight = 2 * Math.tan(THREE.MathUtils.degToRad(45/2)) * cameraZ;
        const visibleWidth = visibleHeight * containerAspect; // Use reference aspect ratio
        
        // Calculate scale the same way as in createMesh()
        let baseScale;
        if (containerAspect > imageAspect) {
            // Viewport is wider than image - scale by width to fill horizontally
            baseScale = visibleWidth / this.parallax.mesh.geometry.parameters.width;
        } else {
            // Viewport is taller than image - scale by height to fill vertically
            baseScale = visibleHeight / this.parallax.mesh.geometry.parameters.height;
        }
        
        const finalScale = baseScale * this.parallax.extraScale;
        
        // Calculate position the same way as in positionMeshByFocalPoint()
        const scaledMeshWidth = this.parallax.mesh.geometry.parameters.width * finalScale;
        const scaledMeshHeight = this.parallax.mesh.geometry.parameters.height * finalScale;
        const overflowX = scaledMeshWidth - visibleWidth;
        const overflowY = scaledMeshHeight - visibleHeight;
        const offsetX = (0.5 - this.parallax.focalPoint.x) * overflowX;
        const offsetY = (0.5 - this.parallax.focalPoint.y) * overflowY;
        
        const canonicalTransform = {
            scale: finalScale,
            position: { x: offsetX, y: offsetY, z: 0 },
            baseGeometrySize: { 
                width: this.parallax.mesh.geometry.parameters.width,
                height: this.parallax.mesh.geometry.parameters.height
            }
        };
        
        log('LanternEffect: Canonical transform calculated:', canonicalTransform);
        return canonicalTransform;
    }
    
    // Load lantern configuration from the parallax config JSON
    async loadLanternConfig() {
        log('LanternEffect: Loading lantern configuration from parallax config');
        
        try {
            // Access the parallax config (which should already be loaded)
            if (!this.parallax || !this.parallax.config || !this.parallax.config.effects || !this.parallax.config.effects.lanterns) {
                console.warn('LanternEffect: No lantern config found in parallax config, using fallback');
                return this.getFallbackConfig();
            }
            
            const lanternConfig = this.parallax.config.effects.lanterns;
            
            // Parse color strings to hex numbers
            if (lanternConfig.defaults && lanternConfig.defaults.color) {
                lanternConfig.defaults.color = parseInt(lanternConfig.defaults.color, 16);
            }
            
            lanternConfig.lanterns.forEach(lantern => {
                if (lantern.color) {
                    lantern.color = parseInt(lantern.color, 16);
                }
            });
            
            log('LanternEffect: Successfully loaded lantern config from JSON');
            return lanternConfig;
            
        } catch (error) {
            console.error('LanternEffect: Error loading lantern config:', error);
            return this.getFallbackConfig();
        }
    }
    
    // Fallback configuration if JSON config fails
    getFallbackConfig() {
        log('LanternEffect: Using fallback lantern configuration');
        
        return {
            defaults: {
                scale: 1.0,
                opacity: 0.8,
                color: 0xffaa44,
                growthSpeed: 2.0,
                count: 3,
                lifetime: 2.0,
                newParticleSpeed: 1.5,
                blendMode: 'AdditiveBlending',
                depthWrite: false,
                alphaTest: 0.01
            },
            lanterns: [
                { name: 'fallback_lantern_1', position: { x: -0.5, y: 0.0 } },
                { name: 'fallback_lantern_2', position: { x: 0.5, y: 0.0 } }
            ]
        };
    }
    
    // Method to get lantern system by name
    getLanternSystem(name) {
        return this.lanternSystems.find(system => system.name === name);
    }
    
    // Method to set global intensity for all systems
    setGlobalIntensity(intensity) {
        this.lanternSystems.forEach(system => {
            system.config.opacity = intensity;
            // Update existing particles
            system.particles.forEach(particle => {
                particle.maxOpacity = intensity;
            });
        });
    }
    
    // Clean up all particles and systems
    cleanup() {
        if (this.lanternSystems) {
            this.lanternSystems.forEach(system => {
                system.particles.forEach(particle => {
                    if (particle.mesh) {
                        this.scene.remove(particle.mesh);
                        if (particle.mesh.geometry) particle.mesh.geometry.dispose();
                        if (particle.mesh.material) particle.mesh.material.dispose();
                    }
                });
                system.particles = [];
            });
            this.lanternSystems = [];
        }
        
        if (typeof this._unsubLanternChange === 'function') {
            this._unsubLanternChange();
            this._unsubLanternChange = null;
        }
        const canvas = this.parallax?.canvas;
        if (canvas && this._clickHandler) {
            canvas.removeEventListener('click', this._clickHandler);
            this._clickHandler = null;
        }
        if (canvas && this._touchHandler) {
            canvas.removeEventListener('touchend', this._touchHandler);
            this._touchHandler = null;
        }
        if (canvas && this._touchStartHandler) {
            canvas.removeEventListener('touchstart', this._touchStartHandler);
            this._touchStartHandler = null;
        }
        if (canvas && this._touchMoveHandler) {
            canvas.removeEventListener('touchmove', this._touchMoveHandler);
            this._touchMoveHandler = null;
        }
        if (canvas && this._touchCancelHandler) {
            canvas.removeEventListener('touchcancel', this._touchCancelHandler);
            this._touchCancelHandler = null;
        }
        this._activeTouchToggle = null;
        // Don't clear fullLanternConfig or flareTexture - keep them for re-init
        // Reset time to prevent stale state
        this.time = 0;
        
        // Remove textures from parent's textures array so they don't get disposed
        // We want to keep them for re-init
        if (this.flareTexture && this.textures.includes(this.flareTexture)) {
            const index = this.textures.indexOf(this.flareTexture);
            this.textures.splice(index, 1);
        }
        
        // Call parent cleanup
        super.cleanup();
        
        // Restore texture reference after cleanup
        if (this.flareTexture) {
            this.textures.push(this.flareTexture);
        }
    }
}

export default LanternEffect;