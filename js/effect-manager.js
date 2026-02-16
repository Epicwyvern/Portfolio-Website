// Effect Manager - Central system for loading and managing effects
// Integrates with SimpleParallax to add visual effects on top of 3D parallax

import * as THREE from 'https://unpkg.com/three@0.172.0/build/three.module.js';

class EffectManager {
    constructor(scene, camera, renderer, parallaxInstance) {
        console.log('EffectManager: Initializing with scene, camera, renderer, and parallax instance');
        
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;
        this.parallax = parallaxInstance;
        this.backgroundName = parallaxInstance.backgroundName;
        
        this.effects = new Map(); // Store effect instances by name
        this.effectInstances = []; // Store all effect instances for updates
        this.isInitialized = false;
        
        console.log(`EffectManager: Created for background ${this.backgroundName}`);
    }
    
    async loadEffects() {
        console.log(`EffectManager: Loading effects for background ${this.backgroundName}`);
        
        try {
            const effectFiles = await this.discoverEffectFiles();
            console.log(`EffectManager: Found ${effectFiles.length} effect files:`, effectFiles);
            
            if (effectFiles.length === 0) {
                this.isInitialized = true;
                return;
            }
            
            // Load all effects in parallel (faster than one-by-one)
            const loadOne = async (effectFile) => {
                const effectPath = `../assets/ParallaxBackgrounds/${this.backgroundName}/${effectFile}`;
                const effectModule = await import(effectPath);
                if (!effectModule.default) {
                    console.warn(`EffectManager: Effect file ${effectFile} does not export a default class`);
                    return null;
                }
                const effectInstance = new effectModule.default(this.scene, this.camera, this.renderer, this.parallax);
                await effectInstance.init();
                return { key: effectFile.replace('.js', ''), instance: effectInstance };
            };

            const results = await Promise.all(
                effectFiles.map((effectFile) => {
                    console.log(`EffectManager: Loading effect file: ${effectFile}`);
                    return loadOne(effectFile).catch((error) => {
                        console.error(`EffectManager: Failed to load effect ${effectFile}:`, error);
                        return null;
                    });
                })
            );

            results.forEach((r) => {
                if (r) {
                    this.effects.set(r.key, r.instance);
                    this.effectInstances.push(r.instance);
                    console.log(`EffectManager: Successfully loaded effect: ${r.key}`);
                }
            });

            this.isInitialized = true;
            console.log(`EffectManager: Successfully initialized with ${this.effectInstances.length} effects`);
            
        } catch (error) {
            console.error('EffectManager: Error during effect loading:', error);
            this.isInitialized = true;
        }
    }
    
    async discoverEffectFiles() {
        console.log(`EffectManager: Discovering effect files for ${this.backgroundName}`);
        
        // For now, we'll manually define the effect files we expect
        // In a real implementation, you might want to fetch a manifest or scan the directory
        const expectedEffects = {
            'bg1': ['snowmist.js'],
            'bg2': ['lanterns.js', 'water-ripple.js'],
            'bg3': [],
            'bg4': [],
            'bg5': [],
            'bg6': []
        };
        
        const effects = expectedEffects[this.backgroundName] || [];
        console.log(`EffectManager: Expected effects for ${this.backgroundName}:`, effects);
        
        return effects;
    }
    
    update(deltaTime) {
        // Update whatever effects are loaded (list may still be growing if loadEffects() is in progress)
        this.effectInstances.forEach((effect, index) => {
            try {
                if (effect.update && typeof effect.update === 'function') {
                    effect.update(deltaTime);
                }
            } catch (error) {
                console.error(`EffectManager: Error updating effect ${index}:`, error);
            }
        });
    }
    
    cleanup() {
        console.log('EffectManager: Cleaning up all effects');
        
        this.effectInstances.forEach((effect, index) => {
            try {
                if (effect.cleanup && typeof effect.cleanup === 'function') {
                    effect.cleanup();
                    console.log(`EffectManager: Cleaned up effect ${index}`);
                }
            } catch (error) {
                console.error(`EffectManager: Error cleaning up effect ${index}:`, error);
            }
        });
        
        this.effects.clear();
        this.effectInstances = [];
        this.isInitialized = false;
        
        console.log('EffectManager: Cleanup complete');
    }
    
    // Get a specific effect by name
    getEffect(name) {
        return this.effects.get(name);
    }
    
    // Check if effects are loaded
    isReady() {
        return this.isInitialized;
    }
}

export default EffectManager;
