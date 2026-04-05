// Base Effect Class - Common interface for all effects
// Provides UV-to-world coordinate conversion and resource management

import * as THREE from 'https://unpkg.com/three@0.172.0/build/three.module.js';

/**
 * Per-canvas subscription: ResizeObserver + one rAF per frame for all listeners.
 * Avoids window.resize ordering races with renderer.setSize (e.g. maximize/restore).
 * @type {WeakMap<HTMLCanvasElement, { listeners: Set<() => void>, rafId: number | null, observer: ResizeObserver }>}
 */
const rendererCanvasResizeRegistry = new WeakMap();

/**
 * Run `listener` after the WebGL canvas size changes (layout / backing store). Multiple effects on the same canvas share one observer.
 * Requires ResizeObserver (all supported browsers for this project).
 * @param {HTMLCanvasElement | null | undefined} canvas
 * @param {() => void} listener
 * @returns {() => void} Unsubscribe; disconnects the observer when the last listener is removed.
 */
function subscribeRendererCanvasResize(canvas, listener) {
    if (!canvas || typeof listener !== 'function') {
        return () => {};
    }
    let state = rendererCanvasResizeRegistry.get(canvas);
    if (!state) {
        state = {
            listeners: new Set(),
            rafId: null,
            observer: null
        };
        const flush = () => {
            state.rafId = null;
            for (const fn of state.listeners) {
                try {
                    fn();
                } catch (e) {
                    console.error('BaseEffect: canvas resize listener error', e);
                }
            }
        };
        const schedule = () => {
            if (state.rafId != null) return;
            state.rafId = requestAnimationFrame(flush);
        };
        state.observer = new ResizeObserver(schedule);
        state.observer.observe(canvas);
        rendererCanvasResizeRegistry.set(canvas, state);
    }
    state.listeners.add(listener);
    return () => {
        const st = rendererCanvasResizeRegistry.get(canvas);
        if (!st) return;
        st.listeners.delete(listener);
        if (st.listeners.size > 0) return;
        if (st.rafId != null) {
            cancelAnimationFrame(st.rafId);
            st.rafId = null;
        }
        st.observer.disconnect();
        rendererCanvasResizeRegistry.delete(canvas);
    };
}

const log = (...args) => {
    if (window.location.pathname.endsWith('test-effects.html')) {
        console.log(...args);
    }
};

/** Coarse area overlays (e.g. foliage, character tint) sit slightly toward the camera for stable depth tests; XY scale is corrected in syncWithParallaxMesh so framing matches the main parallax plane. */
export const PARALLAX_COARSE_OVERLAY_Z = 0.012;

// --- Area effects: optional `passUvBounds` + `passUvBoundsHighlight` (texture UV 0–1) ---

/**
 * @param {Record<string, unknown>} config Effect config (e.g. `parallax.config.effects.waterRipple`).
 * @returns {{ minX: number, minY: number, maxX: number, maxY: number }}
 */
export function resolvePassUvBounds(config) {
    const b = config.passUvBounds && typeof config.passUvBounds === 'object' ? config.passUvBounds : null;
    if (!b) {
        return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
    }
    let minX = Number(b.minX ?? 0);
    let minY = Number(b.minY ?? 0);
    let maxX = Number(b.maxX ?? 1);
    let maxY = Number(b.maxY ?? 1);
    minX = Math.max(0, Math.min(1, minX));
    minY = Math.max(0, Math.min(1, minY));
    maxX = Math.max(0, Math.min(1, maxX));
    maxY = Math.max(0, Math.min(1, maxY));
    if (maxX <= minX) maxX = Math.min(1, minX + 0.001);
    if (maxY <= minY) maxY = Math.min(1, minY + 0.001);
    return { minX, minY, maxX, maxY };
}

/** @param {unknown} hex @param {number} fallback */
export function effectConfigHexToInt(hex, fallback) {
    let s = String(hex ?? '').trim();
    if (s.startsWith('#')) s = '0x' + s.slice(1);
    const withPrefix = s.startsWith('0x') || s.startsWith('0X') ? s : '0x' + s;
    const n = parseInt(withPrefix, 16);
    return Number.isFinite(n) ? n : fallback;
}

/**
 * Debug outline for `passUvBounds` (optional).
 * @param {Record<string, unknown>} config
 */
export function resolvePassUvBoundsHighlight(config) {
    const h = config.passUvBoundsHighlight && typeof config.passUvBoundsHighlight === 'object' ? config.passUvBoundsHighlight : {};
    const enabled = h.enabled === true;
    return {
        strength: enabled ? Math.max(0, Math.min(2, Number(h.strength ?? 0.85))) : 0,
        lineWidth: Math.max(0.0003, Math.min(0.05, Number(h.lineWidth ?? 0.004))),
        color: effectConfigHexToInt(h.color, 0x44ff99)
    };
}

/**
 * Min/max only (stencil, simulation RT, etc.).
 * @param {Record<string, unknown>} uniforms
 * @param {Record<string, unknown>} config
 * @param {typeof import('three')} THREE
 */
