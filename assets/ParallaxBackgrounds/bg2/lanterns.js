// Lantern Effect - Flickering lanterns for bg2 magical scene
// Uses flare_1.png for lantern glow effect

import BaseEffect from '../../../js/base-effect.js';
import * as THREE from '../../../node_modules/three/build/three.module.js';

class LanternEffect extends BaseEffect {
    async init() {
        console.log('LanternEffect: Initializing lantern effect');
        
        try {
            // IMPORTANT: Get cached canonical mesh transform for performance
            this.initialMeshTransform = this.parallax.getCanonicalTransform();
            
            // Fallback: calculate if not cached yet
            if (!this.initialMeshTransform) {
                this.initialMeshTransform = this.calculateCanonicalMeshTransform();
                console.log('LanternEffect: Fallback - calculated canonical mesh transform:', this.initialMeshTransform);
            } else {
                console.log('LanternEffect: Using cached canonical mesh transform:', this.initialMeshTransform);
            }
            
            // Load the flare texture for lanterns
            const flareTexture = await this.loadTexture('./assets/ParallaxBackgrounds/bg2/assets/flare_1.png');
            console.log('LanternEffect: Successfully loaded flare texture');
            
            // Load lantern configuration from parallax config
            const lanternConfig = await this.loadLanternConfig();
            console.log('LanternEffect: Loaded lantern configuration:', lanternConfig);
            
            console.log(`LanternEffect: Creating ${lanternConfig.lanterns.length} lanterns`);
            
            // Pre-calculate shared transformation values for performance
            const currentTransform = this.parallax.meshTransform;
            const refMeshWidth = this.initialMeshTransform.baseGeometrySize.width * this.initialMeshTransform.scale;
            const refMeshHeight = this.initialMeshTransform.baseGeometrySize.height * this.initialMeshTransform.scale;
            const currentMeshWidth = currentTransform.baseGeometrySize.width * currentTransform.scale;
            const currentMeshHeight = currentTransform.baseGeometrySize.height * currentTransform.scale;
            
            // Create lantern meshes
            this.lanterns = [];
            lanternConfig.lanterns.forEach((lanternData, index) => {
                try {
                    // Merge with defaults
                    const config = { ...lanternConfig.defaults, ...lanternData };
                    
                    // Config coordinates are in reference viewport space - transform to current viewport
                    const configPos = new THREE.Vector3(
                        config.position.x || 0,
                        config.position.y || 0,
                        config.position.z || 0.5
                    );
                    
                    // Optimized coordinate transformation using pre-calculated values
                    const relativeX = (configPos.x - this.initialMeshTransform.position.x) / refMeshWidth + 0.5;
                    const relativeY = (configPos.y - this.initialMeshTransform.position.y) / refMeshHeight + 0.5;
                    const worldX = (relativeX - 0.5) * currentMeshWidth + currentTransform.position.x;
                    const worldY = (relativeY - 0.5) * currentMeshHeight + currentTransform.position.y;
                    const worldPos = new THREE.Vector3(worldX, worldY, configPos.z);
                    // Reduced logging for performance
                    if (index === 0) console.log(`LanternEffect: Sample lantern transform - config:`, configPos, '-> world:', worldPos);
                    
                    // Create lantern mesh
                    const lantern = this.createPlaneMesh(
                        0.1, // Base size - will be scaled by config
                        0.1, 
                        flareTexture, 
                        worldPos,
                        {
                            transparent: true,
                            alphaTest: 0.1,
                            blending: THREE.AdditiveBlending,
                            side: THREE.DoubleSide
                        }
                    );
                    
                    // Store lantern data for animation (including all config parameters)
                    lantern.userData = {
                        name: config.name,
                        index: index,
                        originalPosition: worldPos.clone(), // Current working position (changes with mesh scaling)
                        basePosition: configPos.clone(),    // True original position in reference viewport space (never changes)
                        scale: config.scale,
                        opacity: config.opacity,
                        color: config.color,
                        flickerSpeed: config.flickerSpeed,
                        flickerPhase: config.flickerPhase || Math.random() * Math.PI * 2,
                        glowIntensity: config.glowIntensity,
                        rotationSpeed: config.rotationSpeed,
                        swayIntensity: config.swayIntensity,
                        movementFactor: config.movementFactor
                    };
                    
                    this.lanterns.push(lantern);
                    console.log(`LanternEffect: Created lantern ${index} (${config.name}) at world position:`, worldPos);
                    console.log(`LanternEffect: Lantern ${index} scale:`, lantern.scale);
                    console.log(`LanternEffect: Lantern ${index} visible:`, lantern.visible);
                    
                } catch (error) {
                    console.error(`LanternEffect: Error creating lantern ${index}:`, error);
                }
            });
            
            // Initialize animation properties
            this.time = 0;
            this.isInitialized = true;
            
            console.log(`LanternEffect: Successfully initialized with ${this.lanterns.length} lanterns`);
            
        } catch (error) {
            console.error('LanternEffect: Error during initialization:', error);
            throw error;
        }
    }
    
