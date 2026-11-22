# Jeff the PaintShark

An offline iPad art studio built after reverse-engineering Procreate 5.4.4: pressure and
tilt brushes, layers and blend modes, selections, warp, liquify, adjustments, text,
symmetry guides, time-lapse and document export.

Install it on an iPad: open the Pages URL in Safari, Share ▸ **Add to Home Screen**.
It runs standalone and offline; artwork stays on the device.

## Local dev

```bash
python -m http.server 8137 --bind 127.0.0.1 --directory .
```

Open <http://127.0.0.1:8137/>. Plain ES modules, no build step.

## Features

- Pencil pressure, tilt, azimuth; finger fallback; long-press eyedropper
- Stamp brush engine: shape, grain, scatter, spacing, taper, flow, wet mix, glaze, smudge
- Layers, groups, 25 blend modes, alpha lock, clipping and layer masks
- Rect/ellipse/freehand/auto selections with feather, boolean ops, fill
- Free transform + 8×8 warp mesh, liquify modes, 14 adjustments
- Text, drawing guides, symmetry, reference pane, time-lapse WebM export
- PNG/JPEG/WebP and `.paintshark` export, IndexedDB autosave gallery
- PWA manifest and offline service worker

## Notes

Not a byte-for-byte clone: no 3D painting, PSD/ABR import, `.procreate` round-trip or
Animation Assist timeline. Blend modes outside the native Canvas2D set run on the CPU.

Research notes: see the `re/` folder in the parent project.

Procreate is © Savage Interactive. This is an independent reimplementation.
