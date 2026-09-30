# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-09-30

First public release.

### Added
- Gmail support (read, send, drafts, labels, archive, trash, spam, star) via the Gmail API with OAuth 2.0 PKCE.
- Demo account for exploring the app offline.
- Sidebar with account switcher, search, saved Views, Mail folders and coloured labels; date-grouped thread list with hover actions.
- Side / centre / full-page reader with quoted-text collapse, sanitised sandboxed email HTML and inline images.
- Block-style composer with `/` menu, markdown shortcuts, attachments, signatures, snippets, drafts, send later and undo send.
- Reminders (snooze), follow-up reminders, rules, unsubscribe and tracker shield with remote images blocked by default.
- Keyboard-first triage with Gmail-style shortcuts and a command palette (`Cmd/Ctrl+K`).
- Light, dark and system themes.
- Interface in 9 languages: English, French, Spanish, German, Portuguese (Brazil), Russian, Simplified Chinese, Japanese, Hindi.
- macOS, Windows and Linux builds.
- Local SQLite cache with full-text search; tokens encrypted with the OS secure store.

### Notes
- Outlook / Microsoft 365 support is implemented but hidden until a Microsoft app registration exists.
- Builds are not yet code-signed or notarised; expect Gatekeeper / SmartScreen warnings on first launch.
- Released under the Functional Source License (FSL-1.1-ALv2).

[Unreleased]: https://github.com/curiousanthony/naushen-mail/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/curiousanthony/naushen-mail/releases/tag/v0.1.0
