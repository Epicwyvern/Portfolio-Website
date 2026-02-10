// Lantern Effect - Twinkling and shining lanterns for bg2 magical scene
// Uses flare_1.png for particle-based twinkling effect with growth, fade, and overlay

import BaseEffect from '../../../js/base-effect.js';
import * as THREE from 'https://unpkg.com/three@0.172.0/build/three.module.js';

const log = (...args) => {
    if (window.location.pathname.endsWith('test-effects.html')) {
        console.log(...args);
    }
};

// Try to import GSAP, fall back to manual animations if not available
let gsap = null;
try {
    gsap = await import('../../../node_modules/gsap/index.js').then(module => module.gsap);
    log('LanternEffect: GSAP loaded successfully');
} catch (error) {
    log('LanternEffect: GSAP not available, using manual animations');
}

class LanternEffect extends BaseEffect {
    async init() {
        log('LanternEffect: Initializing twinkling lantern effect');
        
        try {
            // Load the flare texture for lanterns
            const flareTexture = await this.loadTexture('./assets/ParallaxBackgrounds/bg2/assets/flare_1.png');
            log('LanternEffect: Successfully loaded flare texture');
            
            // Store texture for creating particles
            this.flareTexture = flareTexture;
            
            // Load lantern configuration from parallax config
            const lanternConfig = await this.loadLanternConfig();
            log('LanternEffect: Loaded lantern configuration:', lanternConfig);
            
            log(`LanternEffect: Creating ${lanternConfig.lanterns.length} lantern systems`);
            
            // Config position is image UV (0-1). World position = (u - 0.5) * meshSize + mesh.position,
            // so effects move with the mesh when focal point or viewport changes (no extra offset).
            const currentTransform = this.parallax.meshTransform;
            const currentMeshWidth = currentTransform.baseGeometrySize.width * currentTransform.scale;
            const currentMeshHeight = currentTransform.baseGeometrySize.height * currentTransform.scale;
            
            // Create lantern systems (each manages multiple particles)
            this.lanternSystems = [];
            lanternConfig.lanterns.forEach((lanternData, index) => {
                try {
                    // Merge with defaults
                    const config = { ...lanternConfig.defaults, ...lanternData };
                    
                    // Config coordinates are image UV (0-1); same space as focal point
                    const configPos = new THREE.Vector3(
                        config.position.x ?? 0.5,
                        config.position.y ?? 0.5,
                        config.position.z ?? 0.5
                    );
                    
                    const worldX = (configPos.x - 0.5) * currentMeshWidth + currentTransform.position.x;
                    const worldY = (configPos.y - 0.5) * currentMeshHeight + currentTransform.position.y;
                    const worldPos = new THREE.Vector3(worldX, worldY, configPos.z);
                    
                    // Reduced logging for performance
                    if (index === 0) log(`LanternEffect: Sample lantern system transform - config:`, configPos, '-> world:', worldPos);
                    
                    // Create lantern system
                    const lanternSystem = {
                        name: config.name,
                        index: index,
                        originPosition: worldPos.clone(), // Current working position (changes with mesh/focal)
                        basePosition: configPos.clone(),    // Image UV (0-1); used to recompute world when mesh transform changes
                        config: config,
                        particles: [], // Array of active particles
                        nextParticleTime: 0, // When to spawn next particle
                        movementFactor: config.movementFactor !== undefined ? config.movementFactor : 1.0
                    };
                    
                    this.lanternSystems.push(lanternSystem);
                    log(`LanternEffect: Created lantern system ${index} (${config.name}) at world position:`, worldPos);
                    
                } catch (error) {
                    console.error(`LanternEffect: Error creating lantern system ${index}:`, error);
                }
            });
            
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
                // Clean up GSAP animation if it exists
                if (particle.gsapAnimation) {
                    particle.gsapAnimation.kill();
                    particle.gsapAnimation = null;
                }
                
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
    
    spawnParticle(system) {
        try {
            // Get blend mode from config
            const blendMode = this.getBlendMode(system.config.blendMode || 'AdditiveBlending');
            const depthWrite = system.config.depthWrite !== undefined ? system.config.depthWrite : false;
            const alphaTest = system.config.alphaTest || 0.01;
            
            // Create particle mesh with configurable blend mode
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
                    depthWrite: depthWrite
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
                gsapAnimation: null, // Store GSAP animation reference
                useGSAP: gsap !== null && (system.config.useGSAP !== false), // Allow disabling GSAP per system
                colorObj: new THREE.Color(system.config.color || 0xffaa44),
                glowColor: new THREE.Color(system.config.color || 0xffaa44)
            };
            
            // Store reference to system for parallax movement
            particle.userData = {
                system: system,
                particleData: particleData
            };
            
            system.particles.push(particleData);
            
            // Initialize GSAP animation if available
            if (particleData.useGSAP && gsap) {
                this.initGSAPAnimation(particleData, system);
            }
            
        } catch (error) {
            console.error('LanternEffect: Error spawning particle:', error);
        }
    }
    
    initGSAPAnimation(particle, system) {
        const mesh = particle.mesh;
        const material = mesh.material;
        
        // Create GSAP timeline for smooth, professional animations
        const timeline = gsap.timeline({
            onComplete: () => {
                // Particle will be cleaned up by the regular update loop
                particle.gsapAnimation = null;
            }
        });
        
        // Scale animation with professional easing
        timeline.fromTo(mesh.scale, 
            { x: 0, y: 0, z: 1 }, // From
            { 
                x: particle.growthSpeed * particle.lifetime * particle.baseScale,
                y: particle.growthSpeed * particle.lifetime * particle.baseScale,
                z: 1,
                duration: particle.lifetime,
                ease: "power2.out"
            }
        );
        
        // Opacity animation with precise timing
        timeline.fromTo(material, 
            { opacity: 0 }, // From
            { 
                opacity: particle.maxOpacity,
                duration: particle.lifetime * 0.2, // Fade in first 20%
                ease: "power1.out"
            }, 0 // Start immediately
        )
        .to(material, {
            opacity: 0,
            duration: particle.lifetime * 0.3, // Fade out last 30%
            ease: "power2.in"
        }, particle.lifetime * 0.7); // Start at 70% of lifetime
        
        // Optional: Subtle rotation animation
        if (system.config.enableRotation !== false) {
            timeline.to(mesh.rotation, {
                z: particle.initialRotation + Math.PI * 0.5, // Quarter turn
                duration: particle.lifetime,
                ease: "none" // Linear rotation
            }, 0);
        }
        
        // Store reference for cleanup
        particle.gsapAnimation = timeline;
    }
    
    updateParticle(particle, system) {
        try {
            const mesh = particle.mesh;
            const lifeProgress = particle.age / particle.lifetime;
            
            // If using GSAP, only handle position updates (GSAP handles scale/opacity)
            if (particle.useGSAP && particle.gsapAnimation) {
                // GSAP is handling scale and opacity animations
                // We only need to update position for parallax movement
            } else {
                // Manual animation fallback
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
            }
            
            // Color tinting for glow effect (only for manual animation to avoid conflicts with GSAP)
            if (!(particle.useGSAP && particle.gsapAnimation)) {
                const currentOpacity = mesh.material.opacity;
                const normalizedOpacity = currentOpacity / particle.maxOpacity;
                const glowIntensity = 0.5 + normalizedOpacity * 0.5;
                particle.glowColor.copy(particle.colorObj).multiplyScalar(glowIntensity);
                mesh.material.color.copy(particle.glowColor);
            } else {
                // For GSAP, use simple color without opacity-based intensity changes
                mesh.material.color.copy(particle.colorObj);
            }
            
            // Apply parallax movement - sync with main mesh movement
            let parallaxOffsetX = 0;
            let parallaxOffsetY = 0;
            
            // Only apply movement if movementFactor > 0
            if (system.movementFactor > 0 && this.parallax && this.parallax.targetX !== undefined && this.parallax.targetY !== undefined) {
                // Apply a depth-based parallax effect - closer objects (higher Z) move more
                const parallaxDepthFactor = system.originPosition.z * 0.5; // Depth-based scaling
                parallaxOffsetX = this.parallax.targetX * parallaxDepthFactor * system.movementFactor;
                parallaxOffsetY = this.parallax.targetY * parallaxDepthFactor * system.movementFactor;
                
                // Debug logging for movement (only occasionally to avoid spam)
                if (Math.random() < 0.001) { // Log 0.1% of the time
                    log(`Movement debug - Factor: ${system.movementFactor}, TargetX: ${this.parallax.targetX.toFixed(3)}, OffsetX: ${parallaxOffsetX.toFixed(3)}`);
                }
            }
            
            mesh.position.x = system.originPosition.x + parallaxOffsetX;
            mesh.position.y = system.originPosition.y + parallaxOffsetY;
            mesh.position.z = system.originPosition.z;
                
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
    
    // GSAP-compatible easing functions for smooth animations
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
    
    // Advanced easing functions (can be replaced with GSAP when integrated)
    easeInOutQuart(t) {
        return t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2;
    }
    
    easeOutBack(t) {
        const c1 = 1.70158;
        const c3 = c1 + 1;
        return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    }
    
    // Update lantern positions when mesh transform changes (e.g., window resize or focal point)
    updatePositionsForMeshTransform(meshTransform) {
        if (!this.isInitialized || !this.lanternSystems || this.lanternSystems.length === 0) {
            log('LanternEffect: Not ready for position updates');
            return;
        }
        
        log('LanternEffect: Updating positions for mesh transform:', meshTransform);
        
        const currentMeshWidth = meshTransform.baseGeometrySize.width * meshTransform.scale;
        const currentMeshHeight = meshTransform.baseGeometrySize.height * meshTransform.scale;
        
        this.lanternSystems.forEach((system, index) => {
            if (!system || !system.basePosition) {
                console.warn(`LanternEffect: Lantern system ${index} missing required data for position update`);
                return;
            }
            
            // basePosition is image UV (0-1); same formula as mesh so effects move with focal point
            const basePos = system.basePosition;
            const finalX = (basePos.x - 0.5) * currentMeshWidth + meshTransform.position.x;
            const finalY = (basePos.y - 0.5) * currentMeshHeight + meshTransform.position.y;
            const finalZ = basePos.z;
            
            system.originPosition.set(finalX, finalY, finalZ);
            
            if (index === 0) log(`LanternEffect: Sample position update - UV: (${basePos.x.toFixed(3)}, ${basePos.y.toFixed(3)}) -> final: (${finalX.toFixed(3)}, ${finalY.toFixed(3)}, ${finalZ.toFixed(3)})`);
        });
        
        log('LanternEffect: Position update complete for all lantern systems');
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
                movementFactor: 1.0
            },
            lanterns: [
                { name: 'fallback_lantern_1', position: { x: -0.5, y: 0.0, z: 0.5 } },
                { name: 'fallback_lantern_2', position: { x: 0.5, y: 0.0, z: 0.5 } }
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
    
    // Method to enable/disable all lantern systems
    setEnabled(enabled) {
        this.lanternSystems.forEach(system => {
            system.particles.forEach(particle => {
                particle.mesh.visible = enabled;
            });
        });
    }
    
    // Clean up all particles and systems
    cleanup() {
        if (this.lanternSystems) {
            this.lanternSystems.forEach(system => {
                system.particles.forEach(particle => {
                    // Clean up GSAP animations
                    if (particle.gsapAnimation) {
                        particle.gsapAnimation.kill();
                        particle.gsapAnimation = null;
                    }
                    
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
        
        // Call parent cleanup
        super.cleanup();
    }
}

export default LanternEffect;