export function mergePassUvBoundsMinMaxUniforms(uniforms, config, THREE) {
    const pb = resolvePassUvBounds(config);
    uniforms.uPassUvMin = { value: new THREE.Vector2(pb.minX, pb.minY) };
    uniforms.uPassUvMax = { value: new THREE.Vector2(pb.maxX, pb.maxY) };
    return uniforms;
}

export function syncPassUvBoundsMinMaxUniforms(uniforms, config) {
    if (!uniforms?.uPassUvMin?.value || !uniforms?.uPassUvMax?.value) return;
    const pb = resolvePassUvBounds(config);
    uniforms.uPassUvMin.value.set(pb.minX, pb.minY);
    uniforms.uPassUvMax.value.set(pb.maxX, pb.maxY);
}

/**
 * Full pass-UV uniforms including optional debug outline (display / main overlay shaders).
 * @param {Record<string, unknown>} uniforms
 * @param {Record<string, unknown>} config
 * @param {typeof import('three')} THREE
 */
export function mergeAreaPassUvBoundsUniforms(uniforms, config, THREE) {
    mergePassUvBoundsMinMaxUniforms(uniforms, config, THREE);
    const hi = resolvePassUvBoundsHighlight(config);
    uniforms.uPassBoundsHiStrength = { value: hi.strength };
    uniforms.uPassBoundsHiLineWidth = { value: hi.lineWidth };
    uniforms.uPassBoundsHiColor = { value: new THREE.Color(hi.color) };
    return uniforms;
}

export function syncAreaPassUvBoundsUniforms(uniforms, config) {
    syncPassUvBoundsMinMaxUniforms(uniforms, config);
    if (!uniforms?.uPassBoundsHiStrength) return;
    const hi = resolvePassUvBoundsHighlight(config);
    uniforms.uPassBoundsHiStrength.value = hi.strength;
    uniforms.uPassBoundsHiLineWidth.value = hi.lineWidth;
    uniforms.uPassBoundsHiColor.value.setHex(hi.color);
}

/** Insert with other `uniform` lines; requires `varying vec2 vUv`. */
export const GLSL_AREA_PASS_UV_BOUNDS_UNIFORMS = `
    uniform vec2 uPassUvMin;
    uniform vec2 uPassUvMax;
    uniform float uPassBoundsHiStrength;
    uniform float uPassBoundsHiLineWidth;
    uniform vec3 uPassBoundsHiColor;
`;

/** Stencil / sim: only min–max. */
export const GLSL_AREA_PASS_UV_MINMAX_UNIFORMS = `
    uniform vec2 uPassUvMin;
    uniform vec2 uPassUvMax;
`;

