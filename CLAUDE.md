# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**envpkt** — Credentials your agents actually understand. A metadata sidecar library/CLI that gives AI agents structured awareness of their secrets — capabilities, constraints, expiration, rotation — without exposing raw values. Stores metadata in `envpkt.toml` files with optional age-encrypted sealed packets for self-contained deployments.

Key capabilities: MCP server for agent-facing credential awareness (metadata only, no secret values), audit credential health, detect drift between config and environment, scan for credentials in process.env, manage shared catalogs across agent fleets, encrypt/decrypt secrets with age. Three-tier trust model: MCP layer (no access to secrets), boot() runtime injection (outside LLM context), and audit trails for shell-level agents.

## Development Commands

```bash
pnpm validate          # Full pipeline: format → lint → typecheck → test → build:schema → build
pnpm test              # Run tests only
pnpm test -- test/core/seal.spec.ts           # Single test file
pnpm test -- --testNamePattern="pattern"      # Filter by test name
pnpm build             # Production build (dist/)
pnpm build:schema      # Regenerate schemas/envpkt.schema.json from TypeBox
pnpm dev               # Watch mode build
pnpm demo              # Regenerate demo HTML renders in examples/demo/
pnpm docs:dev          # Astro docs site dev server (site/ subdirectory)
```

The validate chain is customized in `ts-builds.config.json` to include `build:schema` between test and build.

## Architecture

### Dual Output Build

`tsdown.config.ts` defines two entry points:

- `src/index.ts` → `dist/index.js` + `dist/index.d.ts` (library API with types)
- `src/cli/index.ts` → `dist/cli.js` (CLI binary with `#!/usr/bin/env node` banner, no types)

### Core Layer (`src/core/`)

| File                | Purpose                                                                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema.ts`         | TypeBox schema definitions → runtime validation + type generation. Source of truth for `EnvpktConfig` shape.                                          |
| `types.ts`          | Domain types re-exported from schema + audit/fleet/error union types. Uses functype `Option`/`List`.                                                  |
| `config.ts`         | TOML parsing (smol-toml), TypeBox validation, config path resolution (flag → `ENVPKT_CONFIG` env → CWD).                                              |
| `catalog.ts`        | Catalog resolution — merges shared secret metadata from a referenced catalog file into agent configs.                                                 |
| `audit.ts`          | Health computation: compares secret metadata against lifecycle policies → `AuditResult` with per-secret status.                                       |
| `boot.ts`           | Programmatic entry point. `boot()`/`bootSafe()` pipeline: load config → resolve catalog → audit → unseal → fnox fallback → inject into `process.env`. |
| `seal.ts`           | Age encryption/decryption via `age` CLI. `sealSecrets`/`unsealSecrets` operate on config metadata records.                                            |
| `env.ts`            | Environment scanning (`envScan`) and drift detection (`envCheck`).                                                                                    |
| `patterns.ts`       | Credential pattern registry: ~45 exact names, ~13 suffix patterns, ~29 value shape regexes for auto-discovery.                                        |
| `fleet.ts`          | Directory tree scanner for `envpkt.toml` files, aggregates health across agents.                                                                      |
| `format.ts`         | Human-readable packet formatting with optional secret masking.                                                                                        |
| `resolve-values.ts` | Value resolution cascade: sealed → fnox → env → interactive prompt.                                                                                   |
| `keygen.ts`         | Age keypair generation, key path resolution, and config recipient update.                                                                             |

### CLI Layer (`src/cli/`)

Commander-based CLI. Each command in `src/cli/commands/` maps 1:1 to a subcommand (`audit`, `env`, `exec`, `fleet`, `init`, `inspect`, `keygen`, `mcp`, `resolve`, `seal`, `shell-hook`). Output formatting is in `src/cli/output.ts`.

### MCP Layer (`src/mcp/`)

MCP server using `@modelcontextprotocol/sdk` with stdio transport. Exposes 5 tools (`getPacketHealth`, `listCapabilities`, `getSecretMeta`, `checkExpiration`, `getEnvMeta`) and 2 resources (`envpkt://health`, `envpkt://capabilities`). The MCP server does not have access to secret values — it reads `envpkt.toml` which contains metadata only, and `encrypted_value` ciphertext is stripped from responses.

### fnox Integration (`src/fnox/`)

Bridge to the `fnox` credential store: detection, CLI invocation, TOML parsing, sync comparison, and age identity management.

## Key Design Patterns

- **functype everywhere**: All fallible operations return `Either<Error, T>`. Optional values use `Option<T>`. Collections use `List<T>`. Error types are discriminated unions with `_tag` field.
- **TypeBox schemas**: `src/core/schema.ts` is the single source of truth. Types are derived via `Static<typeof Schema>`. The JSON Schema in `schemas/` is generated from these via `scripts/build-schema.ts`.
- **TOML config**: Parsed with `smol-toml`, validated with compiled TypeBox, dates normalized from `TomlDate` to ISO strings.
- **No thrown exceptions in library API**: `bootSafe()` returns `Either`; `boot()` is the throwing convenience wrapper.

## Dependencies

- **functype** — FP primitives (Option, Either, List, Try)
- **@sinclair/typebox** — Runtime schema validation + TypeScript type derivation
- **smol-toml** — TOML parser
- **commander** — CLI framework
- **@modelcontextprotocol/sdk** — MCP server implementation
- **age** (external CLI) — Required at runtime for seal/unseal operations

## Test Structure

Tests mirror source: `test/core/`, `test/cli/`, `test/fnox/`, `test/e2e/`, `test/mcp/`. Fixture data in `test/fixtures/demo-data.ts`. Vitest with v8 coverage.

## Publishing

```bash
npm version patch|minor|major
npm publish --access public
```

`prepublishOnly` runs `pnpm validate`. The `schemas/` directory and JSON Schema export (`envpkt/schema`) are part of the published package.
