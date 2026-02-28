# Changelog

All notable changes to this project are documented in this file.

The format is based on Keep a Changelog.

## [Unreleased]

### Added
- Added explicit interaction modes for editing:
  - `Move` mode for drag-only positioning
  - `Scale/Rotate` mode for resize plus slider-based rotation
- Added a mode toggle switch UI with clear mode labeling.
- Added a rotation slider (`0-360`) with per-image cached rotation values.
- Added a reset control to restore selected image to:
  - scale 100%
  - rotation 0
  - original (unstretched) dimensions
  - centered position
- Added an in-canvas trash-bin icon at the selected image top-right for quick single-image delete.
- Added a custom in-app `Delete All` confirmation modal (`Yes`/`No`) to reduce accidental clears.

### Changed
- Updated selection boundary behavior to center-point constraints (image center cannot leave canvas).
- Improved mobile-first editing UX:
  - compacted top spacing and controls for more canvas area
  - removed transformer rotation handle in favor of slider-only rotation
  - kept move-mode selection outline visible while dragging
- Refined mode visuals:
  - move mode outline uses green dashed border
  - switch colors now indicate active mode (green for Move, blue for Scale/Rotate)
- Increased transform scale-handle size for easier touch interaction.
- Updated mode naming from `Scale/Rotate` label to `Stretch` for clearer non-technical wording.
- Kept scale and rotation sliders visible whenever an image is selected.
- Changed A4 canvas corners from rounded to square.
- Added edge snapping while moving images near canvas borders.
- Added center snapping guides (purple dashed lines) for canvas horizontal/vertical center alignment.
- Added smart snapping to other images (edge and center alignment), similar to Canva-style guides.
- Added a dedicated `Snap` toggle switch to enable/disable snapping and guide lines during move mode.
- Improved guide rendering so snapping lines draw above images for better visibility while dragging.
- Increased move-mode selection outline thickness for clearer active-image feedback.
- Updated drag interaction so images select and move in a single gesture.
- Updated toolbar controls to disable appropriately during import/export and destructive flows.

### Fixed
- Fixed phone-photo orientation mismatch in exported PDFs by normalizing imported image pixels before rendering/export.
- Fixed smart-snap guide jitter when two possible alignments compete during drag.
- Updated snap priority to prefer center-to-center alignment before edge matches.
- Fixed CSP-related export failures by removing `fetch(data:...)` from PDF image byte loading.
- Fixed several mobile UX/state issues around export and add/delete control behavior.
- Moved PDF generation to a Web Worker so export no longer blocks UI responsiveness.

### Security
- Restricted uploads to raster image formats only (`JPEG`, `PNG`, `WebP`) to reduce SVG/scriptable file attack surface.
- Added decoded-image pixel limit validation to block extremely large images that can cause memory/availability issues.
- Added Cloudflare Pages security headers via `public/_headers` (CSP, nosniff, frame-ancestors, permissions policy).

## [1.0.0] - 2026-02-28

### Added
- Initial public release of A4 Cake Decoration Composer.
- Upload one or more images and arrange them on an A4 canvas.
- Drag, resize, and rotate images before export.
- Export composition as an A4 PDF.
- Dev-only debugging panel for troubleshooting during development.

## How to maintain this file
- Add new work under `## [Unreleased]`.
- On each release, move those entries into a new version section:
  - `## [x.y.z] - YYYY-MM-DD`
- Prefer sections like `Added`, `Changed`, `Fixed`, `Removed`, `Security` only when they apply.
