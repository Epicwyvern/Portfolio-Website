// Effect Manager - Central system for loading and managing effects
// Integrates with SimpleParallax to add visual effects on top of 3D parallax

import * as THREE from '../node_modules/three/build/three.module.js';

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
            // Discover effect files in the background folder
            const effectFiles = await this.discoverEffectFiles();
            console.log(`EffectManager: Found ${effectFiles.length} effect files:`, effectFiles);
            
            if (effectFiles.length === 0) {
                console.log('EffectManager: No effect files found, skipping effect loading');
                return;
            }
            
            // Load each effect
            for (const effectFile of effectFiles) {
                try {
                    console.log(`EffectManager: Loading effect file: ${effectFile}`);
                    const effectPath = `../assets/ParallaxBackgrounds/${this.backgroundName}/${effectFile}`;
                    const effectModule = await import(effectPath);
                    
                    if (effectModule.default) {
                        const effectInstance = new effectModule.default(this.scene, this.camera, this.renderer, this.parallax);
                        await effectInstance.init();
                        
                        this.effects.set(effectFile.replace('.js', ''), effectInstance);
                        this.effectInstances.push(effectInstance);
                        
                        console.log(`EffectManager: Successfully loaded effect: ${effectFile}`);
                    } else {
                        console.warn(`EffectManager: Effect file ${effectFile} does not export a default class`);
                    }
                } catch (error) {
                    console.error(`EffectManager: Failed to load effect ${effectFile}:`, error);
                }
            }
            
            this.isInitialized = true;
            console.log(`EffectManager: Successfully initialized with ${this.effectInstances.length} effects`);
            
        } catch (error) {
            console.error('EffectManager: Error during effect loading:', error);
        }
    }
    
    async discoverEffectFiles() {
        console.log(`EffectManager: Discovering effect files for ${this.backgroundName}`);
        
        // For now, we'll manually define the effect files we expect
        // In a real implementation, you might want to fetch a manifest or scan the directory
        const expectedEffects = {
            'bg1': ['snowmist.js'],
            'bg2': ['lanterns.js'],
            'bg3': [],
            'bg4': [],
            'bg5': [],
            'bg6': []
        };
        
        const effects = expectedEffects[this.backgroundName] || [];
        console.log(`EffectManager: Expected effects for ${this.backgroundName}:`, effects);
        
        return effects;
    }
    
    update() {
        if (!this.isInitialized) {
            return;
        }
        
        // Update all active effects
        this.effectInstances.forEach((effect, index) => {
            try {
                if (effect.update && typeof effect.update === 'function') {
                    effect.update();
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
