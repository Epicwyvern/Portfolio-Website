// Base Effect Class - Common interface for all effects
// Provides UV-to-world coordinate conversion and resource management

import * as THREE from 'https://unpkg.com/three@0.172.0/build/three.module.js';

const log = (...args) => {
    if (window.location.pathname.endsWith('test-effects.html')) {
        console.log(...args);
    }
};

class BaseEffect {
    constructor(scene, camera, renderer, parallaxInstance) {
        log('BaseEffect: Initializing base effect');
        
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;
        this.parallax = parallaxInstance;
        
        this.meshes = []; // Store all meshes created by this effect
        this.materials = []; // Store materials for cleanup
        this.textures = []; // Store textures for cleanup
        this.isInitialized = false;
        
        /** @type {'point'|'area'} Effect type: 'point' for localized effects (e.g. lanterns), 'area' for mask-based overlays (e.g. water ripple). Default 'point'. */
        this.effectType = 'point';
        
        log('BaseEffect: Base effect initialized');
    }
    
    // Abstract method to be implemented by specific effects
    async init() {
        log('BaseEffect: init() called - must be implemented by effect class');
        throw new Error('init() must be implemented by effect class');
    }
    
    // Default update method - can be overridden
    update() {
        // Default implementation - can be overridden by specific effects
    }
    
    cleanup() {
        log(`BaseEffect: Cleaning up ${this.meshes.length} meshes, ${this.materials.length} materials, ${this.textures.length} textures`);
        
        // Clean up all meshes
        this.meshes.forEach((mesh, index) => {
            try {
                this.scene.remove(mesh);
                if (mesh.geometry) {
                    mesh.geometry.dispose();
                }
                log(`BaseEffect: Cleaned up mesh ${index}`);
            } catch (error) {
                console.error(`BaseEffect: Error cleaning up mesh ${index}:`, error);
            }
        });
        
        // Clean up all materials
        this.materials.forEach((material, index) => {
            try {
                material.dispose();
                log(`BaseEffect: Cleaned up material ${index}`);
            } catch (error) {
                console.error(`BaseEffect: Error cleaning up material ${index}:`, error);
            }
        });
        
        // Clean up all textures
        this.textures.forEach((texture, index) => {
            try {
                texture.dispose();
                log(`BaseEffect: Cleaned up texture ${index}`);
            } catch (error) {
                console.error(`BaseEffect: Error cleaning up texture ${index}:`, error);
            }
        });
        
        // Clear arrays
        this.meshes = [];
        this.materials = [];
        this.textures = [];
        this.isInitialized = false;
        
        log('BaseEffect: Cleanup complete');
    }
    
