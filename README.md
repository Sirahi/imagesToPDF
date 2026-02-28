# Images to A4 PDF Composer

Create an A4 print-ready PDF by placing photos on a touch-friendly canvas.

## How to use
1. Tap `Add Image` and pick one or more images.
2. Select and edit images:
   - `Move`: drag images directly.
   - `Stretch`: resize with side handles.
   - `Scale` slider: overall zoom.
   - `Rotation` slider: rotate `0` to `360`.
3. Optional snapping:
   - Use `Snap` toggle to enable/disable snapping.
   - When enabled, images snap to canvas edges/center and to other image edges/centers.
   - Purple guide lines show active alignment.
4. Delete options:
   - `Delete All` clears the canvas.
   - `Delete All` shows a confirmation dialog (`Yes`/`No`).
   - Trash-bin icon on selected image deletes that image.
5. Tap `Export A4 PDF` to generate and download.

## Notes
- Image center is constrained within canvas bounds to reduce accidental loss off-screen.
- Busy states are shown on canvas while importing images and exporting PDF.
- PDF export runs in a Web Worker to keep the UI responsive on mobile.
- Uploads are limited to `JPEG`, `PNG`, `WebP` with file-size and decoded-pixel safety limits.
- Security headers are configured via `public/_headers`.

## Local development
```bash
npm install
npm run dev
```

## Production build
```bash
npm run build
```
