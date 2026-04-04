// Lantern Effect - Twinkling and shining lanterns for bg2 magical scene
// Uses InstancedMesh for all particles — single draw call, zero GPU resource churn.

import BaseEffect from '../../../js/base-effect.js';
import * as THREE from 'https://unpkg.com/three@0.172.0/build/three.module.js';

const log = (...args) => {
    if (window.location.pathname.endsWith('test-effects.html')) {
        console.log(...args);
    }
};

const _scratchMatrix = new THREE.Matrix4();
const _scratchPosition = new THREE.Vector3();
const _scratchQuaternion = new THREE.Quaternion();
const _scratchScale = new THREE.Vector3();
const _scratchColor = new THREE.Color();
const _scratchEuler = new THREE.Euler();
const _scratchDisp = new THREE.Vector2();

class LanternEffect extends BaseEffect {
    async init() {
        log('LanternEffect: Initializing instanced lantern effect');
        
        try {
            if (!this.flareTexture) {
                this.flareTexture = await this.loadTexture('./assets/ParallaxBackgrounds/bg2/assets/flare_1.png');
                log('LanternEffect: Successfully loaded flare texture');
            }
            
            if (!this.fullLanternConfig) {
                this.fullLanternConfig = await this.loadLanternConfig();
                log('LanternEffect: Loaded lantern configuration:', this.fullLanternConfig);
            }
            const lanternConfig = this.fullLanternConfig;
            
            log(`LanternEffect: Creating ${lanternConfig.lanterns.length} lantern systems`);
            
            this.lanternSystems = [];
            let maxParticles = 0;

            lanternConfig.lanterns.forEach((lanternData, index) => {
                try {
                    const config = { ...lanternConfig.defaults, ...lanternData };
                    
                    const basePosition = new THREE.Vector3(
                        config.position.x ?? 0.5,
                        config.position.y ?? 0.5,
                        0
                    );
                    
                    const lanternSystem = {
                        name: config.name,
                        index: index,
                        originPosition: new THREE.Vector3(),
                        basePosition: basePosition,
                        config: config,
                        particles: [],
                        nextParticleTime: 0,
                    };
                    
                    maxParticles += config.count || 3;
                    this.lanternSystems.push(lanternSystem);
                    log(`LanternEffect: Created lantern system ${index} (${config.name})`);
                    
                } catch (error) {
                    console.error(`LanternEffect: Error creating lantern system ${index}:`, error);
                }
            });

            this._maxParticles = maxParticles;
            this._createInstancedMesh(lanternConfig);
            
            this._refreshDisabledLanterns();
            this._unsubLanternChange = this.parallax?.onLanternIndividualChange?.(
                () => this._refreshDisabledLanterns()
            );
            
            if (lanternConfig.clickToToggle !== false) {
                this.setupClickToToggle();
            }
            
            this.time = 0;
            this.isInitialized = true;
            
            log(`LanternEffect: Initialized with ${this.lanternSystems.length} systems, max ${maxParticles} particles (1 draw call)`);
            
        } catch (error) {
            console.error('LanternEffect: Error during initialization:', error);
            throw error;
        }
    }

    _createInstancedMesh(lanternConfig) {
        const defaults = lanternConfig.defaults || {};
        const blendMode = this.getBlendMode(defaults.blendMode || 'AdditiveBlending');
        const alphaTest = defaults.alphaTest || 0.01;

        const geometry = new THREE.PlaneGeometry(0.1, 0.1);
        const material = new THREE.MeshBasicMaterial({
            map: this.flareTexture,
            transparent: true,
            opacity: 1.0,
            alphaTest: alphaTest,
            blending: blendMode,
            side: THREE.DoubleSide,
            depthWrite: false,
            depthTest: false,
        });

        this._instancedMesh = new THREE.InstancedMesh(geometry, material, this._maxParticles);
        this._instancedMesh.count = 0;
        this._instancedMesh.frustumCulled = false;

        // Initialize all matrices to zero-scale (invisible) so unused slots don't render artifacts
        _scratchMatrix.makeScale(0, 0, 0);
        for (let i = 0; i < this._maxParticles; i++) {
            this._instancedMesh.setMatrixAt(i, _scratchMatrix);
        }
        this._instancedMesh.instanceMatrix.needsUpdate = true;

        this.scene.add(this._instancedMesh);
        this.meshes.push(this._instancedMesh);
        this.materials.push(material);
    }
    
