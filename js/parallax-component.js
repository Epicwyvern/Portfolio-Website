// Parallax Background Component
// Easy integration for any HTML page

import SimpleParallax from './parallax.js';

class ParallaxBackground {
    constructor(containerId = 'parallax-container', backgroundName = 'bg2') {
        this.containerId = containerId;
        this.backgroundName = backgroundName;
        this.container = document.getElementById(containerId);
        
        if (!this.container) {
            console.error(`Container with id "${containerId}" not found`);
            return;
        }
        
        this.init();
    }
    
    async init() {
        // Create canvas element
        this.canvas = document.createElement('canvas');
        this.canvas.id = 'parallax-canvas';
        this.container.appendChild(this.canvas);
        
        // Initialize the parallax system with the specified background
        this.parallax = new SimpleParallax(this.backgroundName);
    }
    
    // Method to change background image
    async changeBackground(backgroundName) {
        if (this.parallax) {
            this.parallax.backgroundName = backgroundName;
            this.parallax.config.image = `${backgroundName}.jpg`;
            this.parallax.config.depthMap = `${backgroundName}d.webp`;
            await this.parallax.loadConfig();
            await this.parallax.loadImageAndDepthMap();
        }
    }
    
    // Method to destroy the component
    destroy() {
        console.log('ParallaxBackground: Destroying component');
        
        if (this.parallax) {
            this.parallax.destroy();
            this.parallax = null;
        }
        
        if (this.canvas) {
            this.canvas.remove();
        }
        
        console.log('ParallaxBackground: Component destroyed');
    }
}

// Export for manual initialization
export default ParallaxBackground;
