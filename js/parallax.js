// Parallax Background Component
// Modular THREE.js-based parallax system for portfolio website

import * as THREE from 'https://unpkg.com/three@0.172.0/build/three.module.js';
import EffectManager from './effect-manager.js';

class SimpleParallax {
    constructor(backgroundName = 'bg2') {
        this.backgroundName = backgroundName;
        this.container = document.getElementById('parallax-container');
        this.canvas = document.getElementById('parallax-canvas');
        
        // Default configuration (will be overridden by JSON config)
        this.config = {
            image: `${backgroundName}.jpg`,
            depthMap: `${backgroundName}d.webp`,
            settings: {
                // === TIEFLING SETTINGS PANEL NAMES ===
                focus: 0.25,                    // Camera Movement (Strafe ↔ Rotate)
                baseMouseSensitivity: 0.5,     // Movement Range
                devicePixelRatio: 1.0,         // Render Quality (Performance ↔ Quality)
                expandDepthmapRadius: 7,        // Depth Map Expansion
                depthmapSize: 1024,            // Max. Depth Map Size (Blocky ↔ Detailed)
                
                // === OUR ADDITIONAL SETTINGS ===
                meshDepth: 1.0,                // Depth intensity multiplier
                easing: 0.05,                  // Movement smoothness
                edgeWidth: 0.02,               // Edge stiffness
                cameraZ: 1.4,                  // Camera distance
                extraScale: 1.2,               // Image scaling beyond viewport
                focalPoint: { x: 0.5, y: 0.5 }, // Image center when cropped
                mouseSensitivityFocusFactor: { min: 0.3, max: 0.7 }, // Dynamic sensitivity
                
                // === AUTO-MOVEMENT SETTINGS ===
                idleTimeout: 3000,              // Milliseconds before auto-movement starts
                autoMovementSpeed: 0.3,         // Speed of automatic movement (0-1)
                autoMovementRange: 0.5,         // Range of automatic movement
                autoMovementEnabled: true,      // Enable/disable automatic movement
                autoMovementCircleSpeed: 0.001, // Speed of circular movement (lower = slower)
                returnToCenterEasing: 0.08,     // Easing speed for return to center animation
                
                // === DEVICE ORIENTATION SETTINGS ===
                orientationSensitivity: 1.0,    // Sensitivity for device orientation (matches mouse 1:1 by default)
                orientationThreshold: 5,        // Minimum tilt angle to start movement (degrees)
                orientationMaxAngle: 30,        // Maximum tilt angle for full movement (degrees) - reduced for comfort
                orientationEnabled: true,       // Enable device orientation on mobile devices
                orientationFallbackToTouch: true // Fallback to touch if orientation not available
            }
        };
        
        // Mouse tracking
        this.mouseX = 0;
        this.mouseY = 0;
        this.targetX = 0;
        this.targetY = 0;
        this.easing = 0.05;
        
        // Device orientation tracking
        this.orientationX = 0;
        this.orientationY = 0;
        this.orientationSupported = false;
        this.orientationPermissionGranted = false;
        this.orientationPermissionRequested = false;
        this.orientationBaseline = null;
        this.orientationBaselineSamples = [];
        this.orientationDataReceived = false;
        this.orientationPromptEl = null;
        this.orientationPromptShown = false;
        this.orientationPromptDismissedKey = 'orientationPromptDismissed';
        
        // Device detection
        this.isTouchDevice = this.detectTouchDevice();
        this.isMobile = this.detectMobileDevice();
        this.useOrientation = this.isMobile; // Default to orientation on narrow touch devices
        
        // Lock mechanism for debugging
        this.isLocked = false;
        
        // Mouse leave and auto-movement tracking
        this.mouseOnScreen = true;
        this.lastMouseMoveTime = Date.now();
        this.autoMovementEnabled = true;
        this.autoMovementSpeed = 0.3; // Speed of automatic movement
        this.idleTimeout = 3000; // 3 seconds of inactivity before auto-movement starts
        this.returnToCenterEasing = 0.08; // Slightly faster easing for return to center
        
        // Effect system
        this.effectManager = null;
        
        // Mesh transformation tracking for effects synchronization
        this.meshTransform = {
            scale: 1.0,
            position: { x: 0, y: 0, z: 0 },
            baseGeometrySize: { width: 1, height: 1 }
        };
        
        // Cache canonical transform to avoid recalculation
        this.cachedCanonicalTransform = null;

        // Frame timing for time-based effects
        this.lastFrameTime = performance.now();
        
        this.init();
    }

    applyConfig() {
        // Apply configuration settings to instance variables
        const s = this.config.settings;
        this.imagePath = `./assets/ParallaxBackgrounds/${this.backgroundName}/${this.config.image}`;
        this.depthMapPath = `./assets/ParallaxBackgrounds/${this.backgroundName}/${this.config.depthMap}`;
        this.focus = s.focus;
        this.baseMouseSensitivity = s.baseMouseSensitivity;
        this.devicePixelRatio = this.resolveDevicePixelRatio();
        this.expandDepthmapRadius = s.expandDepthmapRadius;
        this.depthmapSize = s.depthmapSize;
        this.meshDepth = s.meshDepth;
        this.easing = s.easing;
        this.edgeWidth = s.edgeWidth;
        this.cameraZ = s.cameraZ;
        this.extraScale = s.extraScale || 1.2;
        this.focalPoint = s.focalPoint || { x: 0.5, y: 0.5 };
        this.mouseSensitivityFocusFactor = s.mouseSensitivityFocusFactor;
        
        // Auto-movement settings
        this.idleTimeout = s.idleTimeout || 3000;
        this.autoMovementSpeed = s.autoMovementSpeed || 0.3;
        this.autoMovementRange = s.autoMovementRange || 0.5;
        this.autoMovementEnabled = s.autoMovementEnabled !== false;
        this.autoMovementCircleSpeed = s.autoMovementCircleSpeed || 0.001;
        this.returnToCenterEasing = s.returnToCenterEasing || 0.08;
        
        // Device orientation settings (read from config file, with fallback defaults)
        this.orientationSensitivity = s.orientationSensitivity !== undefined ? s.orientationSensitivity : 1.0;
        this.orientationThreshold = s.orientationThreshold !== undefined ? s.orientationThreshold : 5;
        this.orientationMaxAngle = s.orientationMaxAngle !== undefined ? s.orientationMaxAngle : 30;
        this.orientationEnabled = s.orientationEnabled !== false;
        this.orientationFallbackToTouch = s.orientationFallbackToTouch !== false;
    }