    // Helper method to create plane meshes
    createPlaneMesh(width, height, texture, position = {x: 0, y: 0, z: 0}, options = {}) {
        log(`BaseEffect: Creating plane mesh at position (${position.x}, ${position.y}, ${position.z})`);
        
        const geometry = new THREE.PlaneGeometry(width, height);
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            alphaTest: 0.1,
            ...options
        });
        
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(position.x, position.y, position.z);
        
        // Store references for cleanup
        this.meshes.push(mesh);
        this.materials.push(material);
        this.textures.push(texture);
        
        this.scene.add(mesh);
        
        log(`BaseEffect: Plane mesh created and added to scene`);
        return mesh;
    }
    
    // Helper method to load textures
    async loadTexture(texturePath) {
        log(`BaseEffect: Loading texture from ${texturePath}`);
        
        return new Promise((resolve, reject) => {
            const textureLoader = new THREE.TextureLoader();
            textureLoader.load(
                texturePath,
                (texture) => {
                    log(`BaseEffect: Successfully loaded texture: ${texturePath}`);
                    resolve(texture);
                },
                undefined,
                (error) => {
                    console.error(`BaseEffect: Failed to load texture ${texturePath}:`, error);
                    reject(error);
                }
            );
        });
    }
    
    // CORRECTED UV-to-World coordinate conversion
    uvToWorldPosition(u, v, zDepth = 0) {
        log(`BaseEffect: Converting UV (${u}, ${v}) to world position at z=${zDepth}`);
        
        if (!this.parallax || !this.parallax.depthData || !this.parallax.mesh) {
            console.error('BaseEffect: Parallax instance or mesh not available for UV conversion');
            return new THREE.Vector3(0, 0, zDepth);
        }
        
        try {
            // Get the same values used in createMesh()
            const containerAspect = window.innerWidth / window.innerHeight;
            const imageAspect = this.parallax.depthData.width / this.parallax.depthData.height;
            const visibleHeight = 2 * Math.tan(THREE.MathUtils.degToRad(45/2)) * this.camera.position.z;
            const visibleWidth = visibleHeight * this.camera.aspect;
            
            log(`BaseEffect: Container aspect: ${containerAspect}, Image aspect: ${imageAspect}`);
            log(`BaseEffect: Visible dimensions: ${visibleWidth} x ${visibleHeight}`);
            
            // Calculate the same baseScale as the main mesh
            let baseScale;
            if (containerAspect > imageAspect) {
                baseScale = visibleWidth / this.parallax.mesh.geometry.parameters.width;
            } else {
                baseScale = visibleHeight / this.parallax.mesh.geometry.parameters.height;
            }
            
            const finalScale = baseScale * this.parallax.extraScale;
            log(`BaseEffect: Base scale: ${baseScale}, Final scale: ${finalScale}`);
            
            // Calculate scaled mesh dimensions (same as main mesh)
            const scaledMeshWidth = this.parallax.mesh.geometry.parameters.width * finalScale;
            const scaledMeshHeight = this.parallax.mesh.geometry.parameters.height * finalScale;
            
            // Calculate overflow (same as main mesh)
            const overflowX = scaledMeshWidth - visibleWidth;
            const overflowY = scaledMeshHeight - visibleHeight;
            
            // Calculate mesh offset (same as main mesh)
            const meshOffsetX = (0.5 - this.parallax.focalPoint.x) * overflowX;
            const meshOffsetY = (0.5 - this.parallax.focalPoint.y) * overflowY;
            
            log(`BaseEffect: Scaled mesh dimensions: ${scaledMeshWidth} x ${scaledMeshHeight}`);
            log(`BaseEffect: Mesh offset: (${meshOffsetX}, ${meshOffsetY})`);
            
            // Convert UV to world coordinates
            // UV (0,0) = bottom-left of image, UV (1,1) = top-right of image
            const imageX = (u - 0.5) * scaledMeshWidth; // -scaledMeshWidth/2 to +scaledMeshWidth/2
            const imageY = (v - 0.5) * scaledMeshHeight; // -scaledMeshHeight/2 to +scaledMeshHeight/2
            
            // Add mesh offset to get final world position
            const worldX = imageX + meshOffsetX;
            const worldY = imageY + meshOffsetY;
            
            const worldPos = new THREE.Vector3(worldX, worldY, zDepth);
            log(`BaseEffect: UV (${u}, ${v}) -> World (${worldX}, ${worldY}, ${zDepth})`);
            
            return worldPos;
            
        } catch (error) {
            console.error('BaseEffect: Error in UV-to-world conversion:', error);
            return new THREE.Vector3(0, 0, zDepth);
        }
    }
    
    /**
     * Creates a coarse overlay mesh for area effects using parallax.getCoarseEffectGeometry().
     * Uses fewer segments than the main mesh for performance while staying aligned with the background.
     * All area effects (water ripple, fog, etc.) can use this for consistent, performant overlays.
     * @param {string} fragmentShader - GLSL fragment shader source for the effect
     * @param {Object} effectUniforms - Effect-specific uniforms (will be merged with displacement uniforms)
     * @param {Object} [options={}] - ShaderMaterial options + overlaySegments (default 256)
     * @returns {THREE.Mesh} The created mesh; sync with parallax via syncWithParallaxMesh(mesh)
     */
    createCoarseAreaEffectMesh(fragmentShader, effectUniforms, options = {}) {
        log('BaseEffect: Creating coarse area effect overlay mesh');
        const overlaySegments = options.overlaySegments ?? 256;
        const geometry = this.parallax.getCoarseEffectGeometry(overlaySegments, overlaySegments);
        if (!geometry) {
            throw new Error('BaseEffect: Could not get coarse effect geometry (parallax.depthData may not be ready)');
        }
        const displacementUniforms = this.parallax.getDisplacementUniforms();
        if (!displacementUniforms) {
            throw new Error('BaseEffect: Could not get displacement uniforms');
        }
        const vertexShader = this.parallax.getDisplacementVertexShader();
        const uniforms = { ...displacementUniforms, ...effectUniforms };
        const { overlaySegments: _, ...meshOptions } = options;
        return this.createAreaEffectMesh(geometry, vertexShader, fragmentShader, uniforms, meshOptions);
    }

    /**
     * Creates an overlay mesh for area effects that must stay aligned with the parallax background.
     * Uses the provided geometry, vertex shader, and uniforms. For coarse overlays, prefer createCoarseAreaEffectMesh().
     * @param {THREE.BufferGeometry} geometry - Geometry (e.g. from parallax.getEffectGeometryClone() or getCoarseEffectGeometry())
     * @param {string} vertexShader - GLSL vertex shader source (use parallax.getDisplacementVertexShader() for alignment)
     * @param {string} fragmentShader - GLSL fragment shader source
     * @param {Object} uniforms - Uniforms object (must include displacement uniforms for alignment)
     * @param {Object} [options={}] - ShaderMaterial options
     * @returns {THREE.Mesh} The created mesh
     */
    createAreaEffectMesh(geometry, vertexShader, fragmentShader, uniforms, options = {}) {
        log('BaseEffect: Creating area effect overlay mesh');
        
        const material = new THREE.ShaderMaterial({
            vertexShader,
            fragmentShader,
            uniforms,
            transparent: options.transparent !== false,
            depthTest: options.depthTest !== false,
            depthWrite: options.depthWrite === true,
            side: options.side !== undefined ? options.side : THREE.DoubleSide,
            ...options
        });
        
        const mesh = new THREE.Mesh(geometry, material);
        
        this.meshes.push(mesh);
        this.materials.push(material);
        this.scene.add(mesh);
        
        log('BaseEffect: Area effect mesh created and added to scene');
        return mesh;
    }
    
    /**
     * Applies the current parallax mesh transform (position, scale) to the given mesh.
     * Call this from update() or from updatePositionsForMeshTransform(meshTransform) so the overlay stays aligned with the background.
     * @param {THREE.Mesh} mesh - The area effect overlay mesh to sync
     */
    syncWithParallaxMesh(mesh) {
        if (!mesh || !this.parallax || !this.parallax.meshTransform) return;
        const t = this.parallax.meshTransform;
        mesh.position.set(t.position.x, t.position.y, t.position.z);
        const s = t.scale;
        mesh.scale.set(s, s, 1);
    }
    
    // Helper method to create sprite meshes for particles
    createSpriteMesh(texture, position = {x: 0, y: 0, z: 0}, scale = 1) {
        log(`BaseEffect: Creating sprite mesh at position (${position.x}, ${position.y}, ${position.z})`);
        
        const spriteMaterial = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            alphaTest: 0.1
        });
        
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.position.set(position.x, position.y, position.z);
        sprite.scale.set(scale, scale, 1);
        
        // Store references for cleanup
        this.meshes.push(sprite);
        this.materials.push(spriteMaterial);
        this.textures.push(texture);
        
        this.scene.add(sprite);
        
        log(`BaseEffect: Sprite mesh created and added to scene`);
        return sprite;
    }
}

export default BaseEffect;
