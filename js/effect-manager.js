// Effect Manager - Central system for loading and managing effects
// Integrates with SimpleParallax to add visual effects on top of 3D parallax

import * as THREE from 'https://unpkg.com/three@0.172.0/build/three.module.js';

const debugLog = (...args) => {
    if (window.location.pathname.endsWith('test-effects.html')) {
        console.log(...args);
    }
};

class EffectManager {
    constructor(scene, camera, renderer, parallaxInstance) {
        debugLog('EffectManager: Initializing with scene, camera, renderer, and parallax instance');
        
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;
        this.parallax = parallaxInstance;
        this.backgroundName = parallaxInstance.backgroundName;
        
        this.effects = new Map(); // Store effect instances by name
        this.effectInstances = []; // Store all effect instances for updates
        this.isInitialized = false;
        
        debugLog(`EffectManager: Created for background ${this.backgroundName}`);
    }
    
    async loadEffects() {
        debugLog(`EffectManager: Loading effects for background ${this.backgroundName}`);
        
        try {
            // Discover effect files in the background folder
            const effectFiles = await this.discoverEffectFiles();
            debugLog(`EffectManager: Found ${effectFiles.length} effect files:`, effectFiles);
            
            if (effectFiles.length === 0) {
                debugLog('EffectManager: No effect files found, skipping effect loading');
                return;
            }
            
            // Load each effect
            for (const effectFile of effectFiles) {
                try {
                    debugLog(`EffectManager: Loading effect file: ${effectFile}`);
                    const effectPath = `../assets/ParallaxBackgrounds/${this.backgroundName}/${effectFile}`;
                    const effectModule = await import(effectPath);
                    
                    if (effectModule.default) {
                        const effectName = effectFile.replace('.js', '');
                        const effectInstance = new effectModule.default(this.scene, this.camera, this.renderer, this.parallax);
                        effectInstance.effectName = effectName;
                        
                        const enabled = this.parallax.getFlag(`effects.${effectName}.enabled`);
                        if (enabled) {
                            await effectInstance.init();
                        } else {
                            effectInstance.enabled = false;
                        }
                        
                        this.effects.set(effectName, effectInstance);
                        this.effectInstances.push(effectInstance);
                        
                        debugLog(`EffectManager: Successfully loaded effect: ${effectFile} (enabled: ${enabled})`);
                    } else {
                        console.warn(`EffectManager: Effect file ${effectFile} does not export a default class`);
                    }
                } catch (error) {
                    console.error(`EffectManager: Failed to load effect ${effectFile}:`, error);
                }
            }
            
            this.isInitialized = true;
            debugLog(`EffectManager: Successfully initialized with ${this.effectInstances.length} effects`);

        } catch (error) {
            console.error('EffectManager: Error during effect loading:', error);
        }
    }
    
    async discoverEffectFiles() {
        debugLog(`EffectManager: Discovering effect files for ${this.backgroundName}`);
        
        // For now, we'll manually define the effect files we expect
        // In a real implementation, you might want to fetch a manifest or scan the directory
        const expectedEffects = {
            'bg1': ['snowmist.js'],
            'bg2': ['lanterns.js', 'lantern-glow.js', 'water-ripple.js', 'foliage-wind.js', 'flame-movement.js', 'flame-glow.js', 'character-burn.js', 'potion-bubbles.js', 'screen-vignette.js', 'candle-flame-screen.js'],
            'bg3': [],
            'bg4': [],
            'bg5': [],
            'bg6': []
        };
        
        const effects = expectedEffects[this.backgroundName] || [];
        debugLog(`EffectManager: Expected effects for ${this.backgroundName}:`, effects);
        
        return effects;
    }
    
    update(deltaTime) {
        if (!this.isInitialized) {
            return;
        }
        
        // Update all active effects (skip disabled)
        this.effectInstances.forEach((effect, index) => {
            try {
                if (!effect.isEnabled || !effect.isEnabled()) return;
                if (effect.update && typeof effect.update === 'function') {
                    effect.update(deltaTime);
                }
            } catch (error) {
                console.error(`EffectManager: Error updating effect ${index}:`, error);
            }
        });
    }

    renderPrePass(renderer, camera) {
        if (!this.isInitialized) return;
        this.effectInstances.forEach((effect) => {
            try {
                if (!effect.isEnabled || !effect.isEnabled()) return;
                if (effect.renderPrePass && typeof effect.renderPrePass === 'function') {
                    effect.renderPrePass(renderer, camera);
                }
            } catch (error) {
                console.error(`EffectManager: Error in renderPrePass:`, error);
            }
        });
    }
    
    cleanup() {
        debugLog('EffectManager: Cleaning up all effects');
        
        this.effectInstances.forEach((effect, index) => {
            try {
                if (effect.cleanup && typeof effect.cleanup === 'function') {
                    effect.cleanup();
                    debugLog(`EffectManager: Cleaned up effect ${index}`);
                }
            } catch (error) {
                console.error(`EffectManager: Error cleaning up effect ${index}:`, error);
            }
        });
        
        this.effects.clear();
        this.effectInstances = [];
        this.isInitialized = false;
        
        debugLog('EffectManager: Cleanup complete');
    }
    
    // Get a specific effect by name
    getEffect(name) {
        return this.effects.get(name);
    }
    
    async setEffectEnabled(name, enabled) {
        const effect = this.effects.get(name);
        if (!effect) return;
        if (typeof effect.setEnabled === 'function') {
            await effect.setEnabled(!!enabled);
        }
        if (this.parallax && typeof this.parallax.setFlag === 'function') {
            this.parallax.setFlag(`effects.${name}.enabled`, !!enabled);
        }
    }
    
    // Check if effects are loaded
    isReady() {
        return this.isInitialized;
    }
}

export default EffectManager;
