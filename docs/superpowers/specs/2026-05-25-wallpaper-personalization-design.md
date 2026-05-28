# Wallpaper & Background Personalization

**Date:** 2026-05-25  
**Status:** Approved

## Overview

Replace the minimal "None / Pick image" background section in the Themes settings with a rich, tabbed personalization panel. Users get a curated gallery of built-in wallpapers, CSS gradient swatches, tint color overlay, and a film grain texture toggle — all without leaving the app.

## Architecture

### Data model changes

Extend `BackgroundKind` from `"none" | "image"` to:

```ts
type BackgroundKind = "none" | "image" | "builtin" | "gradient"
```

Add new preference fields:
- `backgroundTintColor: string | null` — hex color, e.g. `"#ff00ff"`, or null
- `backgroundTintOpacity: number` — 0–1, default 0
- `backgroundNoiseOpacity: number` — 0–1, default 0

`backgroundImageId` (already in store) doubles as:
- builtin wallpaper ID when `backgroundKind === "builtin"`
- gradient ID when `backgroundKind === "gradient"`

### New files

- `public/wallpapers/*.jpg` — 25 bundled images (~25KB each, 400×300 WebP/JPEG)
- `src/modules/theme/builtinWallpapers.ts` — registry: id, label, category, filename
- `src/modules/theme/builtinGradients.ts` — 15 CSS gradient strings with id/label/category

### Modified files

- `src/modules/settings/store.ts` — new kinds, new pref fields
- `src/modules/theme/SurfaceLayer.tsx` — render builtin/gradient/tint/noise via CSS vars
- `src/settings/sections/ThemesSection.tsx` — full background panel redesign
- `src/modules/theme/index.ts` — re-export new modules

## UI Design

The background section gets a tabbed layout:

```
[ Gallery ]  [ Gradients ]  [ Custom ]

[  img  ] [  img  ] [  img  ]    ← 3-col grid
[  img  ] [  img  ] [  img  ]
...

Category filter: All | Dark | Space | Nature | Abstract | Minimal | Neon

───────────────────────────────
Tint color   [ color swatch ] [ opacity slider ]
Noise        [ toggle ] [ intensity slider ]
Opacity      [ slider ]
Blur         [ slider ]
```

- Gallery tab: 25 image thumbnails in a 3-col scrollable grid, category chips above
- Gradients tab: 15 gradient swatches in same grid
- Custom tab: existing "Pick image" / "Remove" buttons
- Controls (tint, noise, opacity, blur) shown below tabs whenever background is active

## CSS variable approach

`SurfaceLayer` sets on `<html>`:

```
--_bg-url         image url or gradient string
--_bg-tint        rgba(r,g,b,opacity)
--_bg-noise       opacity value for noise texture
--_bg-opacity     
--_bg-blur        
```

The noise overlay is a small tiling SVG/PNG data-url that `globals.css` renders as a second pseudo-element `html::after`.

## Wallpaper sources

25 images from picsum.photos (Unsplash, CC0 licensed), downloaded at build time:
- 5 Dark architecture/moody
- 4 Space/cosmos
- 5 Nature (mountain, forest, ocean)
- 4 Abstract/colorful
- 4 Minimal/geometric
- 3 Neon/city night

Stored in `public/wallpapers/` as `{category}-{n}.jpg` at 400×300px (~20-30KB each = ~700KB total added to bundle).

## Gradient collection

15 pure-CSS gradients defined in TypeScript — aurora, sunset, ocean-deep, neon-pulse, forest-mist, cotton-candy, midnight, ember, arctic, synthwave, golden-hour, void, coral-reef, storm, sakura.

## Testing

- Visual: open Settings → Themes, cycle through all tabs and categories
- Switching background kinds clears the previous selection
- Tint + noise stack correctly over all background types
- Preferences persist across restarts