    getDeviceBucket() {
        const width = window.innerWidth;
        if (width < 768) return 'mobile';
        if (width < 1024) return 'tablet';
        return 'desktop';
    }

    resolveDevicePixelRatio() {
        const settings = this.config?.settings || {};
        const configured = settings.devicePixelRatio;
        const nativeDpr = window.devicePixelRatio || 1;

        if (typeof configured === 'number' && Number.isFinite(configured)) {
            return configured;
        }

        let target = nativeDpr;
        let min = null;
        let max = null;

        if (configured && typeof configured === 'object') {
            if (typeof configured.min === 'number' && Number.isFinite(configured.min)) {
                min = configured.min;
            }
            if (typeof configured.max === 'number' && Number.isFinite(configured.max)) {
                max = configured.max;
            }

            if (configured.mode === 'autoScaleWidth') {
                const width = Math.max(1, window.innerWidth);
                const widthRange = this.getWidthRange(configured);
                const range = Math.max(1, widthRange.max - widthRange.min);
                const rampPercentLow = typeof configured.rampPercentLow === 'number' && Number.isFinite(configured.rampPercentLow)
                    ? Math.min(Math.max(configured.rampPercentLow, 0), 0.49)
                    : (typeof configured.rampPercent === 'number' && Number.isFinite(configured.rampPercent)
                        ? Math.min(Math.max(configured.rampPercent, 0), 0.49)
                        : 0.2);
                const rampPercentHigh = typeof configured.rampPercentHigh === 'number' && Number.isFinite(configured.rampPercentHigh)
                    ? Math.min(Math.max(configured.rampPercentHigh, 0), 0.49)
                    : (typeof configured.rampPercent === 'number' && Number.isFinite(configured.rampPercent)
                        ? Math.min(Math.max(configured.rampPercent, 0), 0.49)
                        : 0.2);
                const rampLow = range * rampPercentLow;
                const rampHigh = range * rampPercentHigh;
                const lowMaxWidth = widthRange.min + rampLow;
                const highMinWidth = widthRange.max - rampHigh;

                let t;
                if (width <= lowMaxWidth) {
                    t = 1;
                } else if (width >= highMinWidth) {
                    t = 0;
                } else {
                    t = 1 - (width - lowMaxWidth) / Math.max(1, highMinWidth - lowMaxWidth);
                }

                t = this.applyDprEasing(t, configured);
                target = min + (max - min) * t;
            } else if (configured.mode === 'autoScale' || configured.autoScale === true) {
                const viewportPixels = Math.max(1, window.innerWidth * window.innerHeight);
                const referencePixels = this.getReferencePixels(configured);
                const exponent = typeof configured.exponent === 'number' && Number.isFinite(configured.exponent)
                    ? configured.exponent
                    : 0.5;
                const base = typeof configured.base === 'number' && Number.isFinite(configured.base)
                    ? configured.base
                    : 1;
                const scale = Math.pow(referencePixels / viewportPixels, exponent);
                target = base * scale;
            } else {
                const bucket = this.getDeviceBucket();
                if (typeof configured[bucket] === 'number' && Number.isFinite(configured[bucket])) {
                    target = configured[bucket];
                } else if (typeof configured.value === 'number' && Number.isFinite(configured.value)) {
                    target = configured.value;
                } else if (configured.auto === true) {
                    target = nativeDpr;
                }
            }
        } else {
            // Default behavior: clamp high-DPI to protect performance
            min = 1;
            max = 2;
        }

        if (typeof min === 'number') {
            target = Math.max(target, min);
        }
        if (typeof max === 'number') {
            target = Math.min(target, max);
        }

        return Number.isFinite(target) ? target : 1;
    }

    applyDprEasing(t, configured) {
        const easing = configured?.easing;
        if (easing === 'smoothstep') {
            return t * t * (3 - 2 * t);
        }
        if (easing === 'smootherstep') {
            return t * t * t * (t * (t * 6 - 15) + 10);
        }
        return t;
    }

    getReferencePixels(configured) {
        if (typeof configured?.referencePixels === 'number' && Number.isFinite(configured.referencePixels)) {
            return configured.referencePixels;
        }

        const ref = configured?.referenceResolution || this.config?.settings?.referenceViewport;
        if (ref && typeof ref.width === 'number' && typeof ref.height === 'number') {
            const pixels = ref.width * ref.height;
            if (Number.isFinite(pixels) && pixels > 0) {
                return pixels;
            }
        }

        return 1920 * 1080;
    }