    update(deltaTime) {
        if (!this.isInitialized || !this._instancedMesh) return;
        
        if (this.time === undefined) this.time = 0;
        
        const frameDelta = Number.isFinite(deltaTime) && deltaTime > 0 ? deltaTime : 0.016;
        this.time += frameDelta;
        
        let instanceIndex = 0;

        for (let si = 0; si < this.lanternSystems.length; si++) {
            const system = this.lanternSystems[si];
            try {
                if (this._disabledLanterns?.has(system.name)) {
                    system.particles.length = 0;
                    continue;
                }

                this.parallax?.getWorldPositionForUV(
                    system.basePosition.x, system.basePosition.y, 0,
                    system.originPosition
                );

                if (this.time >= system.nextParticleTime && system.particles.length < system.config.count) {
                    this._spawnParticle(system);
                    const spawnInterval = 1.0 / (system.config.newParticleSpeed || 1.0);
                    const randomDelay = (Math.random() - 0.5) * spawnInterval * 0.5;
                    system.nextParticleTime = this.time + spawnInterval + randomDelay;
                }

                // Update particles, remove dead ones via swap-with-last
                let i = 0;
                while (i < system.particles.length) {
                    const particle = system.particles[i];
                    particle.age += frameDelta;

                    if (particle.age >= particle.lifetime) {
                        // Swap with last and pop — O(1) removal, no splice
                        const last = system.particles.length - 1;
                        if (i < last) system.particles[i] = system.particles[last];
                        system.particles.length = last;
                        continue;
                    }

                    this._writeParticleInstance(particle, system, instanceIndex);
                    instanceIndex++;
                    i++;
                }
                
            } catch (error) {
                console.error(`LanternEffect: Error updating lantern system ${si}:`, error);
            }
        }

        this._instancedMesh.count = instanceIndex;
        if (instanceIndex > 0) {
            this._instancedMesh.instanceMatrix.needsUpdate = true;
            if (this._instancedMesh.instanceColor) {
                this._instancedMesh.instanceColor.needsUpdate = true;
            }
        }
    }

    _spawnParticle(system) {
        const config = system.config;
        system.particles.push({
            age: 0,
            lifetime: config.lifetime * (0.7 + Math.random() * 0.6),
            growthSpeed: config.growthSpeed || 2.0,
            baseScale: config.scale || 1.0,
            maxOpacity: config.opacity || 0.8,
            baseColor: new THREE.Color(config.color || 0xffaa44),
            rotation: Math.random() * Math.PI * 2,
        });
    }
    
