# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.6] - 2026-05-20

### Fixed

- `cursor.user`, `cursor.user.email`, and `cursor.repo` now appear as attributes on all spans. Previously these fields were set in metrics labels but omitted from span attributes due to `buildGenAiBaseAttributes` not forwarding them.

### Changed

- Highlighted OTLP backend agnosticism in README — cursorscope works with any OTLP-compatible backend, not just Last9.

## [0.3.5] - 2026-05-19

### Changed

- OTLP auth token input is now masked with `*` during the `setup` prompt.

## [0.3.4] - 2026-05-19

### Fixed

- `cursorscope setup` now patches infrastructure keys (port, home, hook endpoint) in an existing `.env` file rather than overwriting unrelated user config.

## [0.3.3] - 2026-05-18

### Changed

- Default ingestor port changed from `8787` to `4327`.

## [0.3.2] - 2026-05-18

### Changed

- `cursorscope` invoked with no arguments now defaults to `setup --last9` for a faster onboarding flow.

## [0.3.1] - 2026-05-17

### Added

- `CURSOR_MASK_USER_EMAIL` flag (default `false`) — when enabled, masks user email in all telemetry.
- Hero image and improved README privacy documentation.

### Fixed

- `package.json` corrections for npm publish.

## [0.3.0] - 2026-05-17

### Added

- Initial public release: Cursor IDE OTel exporter with GenAI semconv spans, attribution metrics, setup CLI, and CI.
- npm setup CLI with Last9 install wizard (`cursorscope setup --last9`).
- OSS readiness files (LICENSE, CODE_OF_CONDUCT, CONTRIBUTING, SECURITY).

[Unreleased]: https://github.com/last9/cursorscope/compare/v0.3.6...HEAD
[0.3.6]: https://github.com/last9/cursorscope/compare/v0.3.5...v0.3.6
[0.3.5]: https://github.com/last9/cursorscope/compare/v0.3.4...v0.3.5
[0.3.4]: https://github.com/last9/cursorscope/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/last9/cursorscope/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/last9/cursorscope/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/last9/cursorscope/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/last9/cursorscope/releases/tag/v0.3.0