    getWidthRange(configured) {
        const range = configured?.widthRange;
        if (range && typeof range.min === 'number' && typeof range.max === 'number') {
            return {
                min: Math.max(1, range.min),
                max: Math.max(range.min + 1, range.max)
            };
        }

        const ref = this.config?.settings?.referenceViewport;
        if (ref && typeof ref.width === 'number') {
            const max = Math.max(1, ref.width);
            const min = Math.max(1, Math.round(max * 0.2));
            return { min, max };
        }

        return { min: 360, max: 1920 };
    }

    extractImageName(imagePath) {
        // Extract filename from path (handle both relative and absolute paths)
        const filename = imagePath.split('/').pop();
        // Remove file extension
        const nameWithoutExt = filename.replace(/\.[^/.]+$/, '');
        return nameWithoutExt;
    }

    async loadConfig() {
        try {
            const configPath = `./assets/ParallaxBackgrounds/${this.backgroundName}/config.json`;
            console.log(`Looking for config file: ${configPath}`);
            
            const response = await fetch(configPath);
            if (response.ok) {
                const configData = await response.json();
                console.log('Loaded config:', configData);
                
                // Merge loaded config with defaults
                this.config = { ...this.config, ...configData };
                this.applyConfig();
                
            } else {
                console.log(`No config file found at ${configPath}, using defaults`);
            }
        } catch (error) {
            console.log('Error loading config, using defaults:', error);
        }
    }

    detectMobileDevice() {
        // Use width-based breakpoints for tilt on small touch devices
        const isSmallViewport = window.innerWidth < 768;
        return this.isTouchDevice && isSmallViewport;
    }

    detectTouchDevice() {
        return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    }

    isIOSDevice() {
        return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    }

    shouldShowOrientationPrompt() {
        const needsPermission = typeof DeviceOrientationEvent !== 'undefined' &&
            typeof DeviceOrientationEvent.requestPermission === 'function';
        const dismissed = sessionStorage.getItem(this.orientationPromptDismissedKey) === 'true';
        return this.isMobile && this.useOrientation && this.orientationEnabled &&
            this.isIOSDevice() && needsPermission && !this.orientationPermissionGranted && !dismissed;
    }

    createOrientationPrompt() {
        if (this.orientationPromptEl) return;

        const overlay = document.createElement('div');
        overlay.id = 'orientation-permission-prompt';
        overlay.style.position = 'fixed';
        overlay.style.left = '0';
        overlay.style.top = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.style.background = 'rgba(0, 0, 0, 0.55)';
        overlay.style.zIndex = '9999';

        const panel = document.createElement('div');
        panel.style.maxWidth = '320px';
        panel.style.padding = '16px 18px';
        panel.style.borderRadius = '10px';
        panel.style.background = 'rgba(20, 20, 20, 0.95)';
        panel.style.color = '#fff';
        panel.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
        panel.style.fontSize = '14px';
        panel.style.textAlign = 'center';
        panel.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.35)';

        const title = document.createElement('div');
        title.textContent = 'Enable Tilt Controls';
        title.style.fontSize = '16px';
        title.style.fontWeight = '600';
        title.style.marginBottom = '8px';

        const body = document.createElement('div');
        body.textContent = 'Tap to allow device motion so the background can tilt.';
        body.style.marginBottom = '12px';

        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Enable Tilt';
        button.style.border = '0';
        button.style.padding = '8px 14px';
        button.style.borderRadius = '6px';
        button.style.background = '#ffb347';
        button.style.color = '#111';
        button.style.fontWeight = '600';
        button.style.cursor = 'pointer';

        button.addEventListener('click', async () => {
            if (this.orientationPermissionRequested) return;
            this.orientationPermissionRequested = true;
            sessionStorage.setItem(this.orientationPromptDismissedKey, 'true');
            await this.requestOrientationPermission();
            this.hideOrientationPrompt();
        });

