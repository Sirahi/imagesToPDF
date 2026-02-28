# Changelog

All notable changes to this project are documented in this file.

The format is based on Keep a Changelog.

## [Unreleased]

### Added
- Added strict in-canvas bounds so images cannot be dragged or resized outside the A4 page.
- Added explicit button intent colors:
  - Export button is green
  - Delete button is red.

### Changed
- Improved mobile stage sizing to fit available viewport width and height while preserving A4 aspect ratio.
- Removed the "Selected image" side panel to simplify the mobile workflow.

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
