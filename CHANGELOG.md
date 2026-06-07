# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.11.6] - 2026-06-07

### Added

- **Namespace prefix for injected environment variable names** ([#35]). An
  optional `[namespace]` table prefixes the **injected** env var name for every
  `[secret.*]`/`[env.*]` entry (e.g. `CIV__API_KEY`), while the TOML keys you
  author and the names shown in `audit`/`inspect` stay logical. The prefix is
  applied only at the `process.env` boundary — internal resolution (audit,
  `from_key` references, fnox lookup, catalog merge) stays keyed by the logical
  name.
  - `prefix` (required) and `separator` (default `__`) on `[namespace]`.
  - Per-entry `namespace` override on secret/env entries; `""` opts out.
  - `BootResult.envNames` exposes the logical → wire-name map.
  - Default separator is `__` because it is the only namespace separator valid
    in a POSIX shell identifier (`.` and `:` break `$VAR`/`export`); boot emits
    a non-fatal warning for a non-shell-safe separator.

### Fixed

- `envpkt env check` and env-drift audit (`computeEnvAudit`) now read
  `process.env` by the namespaced wire name. Under a namespace, drift detection
  previously reported namespaced vars as missing and flagged them as untracked.
- `envpkt exec` and `envpkt env export` now inject/emit under the namespaced
  wire name instead of the logical key, so shell injection sets the variable the
  consumer actually reads.

### Documentation

- `[namespace]` section in the TOML schema reference (with a shell-safe-separator
  caution and an alias-bridge note), wire-name notes on `env export`/`exec`,
  synced `BootResult` in the library API reference and the envpkt skill, and a
  new `examples/namespaced-agent.toml`.

[0.11.6]: https://github.com/jordanburke/envpkt/compare/v0.11.5...v0.11.6
[#35]: https://github.com/jordanburke/envpkt/pull/35
