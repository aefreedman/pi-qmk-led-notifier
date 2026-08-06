# Changelog

## 0.1.4 - 2026-08-06

### Added

- Initial npm release of the Pi QMK LED notifier, including QMK RAW HID LED notifications, configurable profiles, platform-aware Python launcher settings, and bounded per-session runtime state.

## 0.1.3 - 2026-07-24

### Changed

- Marked Pi-bundled core dependencies as optional peers so Pi git installs do not create redundant per-package `node_modules` directories.

## 0.1.2 - 2026-07-10

- Migrated Pi extension imports and peer dependencies to the `@earendil-works` package scope.

## 0.1.1 - 2026-07-09

- Select the Python launcher by platform in shipped installs, with environment and settings overrides that support explicit argument lists and empty arguments.
- Document Python and `hidapi` setup for Windows and macOS.
- Bound notifier subprocess timeouts with SIGTERM/SIGKILL escalation.
- Added macOS CI coverage for tests and package validation.
