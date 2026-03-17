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
        
        // FPS counter (visibility controlled by ui.showFpsCounter flag)
        this._setupFpsCounter();
    }
    
    _setupFpsCounter() {
        const el = document.createElement('div');
        el.id = 'fps-counter';
        el.className = 'fps-counter';
        el.textContent = 'FPS: --';
        el.style.cssText = 'position:absolute;top:20px;left:20px;color:#00ff90;font-family:"Courier New",monospace;font-size:12px;z-index:1100;background:rgba(0,0,0,0.8);padding:6px 8px;border-radius:4px;border:1px solid #1f3d2b;min-width:70px;text-align:center;display:none';
        this.container.appendChild(el);
        
        let frames = 0;
        let lastTime = performance.now();
        let visibilitySet = false;
        
        const update = (now) => {
            frames += 1;
            const elapsed = now - lastTime;
            if (elapsed >= 500) {
                const fps = (frames * 1000) / elapsed;
                el.textContent = `FPS: ${fps.toFixed(1)}`;
                frames = 0;
                lastTime = now;
            }
            if (!visibilitySet && this.parallax?.flags && 'ui' in this.parallax.flags) {
                visibilitySet = true;
                el.style.display = this.parallax.getFlag('ui.showFpsCounter', false) ? 'block' : 'none';
            }
            requestAnimationFrame(update);
        };
        requestAnimationFrame(update);
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
