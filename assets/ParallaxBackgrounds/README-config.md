# Tiefling Parallax Configuration System

This system allows you to customize the parallax behavior for each background image using JSON configuration files.

## How It Works

1. **Create a config file** for each image pair (e.g., `bg5-config.json`)
2. **Place it in the assets folder** alongside your image and depth map
3. **The app automatically loads** the configuration and applies the settings

## Configuration File Structure

```json
{
  "image": "bg5.jpg",
  "depthMap": "bg5d.webp", 
  "settings": {
    "focus": 0.25,
    "baseMouseSensitivity": 0.5,
    "devicePixelRatio": 1.0,
    "expandDepthmapRadius": 7,
    "meshResolution": 1024,
    "meshDepth": 1.0,
    "easing": 0.05,
    "edgeWidth": 0.02,
    "cameraZ": 1.4,
    "mouseSensitivityFocusFactor": {
      "min": 0.3,
      "max": 0.7
    }
  },
  "description": "Fantastical landscape with stained glass ruins - moderate parallax effect"
}
```

## Setting Explanations

### Core Parallax Settings
- **`focus`** (0.0 - 1.0): Camera movement type
  - `0.0` = Pure strafe movement (side-to-side)
  - `1.0` = Pure rotation movement (circular)
  - `0.25` = Mixed movement (recommended)

- **`baseMouseSensitivity`** (0.1 - 2.0): Overall movement sensitivity
  - `0.1` = Very subtle movement
  - `0.5` = Moderate movement (recommended)
  - `2.0` = Very dramatic movement

- **`meshDepth`** (0.1 - 3.0): Depth intensity multiplier
  - `0.5` = Subtle depth effect
  - `1.0` = Normal depth effect (recommended)
  - `2.0` = Strong depth effect

### Quality & Performance Settings
- **`depthmapSize`** (256 - 2048): Mesh detail level (Max. Depth Map Size)
  - `256` = Low quality, fast (Blocky & Fast)
  - `1024` = High quality, moderate speed (recommended)
  - `2048` = Very high quality, slow (Detailed & Slow)

- **`devicePixelRatio`** (0.5 - 2.0): Render quality (Performance ↔ Quality)
  - `0.5` = Lower quality, better performance
  - `1.0` = Standard quality (recommended)
  - `2.0` = High quality, may be slow

### Advanced Settings
- **`expandDepthmapRadius`** (0 - 20): Edge smoothing (Depth Map Expansion)
  - `0` = No smoothing
  - `7` = Moderate smoothing (recommended)
  - `15` = Heavy smoothing

- **`easing`** (0.01 - 0.2): Movement smoothness
  - `0.01` = Very smooth, slow response
  - `0.05` = Smooth, responsive (recommended)
  - `0.2` = Snappy, immediate response

- **`edgeWidth`** (0.01 - 0.1): Edge stiffness
  - `0.01` = Very stiff edges
  - `0.02` = Moderate edge stiffness (recommended)
  - `0.1` = Soft edges

- **`cameraZ`** (1.0 - 3.0): Camera distance
  - `1.0` = Close camera
  - `1.4` = Standard distance (recommended)
  - `3.0` = Far camera

- **`extraScale`** (1.0 - 2.0): Image scaling beyond viewport
  - `1.0` = Exact viewport size (may show edges)
  - `1.2` = 20% larger than viewport (recommended)
  - `1.5` = 50% larger than viewport (prevents all edge visibility)

- **`focalPoint`** (Object with `x`, `y` properties, 0.0 - 1.0): Defines the center of the image when cropped
  - `{ "x": 0.5, "y": 0.5 }` = Center of the image (default)
  - `{ "x": 0.0, "y": 0.5 }` = Left edge of the image
  - `{ "x": 1.0, "y": 0.5 }` = Right edge of the image
  - `{ "x": 0.5, "y": 0.0 }` = Bottom edge of the image
  - `{ "x": 0.5, "y": 1.0 }` = Top edge of the image

- **`mouseSensitivityFocusFactor`**: Dynamic sensitivity based on focus
  - `min` (0.1 - 0.5): Minimum sensitivity multiplier
  - `max` (0.5 - 1.0): Maximum sensitivity multiplier

## Usage Examples

### Subtle Parallax (for portraits)
```json
{
  "settings": {
    "focus": 0.1,
    "baseMouseSensitivity": 0.3,
    "meshDepth": 0.5,
    "expandDepthmapRadius": 10
  }
}
```

### Dramatic Parallax (for landscapes)
```json
{
  "settings": {
    "focus": 0.4,
    "baseMouseSensitivity": 0.8,
    "meshDepth": 1.5,
    "expandDepthmapRadius": 5
  }
}
```

### High Performance (for mobile)
```json
{
  "settings": {
    "meshResolution": 512,
    "devicePixelRatio": 0.8,
    "expandDepthmapRadius": 3
  }
}
```

## File Naming Convention

- Image: `bg5.jpg`
- Depth Map: `bg5d.webp` 
- Config: `bg5-config.json`

The app automatically looks for `bg5-config.json` when loading `bg5.jpg`.

## Tips

1. **Start with defaults** and adjust one setting at a time
2. **Test on different devices** - mobile may need lower settings
3. **Use descriptions** to remember what each config is for
4. **Backup your configs** - they're easy to recreate but save time
5. **Higher mesh resolution** = better quality but slower performance
6. **Lower expandDepthmapRadius** = sharper edges but more artifacts
