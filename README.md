# Images to A4 PDF Composer

This project uses **React + Konva + pdf-lib** so it can run as:
- a web app for fast iteration and iPhone Safari testing,
- an Android APK and iOS app later via Capacitor wrapping.

## Why this stack
- Simple to extend and debug compared to native dual-platform code.
- Touch-friendly drag/resize/rotate interactions with Konva.
- Reliable A4 PDF export for print workflows.

## Run locally
```bash
npm install
npm run dev
```

## Build
```bash
npm run build
```

## Current features
- Add multiple images.
- Move, resize, and rotate each image.
- Export composition as A4 PDF.
- Rotation slider and fine-tune buttons for selected image.