/** First lines inside `void main()` for display shaders: discard outside box + `passLine` for outline. */
export const GLSL_AREA_PASS_UV_BOUNDS_DISCARD_AND_LINE = `
        if (vUv.x < uPassUvMin.x || vUv.x > uPassUvMax.x || vUv.y < uPassUvMin.y || vUv.y > uPassUvMax.y)
            discard;
        float passEdgeDist = min(
            min(vUv.x - uPassUvMin.x, uPassUvMax.x - vUv.x),
            min(vUv.y - uPassUvMin.y, uPassUvMax.y - vUv.y)
        );
        float passPw = max(0.0004, uPassBoundsHiLineWidth);
        float passLine = 0.0;
        if (uPassBoundsHiStrength > 0.0001) {
            passLine = exp(-pow(passEdgeDist / passPw, 2.0));
        }
`;

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
        
        /** @type {boolean} Whether this effect is enabled (used by feature flags). Default true. */
        this.enabled = true;
        
        /** @type {string} Effect name as registered in EffectManager (e.g. 'lanterns', 'water-ripple'). Set by EffectManager. */
        this.effectName = '';
        
        /** @type {'point'|'area'|'screen'} Effect type: 'point' for localized effects (e.g. lanterns), 'area' for mask-based overlays (e.g. water ripple), 'screen' for viewport/camera-level overlays. Default 'point'. */
        this.effectType = 'point';
        
        log('BaseEffect: Base effect initialized');
    }

    /**
     * Subscribe to size changes of this effect's WebGL canvas (shared observer across all effects on the same canvas).
     * Prefer this over `window.resize` for screen-space work that reads `renderer.domElement` dimensions.
     * @param {() => void} callback
     * @returns {() => void} Unsubscribe function
     */
    onRendererCanvasResize(callback) {
        return subscribeRendererCanvasResize(this.renderer?.domElement, callback);
    }

    isEnabled() {
        return this.enabled;
    }
    
    async setEnabled(enabled) {
        if (this.enabled === !!enabled) return;
        this.enabled = !!enabled;
        if (this.enabled) {
            await this.init();
        } else {
            this.cleanup();
        }
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
                if (mesh.userData?.resizeCleanup && typeof mesh.userData.resizeCleanup === 'function') {
                    mesh.userData.resizeCleanup();
                }
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
     * Creates a full-screen overlay mesh for screen effects. The quad is placed in front of the camera,
     * covers the viewport, and does not move with parallax. Use for water droplets, vignette, etc.
     * @param {string} fragmentShader - GLSL fragment shader source (receives uv, resolution)
     * @param {Object} effectUniforms - Effect-specific uniforms
     * @param {Object} [options={}] - ShaderMaterial options + distanceFromCamera (default 0.5) + syncResolutionUniform (default true: keep uResolution in sync with domElement; set false for offscreen / scaled targets)
     * @returns {THREE.Mesh} The created mesh; viewport updates run via shared canvas ResizeObserver
     */
    createScreenEffectMesh(fragmentShader, effectUniforms, options = {}) {
        log('BaseEffect: Creating screen effect overlay mesh');
        const { distanceFromCamera = 0.5, syncResolutionUniform = true, ...materialOptions } = options;
        const fov = 45;
        const fovRad = THREE.MathUtils.degToRad(fov);
        const halfFov = fovRad / 2;
        const aspect = this.camera.aspect;
        const height = 2 * Math.tan(halfFov) * distanceFromCamera;
        const width = height * aspect;
        const geometry = new THREE.PlaneGeometry(1, 1);
        const resolution = new THREE.Vector2(this.renderer.domElement.width, this.renderer.domElement.height);
        const uniforms = {
            uResolution: { value: resolution },
            uTime: { value: 0 },
            ...effectUniforms
        };
        const vertexShader = `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `;
        const material = new THREE.ShaderMaterial({
            vertexShader,
            fragmentShader,
            uniforms,
            transparent: true,
            depthTest: false,
            depthWrite: false,
            side: THREE.FrontSide,
            ...materialOptions
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(0, 0, this.camera.position.z - distanceFromCamera);
        mesh.scale.set(width, height, 1);
        mesh.frustumCulled = false;
        mesh.renderOrder = 9999;
        mesh.userData.isScreenEffect = true;
        mesh.userData.distanceFromCamera = distanceFromCamera;
        mesh.userData.syncResolutionUniform = syncResolutionUniform;
        const boundUpdate = () => this.updateScreenEffectViewport(mesh);
        mesh.userData.resizeCleanup = subscribeRendererCanvasResize(this.renderer.domElement, boundUpdate);
        this.meshes.push(mesh);
        this.materials.push(material);
        this.scene.add(mesh);
        log('BaseEffect: Screen effect mesh created');
        return mesh;
    }

    /**
     * Updates a screen effect mesh to match the current viewport. Call on resize or when camera aspect changes.
     * @param {THREE.Mesh} mesh - The screen effect mesh from createScreenEffectMesh
     */
    updateScreenEffectViewport(mesh) {
        if (!mesh || !mesh.userData.isScreenEffect) return;
        const d = mesh.userData.distanceFromCamera ?? 0.5;
        const fovRad = THREE.MathUtils.degToRad(45);
        const halfFov = fovRad / 2;
        const height = 2 * Math.tan(halfFov) * d;
        const width = height * this.camera.aspect;
        mesh.position.z = this.camera.position.z - d;
        mesh.scale.set(width, height, 1);
        const syncRes = mesh.userData.syncResolutionUniform !== false;
        if (syncRes && mesh.material.uniforms?.uResolution?.value) {
            mesh.material.uniforms.uResolution.value.set(
                this.renderer.domElement.width,
                this.renderer.domElement.height
            );
        }
    }

    /**
     * Applies the current parallax mesh transform (position, scale) to the given mesh.
     * Call this from update() or from updatePositionsForMeshTransform(meshTransform) so the overlay stays aligned with the background.
     * @param {THREE.Mesh} mesh - The area effect overlay mesh to sync
     * @param {object} [options]
     * @param {number} [options.overlayZ=0] - Added to mesh.position.z (after parallax root z). Use PARALLAX_COARSE_OVERLAY_Z for foliage / character tint.
     * @param {boolean} [options.perspectiveCompensate=true] - When overlayZ ≠ 0, scale XY by (camZ−baseZ−overlayZ)/(camZ−baseZ) so apparent size matches the unshifted plane (removes subtle “zoom”).
     */
    syncWithParallaxMesh(mesh, options = {}) {
        if (!mesh || !this.parallax || !this.parallax.meshTransform) return;
        const t = this.parallax.meshTransform;
        const overlayZ = Number(options.overlayZ) || 0;
        mesh.position.set(t.position.x, t.position.y, t.position.z + overlayZ);
        let s = t.scale;
        const compensate = options.perspectiveCompensate !== false;
        if (overlayZ !== 0 && compensate && this.camera?.position) {
            const camZ = this.camera.position.z;
            const baseZ = t.position.z;
            const farDist = camZ - baseZ;
            const nearDist = camZ - baseZ - overlayZ;
            if (farDist > 1e-6 && nearDist > 1e-3) {
                s *= nearDist / farDist;
            }
        }
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