    update() {
        if (!this.isInitialized) {
            return;
        }
        
        // Initialize time if undefined
        if (this.time === undefined) {
            this.time = 0;
            console.log('LanternEffect: Initialized time in update method');
        }
        
        // Update animation time
        this.time += 0.016; // Assuming ~60fps
        
        // Animate each lantern
        this.lanterns.forEach((lantern, index) => {
            try {
                // Basic safety check
                if (!lantern || !lantern.userData) {
                    console.warn(`LanternEffect: Lantern ${index} is missing required properties`);
                    return;
                }
                
                const userData = lantern.userData;
                
                // Calculate rotating flicker effect to match the actual flare animation
                const flicker = Math.sin(this.time * userData.flickerSpeed + userData.flickerPhase) * 0.4 + 0.6;
                const rotationSpeed = userData.rotationSpeed || 1.0;
                
                // Rotate the lantern for the spinning cross effect
                lantern.rotation.z = this.time * rotationSpeed + userData.flickerPhase;
                
                // Update opacity for flickering
                lantern.material.opacity = flicker * userData.glowIntensity * userData.opacity;
                
                // For MeshBasicMaterial, we'll use color tinting for the glow effect
                const baseColor = new THREE.Color(userData.color || 0xffaa44);
                const glowIntensity = 0.3 + flicker * 0.7; // More dynamic glow range
                baseColor.multiplyScalar(glowIntensity);
                lantern.material.color = baseColor;
                
                // Scale pulsing synchronized with flicker
                const sizePulse = userData.scale * (0.8 + flicker * 0.4); // Scale varies with flicker
                lantern.scale.set(sizePulse, sizePulse, 1);
                
                // Subtle position swaying (like wind)
                const swayX = Math.sin(this.time * 0.3 + userData.flickerPhase) * userData.swayIntensity;
                const swayY = Math.cos(this.time * 0.4 + userData.flickerPhase) * userData.swayIntensity * 0.5;
                
                // Apply parallax movement - sync with main mesh movement
                // The main mesh moves based on this.parallax.targetX and this.parallax.targetY
                let parallaxOffsetX = 0;
                let parallaxOffsetY = 0;
                
                if (this.parallax && this.parallax.targetX !== undefined && this.parallax.targetY !== undefined) {
                    // Apply a depth-based parallax effect - closer objects (higher Z) move more
                    const parallaxDepthFactor = userData.originalPosition.z * 0.5; // Depth-based scaling
                    const movementFactor = userData.movementFactor || 1.0; // User-controllable movement scaling
                    parallaxOffsetX = this.parallax.targetX * parallaxDepthFactor * movementFactor;
                    parallaxOffsetY = this.parallax.targetY * parallaxDepthFactor * movementFactor;
                }
                
                lantern.position.x = userData.originalPosition.x + swayX + parallaxOffsetX;
                lantern.position.y = userData.originalPosition.y + swayY + parallaxOffsetY;
                
            } catch (error) {
                console.error(`LanternEffect: Error updating lantern ${index}:`, error);
            }
        });
    }
    
    // Update lantern positions when mesh transform changes (e.g., on window resize)
    updatePositionsForMeshTransform(meshTransform) {
        if (!this.isInitialized || !this.lanterns || this.lanterns.length === 0) {
            console.log('LanternEffect: Not ready for position updates');
            return;
        }
        
        console.log('LanternEffect: Updating positions for mesh transform:', meshTransform);
        
        // Get the initial mesh configuration for relative positioning
        if (!this.initialMeshTransform) {
            console.warn('LanternEffect: No initial mesh transform stored, cannot update positions');
            return;
        }
        
        this.lanterns.forEach((lantern, index) => {
            if (!lantern || !lantern.userData || !lantern.userData.basePosition) {
                console.warn(`LanternEffect: Lantern ${index} missing required data for position update`);
                return;
            }
            
            const userData = lantern.userData;
            const basePos = userData.basePosition; // Original position in reference viewport space
            
            // CORRECTED APPROACH: Transform from reference viewport to current viewport
            // Use the same transformation logic as initial creation
            
            // 1. Convert reference position to relative coordinates within reference mesh
            const refMeshWidth = this.initialMeshTransform.baseGeometrySize.width * this.initialMeshTransform.scale;
            const refMeshHeight = this.initialMeshTransform.baseGeometrySize.height * this.initialMeshTransform.scale;
            
            const relativeX = (basePos.x - this.initialMeshTransform.position.x) / refMeshWidth + 0.5;
            const relativeY = (basePos.y - this.initialMeshTransform.position.y) / refMeshHeight + 0.5;
            
            // 2. Apply relative position to current mesh dimensions
            const currentMeshWidth = meshTransform.baseGeometrySize.width * meshTransform.scale;
            const currentMeshHeight = meshTransform.baseGeometrySize.height * meshTransform.scale;
            
            const finalX = (relativeX - 0.5) * currentMeshWidth + meshTransform.position.x;
            const finalY = (relativeY - 0.5) * currentMeshHeight + meshTransform.position.y;
            const finalZ = basePos.z; // Z position stays the same
            
            // Update the userData.originalPosition to reflect the new working position
            userData.originalPosition.set(finalX, finalY, finalZ);
            
            // Update the lantern's actual position
            lantern.position.set(finalX, finalY, finalZ);
            
            // Reduced logging for performance
            if (index === 0) console.log(`LanternEffect: Sample position update - relative: (${relativeX.toFixed(3)}, ${relativeY.toFixed(3)}) -> final: (${finalX.toFixed(3)}, ${finalY.toFixed(3)}, ${finalZ.toFixed(3)})`);
        });
        
        console.log('LanternEffect: Position update complete for all lanterns');
    }
    
