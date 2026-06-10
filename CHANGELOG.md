# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`envpkt env dotenv`** emits resolved credentials in `.env` format (`KEY=value`), for the
  tools that auto-discover `.env` files — Wrangler, Docker `--env-file`, Vite/Next/Astro,
  GitHub Actions, direnv. A sibling of `env export` (shell) and `env github` (`$GITHUB_ENV`).
  Secret values are included by default (consistent with those commands); `--no-secrets`
  emits value-less placeholders. `-o <file>` writes to a file (with a `.gitignore` reminder
  when secrets are present). Values are quoted only when needed and output is deterministic.
  New library API: `formatDotenv` / `quoteDotenvValue`.
  ([#23](https://github.com/jordanburke/envpkt/issues/23))
- **`secret edit --unset <field>`** removes an optional metadata field (repeatable). Field
  names are the canonical TOML keys (e.g. `rate_limit`). You can unset any field you can set
  with a flag; unknown field names are rejected rather than silently ignored. Previously the
  only way to drop a field was hand-editing the TOML, since `--field ""` failed schema
  validation. ([#31](https://github.com/jordanburke/envpkt/issues/31))

### Fixed

- **`--dry-run` now runs the same schema validation as the real write** across `secret`
  subcommands. Previously a dry-run could preview a change (e.g. `expires = ""`) that the
  actual write would then reject, so the preview no longer misrepresents what will be
  accepted. ([#31](https://github.com/jordanburke/envpkt/issues/31))

## [0.12.0] - 2026-06-07

### Added

- **GitHub Actions CI injection.** New `envpkt env github` command resolves the credentials
  in `envpkt.toml` and injects them into `$GITHUB_ENV` under their namespaced wire names, so
  later steps in the job inherit them. Secret values are masked in the log via
  `::add-mask::`; env defaults are written but not masked. `--strict` gates the build on the
  pre-flight audit.
- **Composite GitHub Action** (`action.yml`) — `uses: jordanburke/envpkt@v0.12.0` with inputs
  `config` / `version` / `strict` / `profile`, wrapping `env github`.
- **Inline age key for CI.** `boot()` now honors an inline `ENVPKT_AGE_KEY` (e.g. a CI
  secret): it is materialized to a `0600` temp file to decrypt sealed packets and removed
  after use, so no key file is needed in CI. Identity precedence:
  `identity.key_file` → `ENVPKT_AGE_KEY_FILE` → `ENVPKT_AGE_KEY` (inline) →
  `~/.envpkt/age-key.txt`.

### Documentation

- New GitHub Action integration page and `env github` CLI page; CI/CD guide updated to use
  the Action; skill updated with the `env github` command and the `ENVPKT_AGE_KEY` contract.

## [0.11.9] - 2026-06-07

### Documentation

- Add changelog entries for 0.11.7 and 0.11.8 (no functional change; published as a release).

## [0.11.8] - 2026-06-07

### Changed

- **CI:** bump workflow actions to their Node 24 runtimes ahead of GitHub's
  forced switch ([#36]) — `actions/checkout` v4→v5, `actions/setup-node` v4→v5,
  `pnpm/action-setup` v4→v6, `softprops/action-gh-release` v1→v3 (v2 is still
  Node 20; only v3 is Node 24).

## [0.11.7] - 2026-06-07

### Documentation

- Add `CHANGELOG.md` (Keep a Changelog format) and backfill entries for every
  prior tagged release (0.2.0 through 0.11.6).

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

### Changed

- Migrate to ts-builds 3.0.0 and pnpm 11 ([#32]).

### Documentation

- `[namespace]` section in the TOML schema reference (with a shell-safe-separator
  caution and an alias-bridge note), wire-name notes on `env export`/`exec`,
  synced `BootResult` in the library API reference and the envpkt skill, and a
  new `examples/namespaced-agent.toml`.
- Make the docs site build under pnpm 11 and fix the Starlight 0.39 sidebar
  ([#33]).

## [0.11.5] - 2026-05-30

### Fixed

- `seal` command failing on alias entries.

## [0.11.4] - 2026-05-25

### Added

- `sort` command and `--sort` display flags.

## [0.11.3] - 2026-05-25

### Added

- `secret rotate` command and `last_rotated_at` metadata.

## [0.11.2] - 2026-05-23

### Added

- `envpkt validate` command and a write-gate for mutating CLI operations.

### Changed

- Enable `noUncheckedIndexedAccess`; make `Record`/array lookups type-honest.
- Internal refactors toward functype: `Set`/`Map` for internal collections,
  parser helpers returning `Option<T>`, alias validation via `Either.flatMap`
  chains, TOML parsers via `foldLeft`. Exhaust remaining functype lint warnings.
- Bump functype to 0.60.2 and ts-builds to 2.7.1.

## [0.11.1] - 2026-04-18

### Fixed

- Import from `functype-log/direct` to avoid eagerly loading loglayer.

## [0.11.0] - 2026-04-18

### Added

- Optional functype-log diagnostic tracing in `bootSafe`.

## [0.10.2] - 2026-04-18

### Fixed

- Audit showing aliases as "missing" when the target is healthy.

### Documentation

- Document secret/env CRUD commands on the site.

## [0.10.1] - 2026-04-18

### Fixed

- Alias CLI tests in CI — run tsx against source instead of built dist.

## [0.10.0] - 2026-04-18

### Added

- `secret alias` / `env alias` CLI commands with overwrite protection.

## [0.9.1] - 2026-04-18

### Documentation

- Document `from_key` across docs, skill, README, and library exports.

## [0.9.0] - 2026-04-18

Release bump; no functional changes.

## [0.8.2] - 2026-04-18

### Added

- `from_key` — governed aliases for secret and env entries.

### Fixed

- Declare the skill path in `marketplace.json` so the envpkt skill loads.

### Documentation

- Keygen project-specific defaults and rm-to-replace.

## [0.8.1] - 2026-04-12

### Changed

- `keygen` defaults to project-specific paths; dropped `--force`.

## [0.8.0] - 2026-04-12

### Added

- Richer CLI colors in `inspect` and `resolve` output.

### Fixed

- `keygen` writes a full identity block and handles plain age key files.

### Changed

- Refactor to functional style — clear all ESLint errors and functype lint
  warnings.

## [0.7.3] - 2026-04-03

### Fixed

- Validate pipeline after dependency upgrades.

## [0.7.2] - 2026-03-15

### Added

- Product landing page (React + Tailwind v4).

### Fixed

- `env export` now includes env entries already present in the shell.

### Documentation

- Skill docs with CRUD commands and workflows.

## [0.7.1] - 2026-03-07

### Added

- `envpkt upgrade` command for self-update.

## [0.7.0] - 2026-03-07

### Changed

- Consistent CRUD CLI for secrets and env.

## [0.6.10] - 2026-03-07

### Added

- `--edit` flag on the `seal` command for changing secret values.

## [0.6.9] - 2026-03-07

### Fixed

- `shell-hook` (bash) fired the audit on every prompt instead of on `cd`.

## [0.6.8] - 2026-03-07

### Fixed

- Silent failure when `env export` could not decrypt sealed secrets.

## [0.6.7] - 2026-03-07

### Added

- Better platform home and cloud-storage discovery.

## [0.6.6] - 2026-03-06

### Fixed

- `inspect --secrets` decrypts sealed values from the TOML instead of reading
  `process.env`.

## [0.6.5] - 2026-03-06

### Fixed

- `writeSealedToml` adding extra blank lines on each reseal.

## [0.6.4] - 2026-03-06

### Fixed

- `seal --reseal` identity fallback now uses the standard key-resolution chain.

## [0.6.3] - 2026-03-06

### Added

- `add` and `add-env` CLI commands for managing `envpkt.toml` entries.

### Fixed

- `seal --reseal` decrypts before re-encrypting (key-rotation support).

## [0.6.2] - 2026-03-06

### Fixed

- `writeSealedToml` missing blank lines between TOML sections.

## [0.6.1] - 2026-03-06

### Fixed

- `seal --reseal` doubling `encrypted_value` blocks in the TOML.

## [0.6.0] - 2026-03-06

### Changed

- Rename `[agent]` to `[identity]` and the `identity` field to `key_file` in the
  schema.

### Fixed

- `env export` was silent on sealed secrets.

## [0.5.0] - 2026-03-06

### Added

- `keygen` command to streamline the scan-to-seal workflow ([#6]).

### Changed

- Move to functype-os.

## [0.4.2] - 2026-03-05

### Fixed

- CLI version resolution now works in both dev and bundled mode.

## [0.4.1] - 2026-03-05

### Added

- Glob support in config search paths.

### Fixed

- CLI version read from `package.json` instead of a hardcoded string.

## [0.4.0] - 2026-03-05

### Added

- Cross-platform config discovery chain.
- `expandPath` — `~`, `$VAR`, and `${VAR}` expansion in path strings.
- Claude plugin infrastructure (`.claude-plugin`).

### Documentation

- envpkt-specific README and docs.

## [0.2.0] - 2026-03-01

Initial public release.

### Added

- Sealed packets — age-encrypted secret values safe to commit.
- v5 schema with the `boot()` API and agent identity.
- Shared secret catalog with the `resolve` command.
- Secret value display, golden fixtures, and demo HTML generation.

[0.12.0]: https://github.com/jordanburke/envpkt/compare/v0.11.9...v0.12.0
[0.11.9]: https://github.com/jordanburke/envpkt/compare/v0.11.8...v0.11.9
[0.11.8]: https://github.com/jordanburke/envpkt/compare/v0.11.7...v0.11.8
[0.11.7]: https://github.com/jordanburke/envpkt/compare/v0.11.6...v0.11.7
[0.11.6]: https://github.com/jordanburke/envpkt/compare/v0.11.5...v0.11.6
[0.11.5]: https://github.com/jordanburke/envpkt/compare/v0.11.4...v0.11.5
[0.11.4]: https://github.com/jordanburke/envpkt/compare/v0.11.3...v0.11.4
[0.11.3]: https://github.com/jordanburke/envpkt/compare/v0.11.2...v0.11.3
[0.11.2]: https://github.com/jordanburke/envpkt/compare/v0.11.1...v0.11.2
[0.11.1]: https://github.com/jordanburke/envpkt/compare/v0.11.0...v0.11.1
[0.11.0]: https://github.com/jordanburke/envpkt/compare/v0.10.2...v0.11.0
[0.10.2]: https://github.com/jordanburke/envpkt/compare/v0.10.1...v0.10.2
[0.10.1]: https://github.com/jordanburke/envpkt/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/jordanburke/envpkt/compare/v0.9.1...v0.10.0
[0.9.1]: https://github.com/jordanburke/envpkt/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/jordanburke/envpkt/compare/v0.8.2...v0.9.0
[0.8.2]: https://github.com/jordanburke/envpkt/compare/v0.8.1...v0.8.2
[0.8.1]: https://github.com/jordanburke/envpkt/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/jordanburke/envpkt/compare/v0.7.3...v0.8.0
[0.7.3]: https://github.com/jordanburke/envpkt/compare/v0.7.2...v0.7.3
[0.7.2]: https://github.com/jordanburke/envpkt/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/jordanburke/envpkt/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/jordanburke/envpkt/compare/v0.6.10...v0.7.0
[0.6.10]: https://github.com/jordanburke/envpkt/compare/v0.6.9...v0.6.10
[0.6.9]: https://github.com/jordanburke/envpkt/compare/v0.6.8...v0.6.9
[0.6.8]: https://github.com/jordanburke/envpkt/compare/v0.6.7...v0.6.8
[0.6.7]: https://github.com/jordanburke/envpkt/compare/v0.6.6...v0.6.7
[0.6.6]: https://github.com/jordanburke/envpkt/compare/v0.6.5...v0.6.6
[0.6.5]: https://github.com/jordanburke/envpkt/compare/v0.6.4...v0.6.5
[0.6.4]: https://github.com/jordanburke/envpkt/compare/v0.6.3...v0.6.4
[0.6.3]: https://github.com/jordanburke/envpkt/compare/v0.6.2...v0.6.3
[0.6.2]: https://github.com/jordanburke/envpkt/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/jordanburke/envpkt/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/jordanburke/envpkt/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/jordanburke/envpkt/compare/v0.4.2...v0.5.0
[0.4.2]: https://github.com/jordanburke/envpkt/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/jordanburke/envpkt/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/jordanburke/envpkt/compare/v0.2.0...v0.4.0
[0.2.0]: https://github.com/jordanburke/envpkt/releases/tag/v0.2.0
[#6]: https://github.com/jordanburke/envpkt/pull/6
[#32]: https://github.com/jordanburke/envpkt/pull/32
[#33]: https://github.com/jordanburke/envpkt/pull/33
[#35]: https://github.com/jordanburke/envpkt/pull/35
[#36]: https://github.com/jordanburke/envpkt/pull/36
