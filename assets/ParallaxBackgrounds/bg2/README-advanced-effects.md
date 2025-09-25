# Advanced Particle Effects Guide

## Blend Modes Overview

The lantern particle system now supports multiple THREE.js blend modes for different visual effects:

### Available Blend Modes

1. **AdditiveBlending** (Default)
   - Adds source and destination colors
   - Creates bright, glowing effects
   - Perfect for light sources and sparkles
   - Result: `source + destination`

2. **MultiplyBlending**
   - Multiplies source and destination colors
   - Creates darker, more subtle effects
   - Good for shadows or tinted effects
   - Result: `source * destination`

3. **SubtractiveBlending**
   - Subtracts source from destination
   - Creates darkening effects
   - Can create interesting negative light effects
   - Result: `destination - source`

4. **NormalBlending**
   - Standard alpha blending
   - Most natural transparency
   - Good for regular UI elements
   - Result: `source * alpha + destination * (1 - alpha)`

5. **NoBlending**
   - No blending, source replaces destination
   - Hard edges, no transparency
   - Rarely used for particles

6. **CustomBlending**
   - Allows custom blend equations
   - Advanced use cases only

## Configuration Examples

### Bright Sparkles (Additive)
```json
{
  "name": "bright_sparkle",
  "blendMode": "AdditiveBlending",
  "depthWrite": false,
  "alphaTest": 0.01,
  "growthSpeed": 2.0,
  "opacity": 0.8
}
```

### Subtle Glows (Multiply)
```json
{
  "name": "subtle_glow",
  "blendMode": "MultiplyBlending",
  "depthWrite": true,
  "alphaTest": 0.1,
  "growthSpeed": 1.5,
  "opacity": 0.6
}
```

## Core/Ray Opacity Differential

To achieve the effect where the core is bright but rays are dimmer (like in your wallpaper), you have several options:

### Method 1: Texture Design
Create a texture with:
- **Core**: High alpha (0.8-1.0) in the center
- **Rays**: Gradual alpha falloff (0.1-0.3) on the rays
- **Edges**: Very low alpha (0.0-0.1) at the tips

### Method 2: Dual Particle System
```json
{
  "name": "layered_effect",
  "coreParticle": {
    "blendMode": "AdditiveBlending",
    "scale": 0.3,
    "opacity": 1.0,
    "texture": "core.png"
  },
  "rayParticle": {
    "blendMode": "AdditiveBlending", 
    "scale": 1.0,
    "opacity": 0.4,
    "texture": "rays.png"
  }
}
```

### Method 3: Shader-Based (Advanced)
Custom shader material with radial opacity gradient:
```glsl
float distance = length(vUv - 0.5);
float core = 1.0 - smoothstep(0.0, 0.2, distance);
float rays = 1.0 - smoothstep(0.2, 0.5, distance);
float alpha = core + rays * 0.3;
```

## GSAP Integration

### Installation
```bash
npm install gsap
```

### Basic Usage
```javascript
import GSAPEffects from './js/gsap-effects.js';

const gsapEffects = new GSAPEffects();

// Animate particle with professional easing
gsapEffects.animateParticleWithGSAP(particle, {
  lifetime: 2.0,
  finalScale: 3.0,
  maxOpacity: 0.8,
  enableRotation: true
});
```

### Advanced Effects
```javascript
// Camera shake on particle burst
gsapEffects.createCameraShake(camera, 0.2, 0.5);

// Color transition
gsapEffects.animateColor(
  material,
  { r: 1, g: 0.6, b: 0.2 }, // From orange
  { r: 0.2, g: 0.6, b: 1 }, // To blue
  1.5 // Duration
);

// Staggered particle appearance
gsapEffects.staggerParticles(particles, {
  duration: 0.8,
  stagger: 0.1,
  ease: "back.out(1.7)"
});
```

## Performance Considerations

1. **Additive Blending**: Disable `depthWrite` for better performance
2. **Particle Count**: Limit active particles per system (3-10 recommended)
3. **Texture Size**: Use power-of-2 textures (128x128, 256x256)
4. **Alpha Test**: Use appropriate `alphaTest` values to avoid overdraw
5. **GSAP**: Use sparingly for hero effects, not every particle

## Debug Controls

The test effects interface now includes:
- **Blend Mode Dropdown**: Real-time blend mode switching
- **Live Updates**: Changes apply to existing particles
- **JSON Export**: Includes all new parameters

## Best Practices

1. **Start Simple**: Begin with AdditiveBlending for most effects
2. **Layer Effects**: Combine multiple blend modes for complex looks
3. **Test Performance**: Monitor FPS with particle count
4. **Texture Optimization**: Use efficient alpha channels
5. **Color Harmony**: Match particle colors to scene lighting

## Troubleshooting

**Problem**: Particles too bright/dark
**Solution**: Adjust `alphaTest` and `opacity` values

**Problem**: Poor performance
**Solution**: Reduce `count` and enable `depthWrite: false`

**Problem**: Particles don't blend well
**Solution**: Try different blend modes or adjust texture alpha

**Problem**: Core not bright enough
**Solution**: Use dual particle system or redesign texture with higher core alpha