    // Calculate what the mesh transform would be at a canonical/reference viewport size
    calculateCanonicalMeshTransform() {
        // Get reference viewport size from config
        const referenceViewport = this.parallax.config.settings.referenceViewport || { width: 1920, height: 1080 };
        const REFERENCE_WIDTH = referenceViewport.width;
        const REFERENCE_HEIGHT = referenceViewport.height;
        
        console.log(`LanternEffect: Calculating canonical transform for reference viewport: ${REFERENCE_WIDTH}x${REFERENCE_HEIGHT}`);
        
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
        
        console.log('LanternEffect: Canonical transform calculated:', canonicalTransform);
        return canonicalTransform;
    }
    
    // Transform coordinates from reference viewport space to current viewport space
    transformFromReferenceToCurrentViewport(referencePos) {
        // Get current mesh transform
        const currentTransform = {
            scale: this.parallax.meshTransform.scale,
            position: { ...this.parallax.meshTransform.position },
            baseGeometrySize: { ...this.parallax.meshTransform.baseGeometrySize }
        };
        
        // 1. Convert reference position to relative coordinates within reference mesh
        const refMeshWidth = this.initialMeshTransform.baseGeometrySize.width * this.initialMeshTransform.scale;
        const refMeshHeight = this.initialMeshTransform.baseGeometrySize.height * this.initialMeshTransform.scale;
        
        const relativeX = (referencePos.x - this.initialMeshTransform.position.x) / refMeshWidth + 0.5;
        const relativeY = (referencePos.y - this.initialMeshTransform.position.y) / refMeshHeight + 0.5;
        
        // 2. Apply relative position to current mesh dimensions
        const currentMeshWidth = currentTransform.baseGeometrySize.width * currentTransform.scale;
        const currentMeshHeight = currentTransform.baseGeometrySize.height * currentTransform.scale;
        
        const currentX = (relativeX - 0.5) * currentMeshWidth + currentTransform.position.x;
        const currentY = (relativeY - 0.5) * currentMeshHeight + currentTransform.position.y;
        const currentZ = referencePos.z; // Z stays the same
        
        // Reduced logging for performance - only log if detailed debugging needed
        // console.log(`LanternEffect: Transform ref(${referencePos.x.toFixed(3)}, ${referencePos.y.toFixed(3)}, ${referencePos.z.toFixed(3)}) ` +
        //            `-> rel(${relativeX.toFixed(3)}, ${relativeY.toFixed(3)}) ` +
        //            `-> current(${currentX.toFixed(3)}, ${currentY.toFixed(3)}, ${currentZ.toFixed(3)})`);
        
        return new THREE.Vector3(currentX, currentY, currentZ);
    }
    
    // Load lantern configuration from the parallax config JSON
    async loadLanternConfig() {
        console.log('LanternEffect: Loading lantern configuration from parallax config');
        
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
            
            console.log('LanternEffect: Successfully loaded lantern config from JSON');
            return lanternConfig;
            
        } catch (error) {
            console.error('LanternEffect: Error loading lantern config:', error);
            return this.getFallbackConfig();
        }
    }
    
    // Fallback configuration if JSON config fails
    getFallbackConfig() {
        console.log('LanternEffect: Using fallback lantern configuration');
        
        return {
            defaults: {
                scale: 1.0,
                opacity: 0.8,
                color: 0xffaa44,
                flickerSpeed: 1.0,
                glowIntensity: 0.9,
                rotationSpeed: 0.5,
                swayIntensity: 0.01,
                movementFactor: 1.0
            },
            lanterns: [
                { name: 'fallback_lantern_1', position: { x: -0.5, y: 0.0, z: 0.5 } },
                { name: 'fallback_lantern_2', position: { x: 0.5, y: 0.0, z: 0.5 } }
            ]
        };
    }
    
    // Method to get lantern by name
    getLantern(name) {
        return this.lanterns.find(lantern => lantern.userData.name === name);
    }
    
    // Method to set all lanterns intensity
    setGlobalIntensity(intensity) {
        this.lanterns.forEach(lantern => {
            lantern.userData.glowIntensity = intensity;
        });
    }
    
    // Method to enable/disable all lanterns
    setEnabled(enabled) {
        this.lanterns.forEach(lantern => {
            lantern.visible = enabled;
        });
    }
}

export default LanternEffect;
