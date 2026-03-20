// Lantern glow (bg2) — reserved effect slot; does not render a mesh overlay.
//
// Previously this drew additive blobs on the parallax mesh at lantern UVs. That is not a screen
// proximity effect: mouse-driven edge / proximity glow lives in screen-vignette.js under
// effects.screenVignette.lanternProximity (see computeGlowState + DEFAULT_FRAGMENT_SHADER uniforms).

import BaseEffect from '../../../js/base-effect.js';

const log = (...args) => {
    if (window.location.pathname.endsWith('test-effects.html')) {
        console.log(...args);
    }
};

class LanternGlowEffect extends BaseEffect {
    constructor(scene, camera, renderer, parallaxInstance) {
        super(scene, camera, renderer, parallaxInstance);
        this.effectType = 'screen';
    }

    async init() {
        log('LanternGlowEffect: no-op (proximity/edge glow is handled by screen-vignette lanternProximity)');
        this.isInitialized = true;
    }

    cleanup() {
        super.cleanup();
    }
}

export default LanternGlowEffect;
