// Base Effect Class - Common interface for all effects
// Provides UV-to-world coordinate conversion and resource management

import * as THREE from 'https://unpkg.com/three@0.172.0/build/three.module.js';

class BaseEffect {
    constructor(scene, camera, renderer, parallaxInstance) {
        console.log('BaseEffect: Initializing base effect');
        
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;
        this.parallax = parallaxInstance;
        
        this.meshes = []; // Store all meshes created by this effect
        this.materials = []; // Store materials for cleanup
        this.textures = []; // Store textures for cleanup
        this.isInitialized = false;
        
        console.log('BaseEffect: Base effect initialized');
    }
    
    // Abstract method to be implemented by specific effects
    async init() {
        console.log('BaseEffect: init() called - must be implemented by effect class');
        throw new Error('init() must be implemented by effect class');
    }
    
    // Default update method - can be overridden
    update() {
        // Default implementation - can be overridden by specific effects
    }
    
    cleanup() {
        console.log(`BaseEffect: Cleaning up ${this.meshes.length} meshes, ${this.materials.length} materials, ${this.textures.length} textures`);
        
        // Clean up all meshes
        this.meshes.forEach((mesh, index) => {
            try {
                this.scene.remove(mesh);
                if (mesh.geometry) {
                    mesh.geometry.dispose();
                }
                console.log(`BaseEffect: Cleaned up mesh ${index}`);
            } catch (error) {
                console.error(`BaseEffect: Error cleaning up mesh ${index}:`, error);
            }
        });
        
        // Clean up all materials
        this.materials.forEach((material, index) => {
            try {
                material.dispose();
                console.log(`BaseEffect: Cleaned up material ${index}`);
            } catch (error) {
                console.error(`BaseEffect: Error cleaning up material ${index}:`, error);
            }
        });
        
        // Clean up all textures
        this.textures.forEach((texture, index) => {
            try {
                texture.dispose();
                console.log(`BaseEffect: Cleaned up texture ${index}`);
            } catch (error) {
                console.error(`BaseEffect: Error cleaning up texture ${index}:`, error);
            }
        });
        
        // Clear arrays
        this.meshes = [];
        this.materials = [];
        this.textures = [];
        this.isInitialized = false;
        
        console.log('BaseEffect: Cleanup complete');
    }
    
    // Helper method to create plane meshes
    createPlaneMesh(width, height, texture, position = {x: 0, y: 0, z: 0}, options = {}) {
        console.log(`BaseEffect: Creating plane mesh at position (${position.x}, ${position.y}, ${position.z})`);
        
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
        
        console.log(`BaseEffect: Plane mesh created and added to scene`);
        return mesh;
    }
    
    // Helper method to load textures
    async loadTexture(texturePath) {
        console.log(`BaseEffect: Loading texture from ${texturePath}`);
        
        return new Promise((resolve, reject) => {
            const textureLoader = new THREE.TextureLoader();
            textureLoader.load(
                texturePath,
                (texture) => {
                    console.log(`BaseEffect: Successfully loaded texture: ${texturePath}`);
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
        console.log(`BaseEffect: Converting UV (${u}, ${v}) to world position at z=${zDepth}`);
        
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
            
            console.log(`BaseEffect: Container aspect: ${containerAspect}, Image aspect: ${imageAspect}`);
            console.log(`BaseEffect: Visible dimensions: ${visibleWidth} x ${visibleHeight}`);
            
            // Calculate the same baseScale as the main mesh
            let baseScale;
            if (containerAspect > imageAspect) {
                baseScale = visibleWidth / this.parallax.mesh.geometry.parameters.width;
            } else {
                baseScale = visibleHeight / this.parallax.mesh.geometry.parameters.height;
            }
            
            const finalScale = baseScale * this.parallax.extraScale;
            console.log(`BaseEffect: Base scale: ${baseScale}, Final scale: ${finalScale}`);
            
            // Calculate scaled mesh dimensions (same as main mesh)
            const scaledMeshWidth = this.parallax.mesh.geometry.parameters.width * finalScale;
            const scaledMeshHeight = this.parallax.mesh.geometry.parameters.height * finalScale;
            
            // Calculate overflow (same as main mesh)
            const overflowX = scaledMeshWidth - visibleWidth;
            const overflowY = scaledMeshHeight - visibleHeight;
            
            // Calculate mesh offset (same as main mesh)
            const meshOffsetX = (0.5 - this.parallax.focalPoint.x) * overflowX;
            const meshOffsetY = (0.5 - this.parallax.focalPoint.y) * overflowY;
            
            console.log(`BaseEffect: Scaled mesh dimensions: ${scaledMeshWidth} x ${scaledMeshHeight}`);
            console.log(`BaseEffect: Mesh offset: (${meshOffsetX}, ${meshOffsetY})`);
            
            // Convert UV to world coordinates
            // UV (0,0) = bottom-left of image, UV (1,1) = top-right of image
            const imageX = (u - 0.5) * scaledMeshWidth; // -scaledMeshWidth/2 to +scaledMeshWidth/2
            const imageY = (v - 0.5) * scaledMeshHeight; // -scaledMeshHeight/2 to +scaledMeshHeight/2
            
            // Add mesh offset to get final world position
            const worldX = imageX + meshOffsetX;
            const worldY = imageY + meshOffsetY;
            
            const worldPos = new THREE.Vector3(worldX, worldY, zDepth);
            console.log(`BaseEffect: UV (${u}, ${v}) -> World (${worldX}, ${worldY}, ${zDepth})`);
            
            return worldPos;
            
        } catch (error) {
            console.error('BaseEffect: Error in UV-to-world conversion:', error);
            return new THREE.Vector3(0, 0, zDepth);
        }
    }
    
    // Helper method to create sprite meshes for particles
    createSpriteMesh(texture, position = {x: 0, y: 0, z: 0}, scale = 1) {
        console.log(`BaseEffect: Creating sprite mesh at position (${position.x}, ${position.y}, ${position.z})`);
        
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
        
        console.log(`BaseEffect: Sprite mesh created and added to scene`);
        return sprite;
    }
}

export default BaseEffect;