    _writeParticleInstance(particle, system, slotIndex) {
        const lifeProgress = particle.age / particle.lifetime;
        
        // Scale: continuous growth
        const currentScale = particle.growthSpeed * particle.age * particle.baseScale;

        // Opacity: fade-in (0–20%), bright (20–70%), fade-out (70–100%)
        let opacityProgress;
        if (lifeProgress < 0.2) {
            const t = lifeProgress / 0.2;
            opacityProgress = 1 - (1 - t) * (1 - t); // easeOutQuad
        } else if (lifeProgress < 0.7) {
            opacityProgress = 1.0;
        } else {
            const t = (lifeProgress - 0.7) / 0.3;
            opacityProgress = 1.0 - t * t; // easeInQuad
        }
        
        // For additive blending, brightness IS opacity. Combine all intensity factors into color.
        const normalizedOpacity = opacityProgress; 
        const glowIntensity = 0.5 + normalizedOpacity * 0.5;
        const brightness = opacityProgress * particle.maxOpacity * glowIntensity;
        _scratchColor.copy(particle.baseColor).multiplyScalar(brightness);
        this._instancedMesh.setColorAt(slotIndex, _scratchColor);

        // Position: origin + parallax displacement
        let px = system.originPosition.x;
        let py = system.originPosition.y;
        let pz = system.originPosition.z;

        if (this.parallax?.getParallaxDisplacementForUV) {
            this.parallax.getParallaxDisplacementForUV(
                system.basePosition.x, system.basePosition.y, _scratchDisp
            );
            px += _scratchDisp.x;
            py += _scratchDisp.y;
        }

        _scratchPosition.set(px, py, pz);
        _scratchEuler.set(0, 0, particle.rotation);
        _scratchQuaternion.setFromEuler(_scratchEuler);
        _scratchScale.set(currentScale, currentScale, 1);
        _scratchMatrix.compose(_scratchPosition, _scratchQuaternion, _scratchScale);
        this._instancedMesh.setMatrixAt(slotIndex, _scratchMatrix);
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

    updatePositionsForMeshTransform(_meshTransform) {
        // Positions computed each frame from parallax.getWorldPositionForUV in update()
    }
    
    calculateCanonicalMeshTransform() {
        const referenceViewport = this.parallax.config.settings.referenceViewport || { width: 1920, height: 1080 };
        const REFERENCE_WIDTH = referenceViewport.width;
        const REFERENCE_HEIGHT = referenceViewport.height;
        
        const containerAspect = REFERENCE_WIDTH / REFERENCE_HEIGHT;
        const imageAspect = this.parallax.depthData.width / this.parallax.depthData.height;
        const cameraZ = this.parallax.camera.position.z;
        const visibleHeight = 2 * Math.tan(THREE.MathUtils.degToRad(45/2)) * cameraZ;
        const visibleWidth = visibleHeight * containerAspect;
        
        let baseScale;
        if (containerAspect > imageAspect) {
            baseScale = visibleWidth / this.parallax.mesh.geometry.parameters.width;
        } else {
            baseScale = visibleHeight / this.parallax.mesh.geometry.parameters.height;
        }
        
        const finalScale = baseScale * this.parallax.extraScale;
        const scaledMeshWidth = this.parallax.mesh.geometry.parameters.width * finalScale;
        const scaledMeshHeight = this.parallax.mesh.geometry.parameters.height * finalScale;
        const overflowX = scaledMeshWidth - visibleWidth;
        const overflowY = scaledMeshHeight - visibleHeight;
        const offsetX = (0.5 - this.parallax.focalPoint.x) * overflowX;
        const offsetY = (0.5 - this.parallax.focalPoint.y) * overflowY;
        
        return {
            scale: finalScale,
            position: { x: offsetX, y: offsetY, z: 0 },
            baseGeometrySize: { 
                width: this.parallax.mesh.geometry.parameters.width,
                height: this.parallax.mesh.geometry.parameters.height
            }
        };
    }
    
    async loadLanternConfig() {
        log('LanternEffect: Loading lantern configuration from parallax config');
        
        try {
            if (!this.parallax || !this.parallax.config || !this.parallax.config.effects || !this.parallax.config.effects.lanterns) {
                console.warn('LanternEffect: No lantern config found in parallax config, using fallback');
                return this.getFallbackConfig();
            }
            
            const lanternConfig = this.parallax.config.effects.lanterns;
            
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
    
    getFallbackConfig() {
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
    
    getLanternSystem(name) {
        return this.lanternSystems.find(system => system.name === name);
    }
    
    setGlobalIntensity(intensity) {
        this.lanternSystems.forEach(system => {
            system.config.opacity = intensity;
            system.particles.forEach(particle => {
                particle.maxOpacity = intensity;
            });
        });
    }
    
    cleanup() {
        if (this.lanternSystems) {
            this.lanternSystems.forEach(system => {
                system.particles.length = 0;
            });
            this.lanternSystems = [];
        }

        if (this._instancedMesh) {
            this.scene.remove(this._instancedMesh);
            this._instancedMesh.geometry?.dispose();
            this._instancedMesh.material?.dispose();
            // Remove from parent tracking so base cleanup doesn't double-dispose
            const mi = this.meshes.indexOf(this._instancedMesh);
            if (mi >= 0) this.meshes.splice(mi, 1);
            const mai = this.materials.indexOf(this._instancedMesh.material);
            if (mai >= 0) this.materials.splice(mai, 1);
            this._instancedMesh = null;
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
        this.time = 0;
        
        if (this.flareTexture && this.textures.includes(this.flareTexture)) {
            const index = this.textures.indexOf(this.flareTexture);
            this.textures.splice(index, 1);
        }
        
        super.cleanup();
        
        if (this.flareTexture) {
            this.textures.push(this.flareTexture);
        }
    }
}

export default LanternEffect;
