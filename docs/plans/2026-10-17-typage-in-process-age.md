# Plan: replace the `age` CLI with typage (in-process age)

Tracks issue #41. Target release: **0.18.0** (breaking: the crypto and boot API goes async).

## Goal

Seal and unseal without the external `age` binary. Today `npm install -g envpkt` is not enough:
users also install `age` (brew, apt, scoop), every CI workflow installs it, and the GitHub Action
documents it as a runner requirement. [typage](https://github.com/FiloSottile/typage)
(`age-encryption` on npm) is the age format in TypeScript, by age's author. It ships plain ESM
JavaScript, depends only on the noble crypto libraries, needs Node 20+, and its test suite runs
the shared `cctv-age` test vectors. envpkt supports only maintained Node lines (decision 5).

Correction for #41: it says "TypeScript/WASM". typage has no WASM; fix the issue text.

## What does not change

- **fnox.** It is its own binary with its own encryption; `src/fnox/cli.ts` and `detect.ts` stay.
- **The MCP server.** It reads metadata only and never decrypts.
- **The file format.** `encrypted_value` stays an age-armored block. Existing `envpkt.toml` files
  must unseal unchanged (see "Format compatibility").
- **Metadata-only commands** (`env`, `secret add/rm/alias`, `audit`, `fleet`, `inspect` without
  values).

## Where envpkt calls `age` today

| Call                                                 | File                                                | Replaced by                                |
| ---------------------------------------------------- | --------------------------------------------------- | ------------------------------------------ |
| `age --encrypt --recipient R --armor`                | `src/core/seal.ts` `ageEncrypt`                     | `Encrypter.addRecipient` + `armor.encode`  |
| `age --decrypt --identity FILE`                      | `src/core/seal.ts` `ageDecrypt`                     | `Decrypter.addIdentity` + `armor.decode`   |
| `age-keygen`                                         | `src/core/keygen.ts` `generateKeypair`              | `generateIdentity` + `identityToRecipient` |
| `age --decrypt FILE` (passphrase-protected key file) | `src/fnox/identity.ts` `unwrapAgentKey`             | dropped: clear error (decision 1)          |
| `age --version`                                      | `src/fnox/identity.ts` `ageAvailable`, `ageVersion` | removed                                    |

`unsealSecrets` spawns `age` once per sealed secret, and `ageAvailable()` spawns `age --version`
before each call. In-process decryption removes those process starts from every `boot()`.
Measure a 20-secret config before and after, and put the number in the release note.

## Design

### 1. One module owns typage: `src/core/age.ts`

Nothing else imports `age-encryption`. It exposes, all returning `Promise<Either<…>>`:

- `encryptArmored(plaintext, recipient)`: armored string, formatted exactly as `ageEncrypt` writes
  it today (check `armor.encode`'s trailing newline against the current `.trim()`).
- `decryptArmored(armored, identities: ReadonlyArray<string>)`: plaintext, byte for byte when it
  is valid UTF-8 (a leading BOM included). A malformed key fails by position (`identity 2 is not a
valid age secret key`): typage's bech32 errors quote the whole key, so they never reach a message.
- `generateIdentity()`: `{ identity, recipient }`.
- `parseIdentityFile(content)`: every `AGE-SECRET-KEY-` line, or a typed error for a
  passphrase-protected file, an `AGE-PLUGIN-` line, or no key.

### 2. Identities become strings, not file paths

`IdentitySource { path, dispose }` and `materializeInlineKey` exist only because the CLI needs a
file. With typage:

- **`ENVPKT_AGE_KEY` (the CI inline key) never touches disk.** Today it is written to a 0600 temp
  file and deleted after use. Removing that file is a security improvement; call it out.
- **All keys in a file are used.** `unwrapAgentKey` takes only the first `AGE-SECRET-KEY-` line,
  while `ageDecrypt` hands the whole file to the CLI, which tries every key. Match the CLI: try all.
- The identity precedence chain (`key_file` > `ENVPKT_AGE_KEY_FILE` > `ENVPKT_AGE_KEY` >
  `~/.envpkt/age-key.txt`) and `describeSealKeySearch` stay as they are; they resolve to key strings
  instead of a path.
- **An unusable key stops `boot`.** A key source that exists but can't be read (passphrase-protected,
  plugin or SSH; decisions 1 and 2) returns its `IdentityError` from `bootSafe`, even under
  `warnOnly`, the same way `SealKeyUnavailable` does. A wrong key (decrypt fails) stays a warning, as
  it was with the CLI. `ENVPKT_AGE_KEY` goes through the same parser as a file, named
  `ENVPKT_AGE_KEY` in errors.

### 3. Public API (breaking)

Keep the names; change the return types. Exports from `src/index.ts`:

| Export                                            | Today                           | 0.18.0                                                   |
| ------------------------------------------------- | ------------------------------- | -------------------------------------------------------- |
| `bootSafe(opts)`                                  | `Either<BootError, BootResult>` | `Promise<Either<BootError, BootResult>>`                 |
| `boot(opts)`                                      | `BootResult` (throws)           | `Promise<BootResult>` (rejects)                          |
| `ageEncrypt(plaintext, recipient)`                | `Either`                        | `Promise<Either>`                                        |
| `ageDecrypt(ciphertext, identityPath)`            | `Either`                        | `ageDecrypt(ciphertext, identities)` → `Promise<Either>` |
| `sealSecrets(meta, values, recipient)`            | `Either`                        | `Promise<Either>`                                        |
| `unsealSecrets(meta, identityPath)`               | `Either`                        | `unsealSecrets(meta, identities)` → `Promise<Either>`    |
| `generateKeypair(opts)`                           | `Either`                        | `Promise<Either>`                                        |
| `unwrapAgentKey(path)`                            | `Either<IdentityError, string>` | `Either<IdentityError, ReadonlyArray<string>>` (sync)    |
| `ageAvailable()`                                  | `boolean`                       | **removed**                                              |
| `describeIdentityError(err)`, `IdentityFileError` | —                               | **new**: explain a key-file error without key material   |
| `AgeNotFound` error tag (3 unions in `types.ts`)  | present                         | **removed**                                              |

`ageDecrypt` and `unsealSecrets` take key strings rather than a file path, since the signature
breaks anyway; a path-taking helper can read the file and call them.

`unwrapAgentKey` stays synchronous: without the `age --decrypt` fallback it only reads and parses a
file, so identity resolution in `boot.ts` stays sync and the one `await` is the unseal itself.

**Floating-promise risk.** A caller that keeps writing `boot()` without `await` gets a Promise
nobody waits on: `boot()` returns before it injects, so the code after it reads `process.env`
without the secrets (they arrive later, and a failure becomes an unhandled rejection). The
CHANGELOG entry must show `await boot()` (top-level await works; envpkt is ESM-only) and say what
the failure looks like.

### 4. Callers to migrate

- `src/core/boot.ts`: phase 1 unseal, identity resolution, `boot`/`bootSafe`. Phase 1 lives inside
  synchronous `fold` chains, so it is a restructure, not an `await` sprinkle: lift each phase to
  `Promise<Either>` and chain them. `no-floating-promises` and `no-misused-promises` are at error
  level, so the linter catches a missed `await`.
- `fnoxExport(profile, agentKey?)` takes one key. With `unwrapAgentKey` returning all keys, pass
  the first, as today.
- Remove `AgeNotFound` at every site `grep -rn AgeNotFound src test` finds: the three unions in
  `types.ts`, `seal.ts`, `keygen.ts`, `fnox/identity.ts`, the `output.ts` formatter, `boot.ts`'s
  case, and their specs (`core/seal`, `fnox/identity`). `ageInstallHint` goes too (`doctor` uses
  it; decision 4).
- Add `IdentityFileError` to `IdentityError` (and so `BootError`), and export it from `index.ts`.
- `src/cli/commands/`: `exec`, `env export`/`env github`, `headers`, `doctor` (via `bootSafe`);
  `seal` (3 seal/unseal calls and `unwrapAgentKey`); `secret rotate` (`ageEncrypt`); `copy` (unseal
  and reseal); `inspect` (unseal); `keygen` (`generateKeypair`). Commander supports async actions,
  but only under `program.parseAsync()`; `src/cli/index.ts` calls `program.parse()` today.
- `doctor` replaces its `age` version check with the bundled `age-encryption` version (decision 4).

### 5. Node versions

`package.json` had no `engines` field. Node 20 reached end of life on 2026-04-30, so envpkt claims
the maintained lines only: `"engines": { "node": ">=22.12.0" }`. CI runs `pnpm validate` on the
newest 22, 24 and 26 (22 is in maintenance until 2027-04-30). pnpm needs 22.13+, so CI can't run
the 22.12.0 floor; it was checked by hand (all tests, the CLI, and `require(esm)` pass). Re-check
it before the 0.18.0 release. `.nvmrc` stays pinned at `24.20.0` for the publish job. Done ahead of
step 2, so CI tests step 1's code on all three lines before step 2 builds on it.

CommonJS callers load envpkt through `require(esm)` (unflagged from Node 22.12) and can't use
top-level `await`; the 0.18.0 CHANGELOG entry must show them `boot().then(…)` (step 5).

## Format compatibility (the test that decides whether this is safe)

Every existing `envpkt.toml` holds ciphertext made by the `age` CLI. A new interop spec,
`test/core/age-interop.spec.ts`, skipped when `age` is not installed:

1. Encrypt with the `age` CLI (armored, as envpkt 0.17 does) → decrypt with typage → byte-identical.
2. Encrypt with typage → decrypt with the `age` CLI → byte-identical, so users can still unseal
   by hand with `age -d`.
3. A typage-sealed value written through `applySealedToml` produces the same TOML shape as 0.17
   (one `encrypted_value = """…"""` block), and unseals byte for byte.
4. Values with edge whitespace (PEM with final newline, `"  padded\t"`), an empty string, and a
   multi-line value, in both directions.
5. A key file with two `AGE-SECRET-KEY-` lines, where only the second matches.

CI keeps installing `age`, now only for this spec. Reword the comment in `node.js.yml` and
`publish.yml` to say so.

## Test migration

Nine spec files call `age-keygen` in setup (`core/seal`, `core/keygen`, `core/boot`, `cli/env`,
`cli/headers`, `cli/seal`, `cli/rotate`, `cli/keygen`, `cli/copy`). Switch them to a shared typage
keygen helper so the suite runs without `age`; drop their `skipIf(!ageInstalled)` guards. The
byte-for-byte tests from 0.17.0 (`copy`, `--reseal`, env → `boot()`) carry over and guard the swap.
`action-smoke.yml` generates its key with `age-keygen`; switch it to `envpkt keygen` and drop the
`age` install there, which proves the Action works without `age`.

## Docs

- README, `site/.../getting-started/installation.mdx`: remove the `age` install step.
- `site/.../cli/keygen.mdx`, `site/.../reference/error-types.mdx`: drop `AgeNotFound`.
- `site/.../integrations/github-action.mdx`: remove the "Sealed packets need the `age` CLI"
  caution and its gotcha.
- `site/.../guides/agent-ci-workflow.mdx`, `.claude/skills/envpkt/SKILL.md`,
  `.claude/skills/envpkt/references/common-patterns.md`: remove `age` installs; update the library
  examples to `await`.
- `CLAUDE.md` (Dependencies says `age` is required at runtime; the `seal.ts` row says "via `age`
  CLI") and `.claude/skills/envpkt/references/quick-reference.md` (`AgeNotFound`).
- CHANGELOG `0.18.0`: **Breaking** entries under Changed (async API) and Removed (`ageAvailable`,
  `AgeNotFound`, the `age` CLI requirement); the inline-key and performance notes.

## Sequence (each step its own commit and review)

1. `src/core/age.ts` + its unit tests + the interop spec.
2. Core callers: `seal.ts`, `keygen.ts`, `fnox/identity.ts`, `boot.ts`; types; `index.ts` exports.
3. CLI callers. Steps 2 and 3 land as one commit: the CLI can't typecheck or lint against an async
   core, and each commit must pass `pnpm validate`. That commit also updates the specs the new
   signatures break (`await`, keys instead of a key path); the age-keygen setup and `skipIf` guards
   still move in step 4.
4. Test-setup migration and `action-smoke.yml`.
5. Docs, CHANGELOG, release 0.18.0.

## Deferred

**A synchronous `boot()`.** Not built now: no repo under `~/IdeaProjects` imports envpkt as a
library, and all in-repo callers can await. If a sync caller turns up, add `bootSync()` that runs
the async path in a child Node process via `execFileSync(process.execPath, [helper])`, the same
shape as today's `age` shell-out. It is additive, so it needs no further breaking change.

## Decisions (2026-10-17)

1. **Passphrase-protected key files: dropped.** A key file with no `AGE-SECRET-KEY-` line that
   holds age ciphertext fails with a clear error saying envpkt needs a plain key file. envpkt never
   creates one (`envpkt keygen` writes a plain key), and none of the maintainer's key files is one.
   Remove "a passphrase-wrapped key blob" from `site/.../guides/runtime-injection.mdx`.
2. **Plugin and SSH keys: dropped.** An `AGE-PLUGIN-` line (or any other non-key line that isn't a
   comment) fails with a message naming the line type; the `age` CLI is not kept as a fallback.
   Every recipient in the maintainer's configs is a plain `age1…` X25519 key.
3. **Names: kept.** `boot`, `bootSafe`, `sealSecrets`, … keep their names and return Promises.
4. **`doctor`: reports the bundled `age-encryption` version** in place of the `age` CLI check.
5. **Node: maintained lines only.** `engines` is `>=22.12.0`, and CI tests 22, 24 and 26. When a line
   reaches end of life, drop it from the matrix and raise `engines` in the next minor release.