        panel.appendChild(title);
        panel.appendChild(body);
        panel.appendChild(button);
        overlay.appendChild(panel);
        document.body.appendChild(overlay);
        this.orientationPromptEl = overlay;
    }

    showOrientationPrompt() {
        if (this.orientationPromptShown) return;
        this.createOrientationPrompt();
        this.orientationPromptShown = true;
    }

    hideOrientationPrompt() {
        if (this.orientationPromptEl) {
            this.orientationPromptEl.remove();
            this.orientationPromptEl = null;
        }
        this.orientationPromptShown = false;
    }

    maybeShowOrientationPrompt() {
        if (this.shouldShowOrientationPrompt()) {
            this.showOrientationPrompt();
        } else if (this.orientationPromptShown) {
            this.hideOrientationPrompt();
        }
    }

    updateInputModeFromViewport() {
        const wasMobile = this.isMobile;
        this.isTouchDevice = this.detectTouchDevice();
        this.isMobile = this.detectMobileDevice();
        this.useOrientation = this.isMobile && this.orientationEnabled;
        
        if (!this.isMobile) {
            // Clear baseline when switching away from tilt mode
            this.orientationBaseline = null;
            this.orientationBaselineSamples = [];
        }
        
        if (wasMobile !== this.isMobile) {
            console.log(`Input mode updated: ${this.isMobile ? 'tilt (mobile)' : 'mouse/touch (tablet/desktop)'}`);
        }

        if (this.isMobile && this.orientationEnabled) {
            const needsPermission = typeof DeviceOrientationEvent !== 'undefined' &&
                typeof DeviceOrientationEvent.requestPermission === 'function';
            if (!needsPermission && !this.orientationPermissionGranted) {
                this.requestOrientationPermission();
            }
            this.maybeShowOrientationPrompt();
        }
    }

    async requestOrientationPermission() {
        // For iOS 13+ and other browsers that require permission
        if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
            try {
                const permission = await DeviceOrientationEvent.requestPermission();
                this.orientationPermissionGranted = permission === 'granted';
                
                if (this.orientationPermissionGranted) {
                    console.log('Device orientation permission granted');
                    this.setupOrientationListeners();
                    this.hideOrientationPrompt();
                } else {
                    console.log('Device orientation permission denied');
                    this.handleOrientationFallback();
                    this.hideOrientationPrompt();
                }
            } catch (error) {
                console.log('Error requesting orientation permission:', error);
                this.handleOrientationFallback();
                this.hideOrientationPrompt();
            }
        } else if (typeof DeviceOrientationEvent !== 'undefined') {
            // Older browsers or Android - no permission needed
            this.orientationPermissionGranted = true;
            this.orientationSupported = true;
            console.log('Device orientation available without permission');
            this.setupOrientationListeners();
        } else {
            console.log('Device orientation not supported');
            this.handleOrientationFallback();
        }
    }

    setupOrientationListeners() {
        if (!this.orientationPermissionGranted) return;
        
        console.log('Setting up device orientation listeners');
        this.orientationBaseline = null;
        this.orientationBaselineSamples = [];
        
        window.addEventListener('deviceorientation', (event) => {
            if (this.isLocked || !this.useOrientation) return;
            
            // Handle device orientation
            this.handleDeviceOrientation(event);
        }, true);
        
        // Test if we're actually getting orientation data
        setTimeout(() => {
            if (!this.orientationDataReceived) {
                console.log('No orientation data received, falling back to touch');
                this.handleOrientationFallback();
            } else {
                this.orientationSupported = true;
                console.log('Device orientation working correctly');
            }
        }, 2000);
    }

    handleDeviceOrientation(event) {
        // Get orientation values
        const { alpha, beta, gamma } = event;
        
        // Skip if values are null (some browsers)
        if (beta === null || gamma === null) return;
        this.orientationDataReceived = true;

        // Initialize baseline from first few samples (normal viewing angle)
        if (!this.orientationBaseline) {
            this.orientationBaselineSamples.push({ beta, gamma });
            if (this.orientationBaselineSamples.length < 8) {
                return;
            }
            const sampleCount = this.orientationBaselineSamples.length;
            const avg = this.orientationBaselineSamples.reduce(
                (acc, sample) => {
                    acc.beta += sample.beta;
                    acc.gamma += sample.gamma;
                    return acc;
                },
                { beta: 0, gamma: 0 }
            );
            this.orientationBaseline = {
                beta: avg.beta / sampleCount,
                gamma: avg.gamma / sampleCount
            };
            this.orientationBaselineSamples = [];
        }
        
        // Store raw values for debugging
        this.orientationAlpha = alpha;
        this.orientationBeta = beta;
        this.orientationGamma = gamma;
        
        // Map gamma (left-right tilt) to X movement (-90 to +90 degrees)
        // Map beta (front-back tilt) to Y movement (we want -90 to +90 range)
        
        // Normalize gamma: -90 to +90 -> -1 to +1
        const adjustedGamma = gamma - (this.orientationBaseline?.gamma || 0);
        let normalizedX = Math.max(-1, Math.min(1, adjustedGamma / this.orientationMaxAngle));
        
        // Normalize beta: we want forward tilt (negative beta) to move up
        // Beta ranges from -180 to 180, but we care about -90 to +90
        let adjustedBeta = beta - (this.orientationBaseline?.beta || 0);
        if (adjustedBeta > 90) adjustedBeta = 180 - adjustedBeta;
        if (adjustedBeta < -90) adjustedBeta = -180 - adjustedBeta;
        
        let normalizedY = Math.max(-1, Math.min(1, -adjustedBeta / this.orientationMaxAngle));
        
        // Apply threshold - only move if tilt exceeds minimum angle
        const thresholdX = this.orientationThreshold / this.orientationMaxAngle;
        const thresholdY = this.orientationThreshold / this.orientationMaxAngle;
        
        if (Math.abs(normalizedX) < thresholdX) normalizedX = 0;
        if (Math.abs(normalizedY) < thresholdY) normalizedY = 0;
        
        // Apply orientation sensitivity (but keep it reasonable to work with existing mouse sensitivity)
        // The orientation sensitivity should be more like a multiplier rather than direct replacement
        this.orientationX = normalizedX * this.orientationSensitivity;
        this.orientationY = normalizedY * this.orientationSensitivity;
        
        // Update last move time to prevent auto-movement
        this.lastMouseMoveTime = Date.now();
        this.mouseOnScreen = true; // Treat orientation as "mouse on screen"
    }

    handleOrientationFallback() {
        if (this.orientationFallbackToTouch && this.isMobile) {
            console.log('Using touch controls as fallback');
            this.useOrientation = false;
            // Touch events are already set up in setupEventListeners()
        } else {
            console.log('No orientation or touch fallback available');
        }
    }

    async init() {
        // Load configuration first (with default image path)
        await this.loadConfig();
        this.updateInputModeFromViewport();
        
        // Initialize Three.js
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.z = 4;
        
        this.renderer = new THREE.WebGLRenderer({ 
            canvas: this.canvas,
            antialias: true, 
            preserveDrawingBuffer: true, 
            alpha: true 
        });
        this.renderer.outputEncoding = THREE.sRGBEncoding;
        this.renderer.setPixelRatio(this.devicePixelRatio);
        this.renderer.setSize(window.innerWidth, window.innerHeight);

        // Load image and depth map
        await this.loadImageAndDepthMap();
        
        // Effect manager: load in background so first paint isn't blocked
        console.log('SimpleParallax: Initializing effect manager');
        this.effectManager = new EffectManager(this.scene, this.camera, this.renderer, this);
        this.effectManager.loadEffects(); // don't await — show scene immediately, effects attach when ready
        
        // Setup input event listeners
        this.setupEventListeners();
        
        // Setup device orientation if on mobile
        if (this.isMobile && this.orientationEnabled) {
            console.log('Mobile device detected, setting up orientation controls');
            const needsPermission = typeof DeviceOrientationEvent !== 'undefined' &&
                typeof DeviceOrientationEvent.requestPermission === 'function';
            if (!needsPermission) {
                await this.requestOrientationPermission();
            } else {
                console.log('Orientation permission requires user gesture; waiting for touch');
            }
        } else {
            console.log('Desktop/tablet detected, using mouse/touch controls');
        }
        
        // Start animation loop immediately (effects update as they finish loading)
        this.animate();
    }

    async loadImageAndDepthMap() {
        // Store the image path for config loading
        this.imagePath = `./assets/ParallaxBackgrounds/${this.backgroundName}/${this.config.image}`;
        
        // Load the main image
        const textureLoader = new THREE.TextureLoader();
        const imagePromise = new Promise(resolve => {
            textureLoader.load(this.imagePath, texture => {
                texture.encoding = THREE.sRGBEncoding;
                this.imageTexture = texture;
                this.imageAspectRatio = texture.image.width / texture.image.height;
                resolve();
            });
        });

        // Load the depth map
        const depthPromise = new Promise(resolve => {
            const img = new Image();
            img.src = this.depthMapPath;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                this.depthData = ctx.getImageData(0, 0, canvas.width, canvas.height);

                // Expand depth map to fill in gaps
                if (this.expandDepthmapRadius > 0) {
                    this.depthData = this.expandDepthMap(this.depthData, this.expandDepthmapRadius);
                }

                resolve();
            };
        });

        await Promise.all([imagePromise, depthPromise]);
        
        // Create the 3D mesh
        this.createMesh();
    }

    expandDepthMap(imageData, radius) {
        const width = imageData.width;
        const height = imageData.height;
        const src = imageData.data;
        const dst = new Uint8ClampedArray(src);

        for (let r = 0; r < radius; r++) {
            for (let y = 1; y < height-1; y++) {
                for (let x = 1; x < width-1; x++) {
                    const idx = (y * width + x) * 4;
                    const currentDepth = src[idx];

                    if (currentDepth < 10) continue;

                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            const nIdx = ((y + dy) * width + (x + dx)) * 4;
                            if (src[nIdx] < currentDepth) {
                                dst[nIdx] = currentDepth;
                                dst[nIdx + 1] = currentDepth;
                                dst[nIdx + 2] = currentDepth;
                            }
                        }
                    }
                }
            }
            src.set(dst);
        }
        return new ImageData(dst, width, height);
    }

    createMesh() {
        const geometry = this.createGeometry(
            Math.min(this.depthmapSize, this.depthData.width),
            Math.min(this.depthmapSize, this.depthData.height),
            this.depthData
        );

        this.uniforms = {
            map: { value: this.imageTexture },
            mouseDelta: { value: new THREE.Vector2(0, 0) },
            focus: { value: this.focus },
            meshDepth: { value: this.meshDepth },
            sensitivity: { value: this.baseMouseSensitivity },
            edgeWidth: { value: this.edgeWidth }
        };

        const material = new THREE.ShaderMaterial({
            vertexShader: this.getDisplacementVertexShader(),
            fragmentShader: `
                uniform sampler2D map;
                varying vec2 vUv;

                void main() {
                    gl_FragColor = texture2D(map, vUv);
                }
            `,
            uniforms: this.uniforms,
            side: THREE.DoubleSide
        });

        this.mesh = new THREE.Mesh(geometry, material);

        // Scale mesh to maintain aspect ratio but crop/zoom to fill viewport
        const containerAspect = window.innerWidth / window.innerHeight;
        const imageAspect = this.depthData.width / this.depthData.height;
        const visibleHeight = 2 * Math.tan(THREE.MathUtils.degToRad(45/2)) * this.camera.position.z;
        const visibleWidth = visibleHeight * this.camera.aspect;

        // Calculate scale to fill viewport (cover behavior - crop instead of shrink)
        let baseScale;
        if (containerAspect > imageAspect) {
            // Viewport is wider than image - scale by width to fill horizontally
            baseScale = visibleWidth / geometry.parameters.width;
        } else {
            // Viewport is taller than image - scale by height to fill vertically
            baseScale = visibleHeight / geometry.parameters.height;
        }

        // Add extra scale to ensure image is larger than viewport
        // This prevents black bars and ensures we never see edges during panning
        const finalScale = baseScale * this.extraScale;

        this.mesh.scale.set(finalScale, finalScale, 1);

        // Position mesh based on focal point
        this.positionMeshByFocalPoint(finalScale, visibleWidth, visibleHeight);
        
        // Update mesh transform tracking for effects
        this.updateMeshTransform(finalScale);
        
        // Cache canonical transform for performance
        this.cacheCanonicalTransform();

        this.scene.add(this.mesh);
    }

    createGeometry(width, height, depthData) {
        const imageAspect = depthData.width / depthData.height;
        const geometry = new THREE.PlaneGeometry(
            imageAspect,
            1,
            width - 1,
            height - 1
        );

        const vertices = geometry.attributes.position.array;
        const uvs = geometry.attributes.uv.array;
        const depths = new Float32Array(vertices.length / 3);

        // First pass: compute initial depths and positions
        for (let i = 0; i < vertices.length; i += 3) {
            const uvIndex = (i / 3) * 2;
            const u = Math.min(1, Math.max(0, uvs[uvIndex]));
            const v = Math.min(1, Math.max(0, uvs[uvIndex + 1]));

            const x = Math.floor(u * (depthData.width - 1));
            const y = Math.floor((1 - v) * (depthData.height - 1));

            const pixelIndex = (y * depthData.width + x) * 4;
            let depthValue = 0;
            
            if (pixelIndex + 3 < depthData.data.length) {
                depthValue = depthData.data[pixelIndex] / 255;
            }

            depths[i/3] = depthValue;
        }

        // Set depth attribute before modifying vertices
        geometry.setAttribute('depth', new THREE.BufferAttribute(depths, 1));
        
        // Second pass: modify vertices based on depth
        for (let i = 0; i < vertices.length; i += 3) {
            const depthValue = depths[i/3];
            const z = depthValue * 1; // meshDepth
            const scaleFactor = (4 - z) / 4;

            vertices[i] *= scaleFactor;
            vertices[i + 1] *= scaleFactor;
            vertices[i + 2] = z;
        }

        // Mark attributes as needing update
        geometry.attributes.position.needsUpdate = true;
        geometry.computeVertexNormals();
        return geometry;
    }

    positionMeshByFocalPoint(finalScale, visibleWidth, visibleHeight) {
        // Calculate the scaled mesh dimensions
        const scaledMeshWidth = this.mesh.geometry.parameters.width * finalScale;
        const scaledMeshHeight = this.mesh.geometry.parameters.height * finalScale;

        // Calculate how much the mesh extends beyond the visible area
        const overflowX = scaledMeshWidth - visibleWidth;
        const overflowY = scaledMeshHeight - visibleHeight;

        // Calculate offset to position the focal point at the center of the viewport
        // focalPoint.x = 0.0 means left edge, 1.0 means right edge
        // focalPoint.y = 0.0 means bottom edge, 1.0 means top edge
        const offsetX = (0.5 - this.focalPoint.x) * overflowX;
        const offsetY = (0.5 - this.focalPoint.y) * overflowY;

        this.mesh.position.set(offsetX, offsetY, 0);
    }

    setupEventListeners() {
        // Attempt orientation permission on first user gesture (iOS requirement)
        document.addEventListener('touchstart', async () => {
            if (!this.isMobile || !this.useOrientation || !this.orientationEnabled) return;
            if (this.orientationPermissionGranted || this.orientationPermissionRequested) return;
            this.orientationPermissionRequested = true;
            await this.requestOrientationPermission();
        }, { passive: true });

        // Mouse movement (always enabled for desktop, disabled for mobile if orientation is working)
        document.addEventListener('mousemove', (event) => {
            // Skip mouse tracking if locked or if mobile is using orientation
            if (this.isLocked || (this.isMobile && this.useOrientation && this.orientationSupported)) return;
            
            this.mouseOnScreen = true;
            this.lastMouseMoveTime = Date.now();
            
            const rect = this.container.getBoundingClientRect();
            this.mouseX = Math.min(1, Math.max(-1, (event.clientX - rect.left) / window.innerWidth * 2 - 1));
            this.mouseY = Math.min(1, Math.max(-1, (event.clientY - rect.top) / window.innerHeight * 2 - 1));
            this.mouseX = -this.mouseX;
        });

        // Mouse leave detection (only relevant for desktop)
        document.addEventListener('mouseleave', () => {
            if (!this.isMobile || !this.useOrientation) {
                this.mouseOnScreen = false;
                this.resetToCenter();
            }
        });

        // Mouse enter detection (only relevant for desktop)
        document.addEventListener('mouseenter', () => {
            if (!this.isMobile || !this.useOrientation) {
                this.mouseOnScreen = true;
                this.lastMouseMoveTime = Date.now();
            }
        });

        // Touch support (enabled for mobile when not using orientation, or as fallback)
        document.addEventListener('touchmove', (event) => {
            // Skip touch tracking if locked or if orientation is being used
            if (this.isLocked || (this.useOrientation && this.orientationSupported)) return;
            
            this.mouseOnScreen = true;
            this.lastMouseMoveTime = Date.now();
            
            const touch = event.touches[0];
            const rect = this.container.getBoundingClientRect();
            this.mouseX = Math.min(1, Math.max(-1, (touch.clientX - rect.left) / window.innerWidth * 2 - 1));
            this.mouseY = Math.min(1, Math.max(-1, (touch.clientY - rect.top) / window.innerHeight * 2 - 1));
            this.mouseX = -this.mouseX;
        });
        
        // Touch end - reset to center for mobile touch controls
        document.addEventListener('touchend', () => {
            if (this.isTouchDevice && !this.useOrientation) {
                this.mouseOnScreen = false;
                this.resetToCenter();
            }
        });

        // Window resize
        window.addEventListener('resize', () => {
            this.updateInputModeFromViewport();
            const nextPixelRatio = this.resolveDevicePixelRatio();
            if (this.devicePixelRatio !== nextPixelRatio) {
                this.devicePixelRatio = nextPixelRatio;
                this.renderer.setPixelRatio(this.devicePixelRatio);
            }
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
            
            // Recalculate scaling to maintain cover behavior
            if (this.mesh) {
                const containerAspect = window.innerWidth / window.innerHeight;
                const imageAspect = this.depthData.width / this.depthData.height;
                const visibleHeight = 2 * Math.tan(THREE.MathUtils.degToRad(45/2)) * this.camera.position.z;
                const visibleWidth = visibleHeight * this.camera.aspect;

                let baseScale;
                if (containerAspect > imageAspect) {
                    // Viewport is wider than image - scale by width to fill horizontally
                    baseScale = visibleWidth / this.mesh.geometry.parameters.width;
                } else {
                    // Viewport is taller than image - scale by height to fill vertically
                    baseScale = visibleHeight / this.mesh.geometry.parameters.height;
                }

                const finalScale = baseScale * this.extraScale;
                this.mesh.scale.set(finalScale, finalScale, 1);
                
                // Reposition mesh based on focal point
                this.positionMeshByFocalPoint(finalScale, visibleWidth, visibleHeight);
                
        // Update mesh transform tracking and notify effects
        this.updateMeshTransform(finalScale);
        this.updateEffectPositions();
        
        // Cache canonical transform for performance
        this.cacheCanonicalTransform();
            }
        });
    }

    resetToCenter() {
        // Don't instantly reset - let the animate loop handle smooth transition
        // Just clear the mouse input values
        this.mouseX = 0;
        this.mouseY = 0;
    }

    updateAutoMovement() {
        // Skip auto-movement if locked or disabled
        if (!this.autoMovementEnabled || this.isLocked) return;
        
        const currentTime = Date.now();
        const timeSinceLastMove = currentTime - this.lastMouseMoveTime;
        
        // Start auto-movement if idle for too long (regardless of mouse position)
        if (timeSinceLastMove > this.idleTimeout) {
            // Generate circular movement like Tiefling does
            const time = currentTime * this.autoMovementCircleSpeed;
            
            // Create circular movement pattern
            const radiusX = this.autoMovementRange;
            const radiusY = this.autoMovementRange;
            
            const autoX = Math.cos(time) * radiusX;
            const autoY = Math.sin(time) * radiusY;
            
            // Apply auto-movement to targets
            this.targetX += (autoX - this.targetX) * this.autoMovementSpeed * 0.01;
            this.targetY += (autoY - this.targetY) * this.autoMovementSpeed * 0.01;
        }
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        const now = performance.now();
        let deltaTime = (now - this.lastFrameTime) / 1000;
        this.lastFrameTime = now;
        if (deltaTime > 0.1) {
            deltaTime = 0.1;
        }

        // Update auto-movement
        this.updateAutoMovement();

        // Handle input based on device type and available methods
        if (!this.isLocked) {
            if (this.isMobile && this.useOrientation && this.orientationSupported) {
                // Use device orientation for mobile - apply same sensitivity system as mouse
                const mouseSensitivityFocusFactor = this.mouseSensitivityFocusFactor.min + 
                    (this.mouseSensitivityFocusFactor.max - this.mouseSensitivityFocusFactor.min) * 2 * this.focus;
                const orientationInputX = this.orientationX * mouseSensitivityFocusFactor * this.baseMouseSensitivity;
                const orientationInputY = this.orientationY * mouseSensitivityFocusFactor * this.baseMouseSensitivity;
                this.targetX += (orientationInputX - this.targetX) * this.easing;
                this.targetY += (orientationInputY - this.targetY) * this.easing;
            } else if (this.mouseOnScreen) {
                // Use mouse/touch movement
                const mouseSensitivityFocusFactor = this.mouseSensitivityFocusFactor.min + 
                    (this.mouseSensitivityFocusFactor.max - this.mouseSensitivityFocusFactor.min) * 2 * this.focus;
                this.targetX += (mouseSensitivityFocusFactor * this.mouseX * this.baseMouseSensitivity - this.targetX) * this.easing;
                this.targetY += (mouseSensitivityFocusFactor * this.mouseY * this.baseMouseSensitivity - this.targetY) * this.easing;
            } else {
                // Return to center when no input is active
                this.targetX += (0 - this.targetX) * this.returnToCenterEasing;
                this.targetY += (0 - this.targetY) * this.returnToCenterEasing;
            }
        }

        if (this.mesh && this.uniforms && this.uniforms.mouseDelta) {
            this.uniforms.mouseDelta.value.set(this.targetX, -this.targetY);
        }

        // Update effects (safe when still loading — only already-loaded effects are updated)
        if (this.effectManager) {
            this.effectManager.update(deltaTime);
        }

        this.renderer.render(this.scene, this.camera);
    }
    
    // Update mesh transformation tracking
    updateMeshTransform(scale) {
        if (this.mesh) {
            this.meshTransform.scale = scale;
            this.meshTransform.position.x = this.mesh.position.x;
            this.meshTransform.position.y = this.mesh.position.y;
            this.meshTransform.position.z = this.mesh.position.z;
            this.meshTransform.baseGeometrySize.width = this.mesh.geometry.parameters.width;
            this.meshTransform.baseGeometrySize.height = this.mesh.geometry.parameters.height;
            
            console.log('SimpleParallax: Updated mesh transform tracking:', this.meshTransform);
        }
    }
    
    // Notify effects to update their positions based on mesh scaling
    updateEffectPositions() {
        if (this.effectManager && this.effectManager.effectInstances.length > 0) {
            console.log('SimpleParallax: Notifying effects of mesh transformation change');
            this.effectManager.effectInstances.forEach(effectInstance => {
                if (effectInstance.updatePositionsForMeshTransform) {
                    effectInstance.updatePositionsForMeshTransform(this.meshTransform);
                }
            });
        }
    }

    // --- Area Effects API (for overlay quads that sync with parallax mesh) ---

    /**
     * Returns a clone of the main mesh geometry, including the depth attribute.
     * Used by area effects (e.g. water ripple) to create overlay meshes with identical vertex displacement.
     * @returns {THREE.BufferGeometry|null} Cloned geometry, or null if mesh not ready
     */
    getEffectGeometryClone() {
        if (!this.mesh || !this.mesh.geometry) return null;
        return this.mesh.geometry.clone();
    }

    /**
     * Returns a coarse geometry for area effect overlays, with fewer segments than the main mesh.
     * Uses the same depth sampling and position modification as createGeometry, but with configurable segment count.
     * Significantly reduces vertex count for performance (e.g. 256x256 vs millions).
     * @param {number} [segmentsX=256] Segment count along X
     * @param {number} [segmentsY=256] Segment count along Y
     * @returns {THREE.BufferGeometry|null} Coarse geometry with depth attribute
     */
    getCoarseEffectGeometry(segmentsX = 256, segmentsY = 256) {
        if (!this.depthData) return null;
        const w = Math.max(2, Math.min(segmentsX, this.depthData.width));
        const h = Math.max(2, Math.min(segmentsY, this.depthData.height));
        return this.createGeometry(w, h, this.depthData);
    }

    /**
     * Returns shared references to the displacement uniforms used by the main mesh vertex shader.
     * Area effects must use these same objects so their overlay stays in sync with parallax movement.
     * @returns {Object|null} Object with mouseDelta, focus, meshDepth, sensitivity, edgeWidth
     */
    getDisplacementUniforms() {
        if (!this.uniforms) return null;
        return {
            mouseDelta: this.uniforms.mouseDelta,
            focus: this.uniforms.focus,
            meshDepth: this.uniforms.meshDepth,
            sensitivity: this.uniforms.sensitivity,
            edgeWidth: this.uniforms.edgeWidth
        };
    }

    /**
     * Returns the vertex shader source used for depth-based displacement.
     * Area effects must use this exact shader (with shared uniforms) for perfect alignment.
     * @returns {string} GLSL vertex shader source
     */
    getDisplacementVertexShader() {
        return `
            uniform vec2 mouseDelta;
            uniform float focus;
            uniform float meshDepth;
            uniform float sensitivity;
            uniform float edgeWidth;
            
            attribute float depth;
            
            varying vec2 vUv;
            
            void main() {
                vUv = uv;
                vec3 pos = position;
                
                float actualDepth = depth * meshDepth;
                float focusDepth = focus * meshDepth;
                float cameraZ = 1.4;
            
                // Rotational displacement (relative to focus depth)
                vec2 rotate = mouseDelta * sensitivity * 
                    (1.0 - focus) * 
                    (actualDepth - focusDepth) * 
                    vec2(-1.0, 1.0);
            
                // Calculate edge proximity factor (0 at edges, 1 in center)
                vec2 edgeFactorVec = smoothstep(0.0, edgeWidth, vUv) * 
                                    smoothstep(1.0, 1.0 - edgeWidth, vUv);
                float edgeFactor = edgeFactorVec.x * edgeFactorVec.y;
            
                // Apply displacement with edge preservation
                pos.xy += rotate * edgeFactor;
            
                gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
            }
        `;
    }

    // Cache canonical transform for performance optimization
    cacheCanonicalTransform() {
        if (!this.config.settings.referenceViewport) {
            return;
        }
        
        const referenceViewport = this.config.settings.referenceViewport;
        const REFERENCE_WIDTH = referenceViewport.width;
        const REFERENCE_HEIGHT = referenceViewport.height;
        
        // Calculate canonical transform once and cache it
        const containerAspect = REFERENCE_WIDTH / REFERENCE_HEIGHT;
        const imageAspect = this.depthData.width / this.depthData.height;
        const visibleHeight = 2 * Math.tan(THREE.MathUtils.degToRad(45/2)) * this.camera.position.z;
        const visibleWidth = visibleHeight * containerAspect;
        
        let baseScale;
        if (containerAspect > imageAspect) {
            baseScale = visibleWidth / this.mesh.geometry.parameters.width;
        } else {
            baseScale = visibleHeight / this.mesh.geometry.parameters.height;
        }
        
        const finalScale = baseScale * this.extraScale;
        const scaledMeshWidth = this.mesh.geometry.parameters.width * finalScale;
        const scaledMeshHeight = this.mesh.geometry.parameters.height * finalScale;
        const overflowX = scaledMeshWidth - visibleWidth;
        const overflowY = scaledMeshHeight - visibleHeight;
        const offsetX = (0.5 - this.focalPoint.x) * overflowX;
        const offsetY = (0.5 - this.focalPoint.y) * overflowY;
        
        this.cachedCanonicalTransform = {
            scale: finalScale,
            position: { x: offsetX, y: offsetY, z: 0 },
            baseGeometrySize: { 
                width: this.mesh.geometry.parameters.width,
                height: this.mesh.geometry.parameters.height
            }
        };
    }
    
    // Get cached canonical transform
    getCanonicalTransform() {
        return this.cachedCanonicalTransform;
    }
    
    // Lock/unlock methods for debugging
    lock() {
        this.isLocked = true;
        // Reset to center position immediately
        this.targetX = 0;
        this.targetY = 0;
        this.mouseX = 0;
        this.mouseY = 0;
        console.log('Parallax locked at center position');
    }
    
    unlock() {
        this.isLocked = false;
        console.log('Parallax movement unlocked');
    }
    
    // Method to cleanup resources
    destroy() {
        console.log('SimpleParallax: Destroying parallax instance');
        
        // Cleanup effects first
        if (this.effectManager) {
            this.effectManager.cleanup();
            this.effectManager = null;
        }
        
        // Cleanup THREE.js resources
        if (this.mesh) {
            this.scene.remove(this.mesh);
            if (this.mesh.geometry) this.mesh.geometry.dispose();
            if (this.mesh.material) this.mesh.material.dispose();
        }
        
        if (this.renderer) {
            this.renderer.dispose();
        }
        
        console.log('SimpleParallax: Cleanup complete');
    }
}

// Export for use in other modules
export default SimpleParallax;


