# Images to A4 PDF Composer

Create an A4 print-ready PDF by placing photos on a touch-friendly canvas.

## How to use
1. Tap `Add image` and pick one or more images.
2. Tap an image to select it.
3. Use the mode switch:
   - `Move`: drag the selected image.
   - `Stretch`: resize using side handles.
4. Use sliders (visible when an image is selected):
   - `Scale`: zoom image size.
   - `Rotation`: rotate from `0` to `360`.
5. Tap `Export A4 PDF` to download the final file.

## Notes
- Image center is constrained to stay within the canvas so images are harder to lose off-screen.
- `Delete selected` removes the currently selected image.

## Local development
```bash
npm install
npm run dev
```

## Production build
```bash
npm run build
```
