// GSAP Integration for Advanced Effects
// Enhances the particle system with professional animation capabilities

import { gsap } from '../node_modules/gsap/index.js';

class GSAPEffects {
    constructor() {
        this.isGSAPAvailable = typeof gsap !== 'undefined';
        
        if (this.isGSAPAvailable) {
            console.log('GSAP Effects: GSAP integration enabled');
        } else {
            console.warn('GSAP Effects: GSAP not available, falling back to built-in easing');
        }
    }
    
    // Enhanced particle animation with GSAP
    animateParticleWithGSAP(particle, config) {
        if (!this.isGSAPAvailable) {
            return false; // Fallback to manual animation
        }
        
        const mesh = particle.mesh;
        const timeline = gsap.timeline();
        
        // Growth animation with advanced easing
        timeline.to(mesh.scale, {
            duration: config.lifetime * 0.6, // Growth phase
            x: config.finalScale,
            y: config.finalScale,
            z: 1,
            ease: "power2.out",
            onComplete: () => {
                // Shrink phase
                gsap.to(mesh.scale, {
                    duration: config.lifetime * 0.4,
                    x: 0,
                    y: 0,
                    z: 1,
                    ease: "power2.in"
                });
            }
        });
        
        // Opacity animation with precise timing
        timeline.to(mesh.material, {
            duration: config.lifetime * 0.2,
            opacity: config.maxOpacity,
            ease: "power1.out"
        }, 0) // Start immediately
        .to(mesh.material, {
            duration: config.lifetime * 0.3,
            opacity: 0,
            ease: "power2.in",
            delay: config.lifetime * 0.7 // Start fade out at 70%
        });
        
        // Optional: Add subtle rotation animation
        if (config.enableRotation) {
            timeline.to(mesh.rotation, {
                duration: config.lifetime,
                z: particle.initialRotation + Math.PI * 2,
                ease: "none" // Linear rotation
            }, 0);
        }
        
        return timeline;
    }
    
    // Create pulsing animation for core/ray differential effect
    createPulsingEffect(mesh, config) {
        if (!this.isGSAPAvailable) return null;
        
        return gsap.to(mesh.material, {
            duration: config.pulseSpeed || 2.0,
            opacity: `*=0.7`, // Multiply current opacity by 0.7
            yoyo: true,
            repeat: -1,
            ease: "sine.inOut"
        });
    }
    
    // Advanced sparkle burst effect
    createBurstEffect(originPosition, particleCount = 10, config = {}) {
        if (!this.isGSAPAvailable) return [];
        
        const bursts = [];
        
        for (let i = 0; i < particleCount; i++) {
            const angle = (i / particleCount) * Math.PI * 2;
            const distance = config.burstRadius || 2.0;
            
            const burst = {
                x: originPosition.x + Math.cos(angle) * distance,
                y: originPosition.y + Math.sin(angle) * distance,
                delay: i * (config.burstDelay || 0.05)
            };
            
            bursts.push(burst);
        }
        
        return bursts;
    }
    
    // Smooth camera shake effect
    createCameraShake(camera, intensity = 0.1, duration = 0.5) {
        if (!this.isGSAPAvailable) return null;
        
        const originalPosition = {
            x: camera.position.x,
            y: camera.position.y,
            z: camera.position.z
        };
        
        return gsap.to(camera.position, {
            duration: duration,
            x: `+=${gsap.utils.random(-intensity, intensity)}`,
            y: `+=${gsap.utils.random(-intensity, intensity)}`,
            ease: "rough({ template: none.out, strength: 2, points: 20, taper: both, randomize: true, clamp: false})",
            onComplete: () => {
                // Reset to original position
                gsap.set(camera.position, originalPosition);
            }
        });
    }
    
    // Color transition animation
    animateColor(material, fromColor, toColor, duration = 1.0) {
        if (!this.isGSAPAvailable) return null;
        
        const colorProxy = { r: fromColor.r, g: fromColor.g, b: fromColor.b };
        
        return gsap.to(colorProxy, {
            duration: duration,
            r: toColor.r,
            g: toColor.g,
            b: toColor.b,
            ease: "power2.inOut",
            onUpdate: () => {
                material.color.setRGB(colorProxy.r, colorProxy.g, colorProxy.b);
            }
        });
    }
    
    // Stagger animation for multiple particles
    staggerParticles(particles, config = {}) {
        if (!this.isGSAPAvailable || particles.length === 0) return null;
        
        const timeline = gsap.timeline();
        
        particles.forEach((particle, index) => {
            timeline.from(particle.mesh.scale, {
                duration: config.duration || 0.5,
                x: 0,
                y: 0,
                z: 1,
                ease: config.ease || "back.out(1.7)"
            }, index * (config.stagger || 0.1));
        });
        
        return timeline;
    }
    
    // Easing function bridge for non-GSAP animations
    getEasing(easeName) {
        if (!this.isGSAPAvailable) {
            // Return custom easing functions as fallback
            const easings = {
                'power2.out': (t) => 1 - Math.pow(1 - t, 2),
                'power2.in': (t) => t * t,
                'back.out': (t) => {
                    const c1 = 1.70158;
                    const c3 = c1 + 1;
                    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
                },
                'sine.inOut': (t) => -(Math.cos(Math.PI * t) - 1) / 2
            };
            
            return easings[easeName] || ((t) => t); // Linear fallback
        }
        
        // Return GSAP easing if available
        return gsap.parseEase(easeName);
    }
}

export default GSAPEffects;
