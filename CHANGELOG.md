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
- Added a reset (`↺`) control to restore selected image to:
  - scale 100%
  - rotation 0
  - original (unstretched) dimensions
  - centered position

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

### Fixed
- Fixed phone-photo orientation mismatch in exported PDFs by normalizing imported image pixels before rendering/export.

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
