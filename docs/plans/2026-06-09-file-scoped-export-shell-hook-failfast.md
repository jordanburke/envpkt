# File-Scoped Export, Shell-Hook Injection & Fail-Fast Key Handling

**Date**: 2026-06-09
**Status**: Approved
**Repos**: envpkt (this repo); consumers: dotfiles (`.zshrc`/`.bashrc` shell hook), per-project `envpkt.toml`

> **Revision 1 (2026-06-09)**: Track A originally outsourced the cd-load lifecycle to direnv.
> Reversed — the existing `chpwd`/`PROMPT_COMMAND` shell hook (which already fires on every
> directory change) gains injection directly, so ambient per-project loading needs no extra
> dependency and no per-repo `.envrc`.
>
> **Revision 2 (2026-06-10)**: Track B was "per-package key wrapping/sync" (per-package keys
> stored age-encrypted against a global recipient). **Eliminated** — the global-wrap defeats the
> isolation it claims (one global key unwraps all of them) while adding the most code, and the
> incident it targeted is already survivable via `seal --edit`. Track B is now **fail-fast key
> resolution**: the boot/inject path must error cleanly when a sealed package's key is absent
> (today it warns and injects empty); recovery is one well-bootstrapped key, with `seal --edit`
> as the explicit "lost it, start over" path. No per-package wrapping, no `key_file_wrapped`,
> no `envpkt key wrap`.

## Problem

A namespaced project package (`[namespace] prefix = "CIV"`, wire names like
`CIV__BETTERSTACK_API_KEY`) silently failed to reach the MCP servers launched by an agent from
that project directory — every `CIV__*` resolved empty ("No teams found"). Two independent root
causes (one earlier hypothesis was wrong and is recorded so it isn't re-investigated):

- **NOT the namespace prefix.** 0.12.0 implements it correctly — `src/core/namespace.ts`
  `makeEnvNamer`, applied in `boot.ts:191` and `exec.ts` via `wireName`/`boot.envNames`. (An
  earlier "unimplemented" claim came from a stale 0.11.2 checkout.)
- **Cause 1 — injection only happens at shell start or via `exec`.** The shell injects only the
  _global_ package at start (`eval "$(envpkt env export)"`); the `chpwd` hook only runs
  `envpkt audit` — it never injects. So a process launched from a project dir (which inherits
  the launcher env) never sees the project's `CIV__*` names unless launched via `envpkt exec`.
- **Cause 2 — decryption failed silently.** The project package's private key was absent on
  this machine, so its sealed secrets resolved to **empty** — and the boot/inject path only
  _warned_ (`boot.ts:287`) instead of failing, so the agent launched with empty `CIV__*` and
  failed three layers downstream. The fix is not key-wrapping machinery; it is **failing fast
  with a clean "key not found, here's how to fix it" error**, plus a single well-bootstrapped
  key so the key is present in the first place.

## Solution

Two independent tracks:

- **A — file-scoped export + shell-hook injection.** A single package-level `scope` field gates
  whether `env export` emits secrets. The existing `chpwd`/`PROMPT_COMMAND` shell hook gains
  injection: on every directory change it unsets the previously-injected package vars, then
  injects the CWD package's resolved vars (load-on-enter **and** unload-on-leave, both owned by
  the hook). `env export --track` emits the list of injected names so the hook can clean them up.
- **B — fail-fast key resolution.** Using a sealed package requires its decryption key; when the
  key is absent the boot/inject path (and the A3 hook) must **fail fast with an actionable
  error**, never inject empty. Recovery is **one bootstrapped key per identity** (not per-package
  wrapping), with `seal --reseal` (needs the key) for rotation and `seal --edit` as the explicit
  "lost the key, re-provision from source" path.

### Design principles

- **`scope` is file-level, single field.** No per-secret modes. Consistent with the threat
  model that a local interactive shell _is_ the user's shell — the asymmetry that matters is
  remote/log surfaces, not a deploy key briefly resident in your own project shell that the hook
  unloads on `cd` out. Hard-exclusion escape hatch = put that cred in a separate `exec` package.
- **`scope` only governs `env export`/ambient. `envpkt exec` always injects everything**,
  regardless of `scope` — `scope` never weakens `exec`.
- **The shell hook owns lifecycle.** The hard part of cd-dynamic env is unload-on-leave; the
  hook already fires on every `chpwd`/prompt, so it records the names it injected (via
  `env export --track`) and unsets them before injecting the next directory's package. Extend
  the hook that already exists rather than take on a direnv dependency + per-repo `.envrc`.
- **One key per identity, bootstrapped — not per-package wrapping.** Per-package isolation is
  notional for a single operator across their own machines, and global-wrapping it (one global
  key unwraps all) surrenders that isolation while adding the most code. Bootstrap one key
  (passphrase/scrypt, or pulled from a secret manager); skip per-package keys.
- **Require the key to _use_ sealed secrets; never inject empty.** `seal --reseal` decrypts with
  the original key — fail fast without it. Plaintext re-supply happens only through the explicit
  `seal --edit` "start over" path, never as a silent fallback.
- **Ambient loading needs a non-interactively-resolvable key.** The cd-hook decrypts on entry, so
  it cannot prompt. `scope = "shell"` requires the key as a plain `0600` file (at-rest protection
  delegated to disk encryption / FileVault); a passphrase- or manager-locked key is bootstrap-time
  only, or for `scope = "exec"` packages where a one-time prompt at launch is acceptable. So the
  split is: **`shell` ⇒ key unlocked at rest; `exec` ⇒ key may prompt.**

---

## Track A — file-scoped export + shell-hook injection

### A1. `scope` field (`src/core/schema.ts`) — ✅ done

**Top-level** on `EnvpktConfigSchema` (alongside `version`/`catalog`), default `exec` when unset.
Not under `[namespace]` — `scope` governs load behavior, not naming, and a prefix-less package
(the global one) must be able to set it without an empty `[namespace]` table.

```typescript
scope: Type.Optional(
  Type.Union([Type.Literal("shell"), Type.Literal("exec")], {
    description:
      "Whether `env export` emits this package's secrets for ambient/shell loading " +
      "(`shell`) or withholds them so they are only available via `envpkt exec` (`exec`). " +
      "Default `exec`. Never affects `envpkt exec`, which always injects everything.",
  }),
),
```

- Regenerate `schemas/envpkt.schema.json` via `scripts/build-schema.ts`.
- `src/core/types.ts`: the re-exported `EnvpktConfig` type picks this up automatically.

### A2. `env export` respects `scope` (`src/cli/commands/env.ts`) — ✅ done

- `collectEmitEntries` (line ~248) already emits correct wire names via `boot.envNames`. No
  wire-name change needed.
- Gate **secret** entries by the resolved package `namespace.scope`: when `exec` (default),
  emit no secret entries; when `shell`, emit as today. Env-default (non-secret) entries are
  unaffected — keep them always emitting to preserve current non-secret behavior.
- `envpkt exec` (`src/cli/commands/exec.ts`) is **unchanged** — always injects all secrets.
- Add a **`--track`** flag to `env export`. Per emitted key it wraps the assignment with an
  in-shell snapshot so the hook can **restore** (not just unset) on leave:
  `_ENVPKT_HAD_<key>=${<key>+1}; _ENVPKT_PREV_<key>="${<key>-}"; export <key>="<value>"`, then a
  trailing `_ENVPKT_INJECTED="<space-separated wire names>"`. Without `--track`, output is
  byte-for-byte unchanged. (The marker distinguishes "was empty" from "was unset" — they restore
  differently.)
- **Behavior change to call out in CHANGELOG**: a package without `scope = "shell"` no longer
  exports secrets. The only ambient consumer today is the global package — handled by migration
  (A4).

### A3. shell-hook injection (`src/cli/commands/shell-hook.ts`) — ✅ done

> Shipped with **upward-walk config discovery** (`discoverConfig` walks up to the nearest
> `envpkt.toml` before the global/search fallback) so the hook works from any subdirectory, not
> just the project root. `envpkt config-path` added as the resolve-only per-`cd` gate. Integration
> tests cover zsh (chpwd) and bash (`_envpkt_prompt`) load/restore/dedup.

Extend the emitted `chpwd` (zsh) / `PROMPT_COMMAND` (bash) hook from audit-only to
**unset → inject → audit**. The hook already fires on every directory change and resolves the
CWD package (config discovery is CWD-first), so no new triggering machinery is needed — the
secret-loading half the hook's comment always implied finally exists.

```zsh
_envpkt_chpwd() {
  # 0. DEDUP on the resolved package. `config-path` is resolve-only (no boot/decrypt). If cd
  #    stayed inside the same package (e.g. proj/ → proj/src/), do nothing — this bounds
  #    decryption, audit, and any B1 error to once per package-ENTRY, not per directory.
  local cfg; cfg="$(envpkt config-path 2>/dev/null)"
  [[ "$cfg" == "$_ENVPKT_DIR" ]] && return
  # 1. TEARDOWN the previously-injected package — RESTORE prior values, not blind unset.
  #    For each key in $_ENVPKT_INJECTED: if _ENVPKT_HAD_<key> was set, restore _ENVPKT_PREV_<key>;
  #    else unset <key>. Then clear the tracker vars. Keyed off $_ENVPKT_INJECTED alone, so it is
  #    safe to re-run after a partial/crashed hook.
  _envpkt_restore
  _ENVPKT_DIR="$cfg"
  [[ -z "$cfg" ]] && return   # left all packages → stay torn down
  # 2. INJECT the CWD package. `env export --track` (A2) emits, per key, the snapshot + set:
  #      _ENVPKT_HAD_<key>=…; _ENVPKT_PREV_<key>="…"; export <key>="…"
  #    plus a trailing _ENVPKT_INJECTED="<key1> <key2> …". Runs AFTER teardown so the snapshot
  #    captures the true pre-envpkt baseline (post-restore), making cd A→B correct. Decrypts the
  #    package's sealed values — requires a non-interactively-resolvable key (see note below).
  eval "$(envpkt env export --track 2>/dev/null)"
  # 3. keep the existing audit-on-cd warning
  envpkt audit --format minimal 2>/dev/null
}
add-zsh-hook chpwd _envpkt_chpwd
_envpkt_chpwd   # run once: chpwd does NOT fire at shell start, so load the opening directory
```

- **Dedup on resolved config path** — needs a small new resolve-only primitive `envpkt config-path`
  (prints the CWD's `envpkt.toml`, empty if none; no boot, no decrypt). Gating on the resolved
  config (not `$PWD`) is what collapses intra-package `cd`s — CWD-first resolution means subdirs
  share one config. This is also what stops a B1 key error from re-printing on every hop.
- **Decryption happens on entry** — so ambient (`scope = "shell"`) packages need a key that
  resolves without a prompt (plain `0600` file / `ENVPKT_AGE_KEY[_FILE]`). Passphrase/manager keys
  are bootstrap-time or for `exec`-only packages. See the key-availability design principle.
- **Restore, not unset** — a key may have a prior value (e.g. the global package set `CIV__FOO`);
  on leave it must be restored, not deleted. The `_ENVPKT_HAD_<key>` marker distinguishes
  "was empty" from "was unset". This is the bounded teardown (O(declared keys)) — not a direnv
  reimplementation.
- **Teardown before inject** — without step 1 first, `cd` A→B captures A's injected value as B's
  "baseline" and leaks it. This is correctness, not just hygiene.
- **Only `env export` output is eval'd** — which is `scope`-gated (A2), so an `exec`-only package
  injects nothing secret ambiently even though the hook ran.
- **B1 interaction** — if a `shell`-scope package's key is absent, `env export` exits non-zero and
  prints `SealKeyUnavailable` to stderr; nothing is injected and the dedup makes it show once per
  entry. Visible, not silent, not spammy.
- **Run-once on install** — `chpwd`/`PROMPT_COMMAND` do not fire at shell startup, so the hook
  calls itself once after registration to load a shell opened inside a package dir.
- The bash variant does the same inside `_envpkt_prompt`; subshells are interactive-only and their
  env changes don't propagate up, so teardown state stays contained (assert this in tests).
- No external dependency; the behavior is fully self-contained in what `envpkt shell-hook` emits.

### A4. Migration + launch

- **Re-install the hook**: `envpkt shell-hook zsh >> ~/.zshrc` (or `bash`) to pick up the
  inject-capable version, replacing the prior audit-only hook. The shell-start
  `eval "$(envpkt env export)"` for the global package can stay or be dropped — the hook now
  injects the global package too whenever you're `cd`'d within its scope.
- **Global package** (`~/OneDrive/.envpkt/envpkt.toml`): set `scope = "shell"` so it loads
  ambiently. One line.
- **Project packages**: default `exec` (nothing ambient). Opt a repo in with `scope = "shell"`
  — no `.envrc`, no per-repo allow step; the hook picks it up on `cd`.
- `envpkt exec -- <agent>` remains the full-inject launch path, independent of the hook.

---

## Track B — fail-fast key resolution

> Supersedes the original "per-package key wrapping/sync." Per-package keys, `key_file_wrapped`,
> the OneDrive ciphertext-key convention, and `envpkt key wrap` are **not pursued** (see Revision 2
> and design principles). What follows is the whole of Track B.

### B1. Fail fast when a sealed package's key is absent (`src/core/boot.ts`) — ✅ done

Previously, when sealed values existed but `resolveSealIdentity` found no key, boot pushed a
warning and the secrets resolved **empty** — the silent failure behind the original incident.
Now promoted to a distinct, hard error:

- New `IdentityError` variant `SealKeyUnavailable { sealedKeys, searched }` raised the moment a
  package has `encrypted_value` entries and no key resolves — **before** any empty injection.
- The message prints the precedence chain it searched, so the fix is obvious:
  `identity.key_file` → `ENVPKT_AGE_KEY_FILE` → `ENVPKT_AGE_KEY` → `~/.envpkt/age-key.txt`, each
  annotated (found / unset / missing), with remediation lines ("restore your key to …",
  "re-provision from source: `envpkt seal --edit <KEY>`").
- `boot()`/`bootSafe()` return this as a hard error / `Left` by default, so `exec` and the emit
  commands (`env export`/`github`/`dotenv`) fail fast. **`audit` is unaffected** — it reads
  metadata only (no boot/decrypt), so it still reports health for a packet whose key you don't
  hold, which is correct. The **A3 hook surfaces it for free**: `env export` exits non-zero,
  `eval` injects nothing, the clean message lands on stderr — visible on `cd`, shell not killed.
- Also fixed en route: `resolveSealIdentity` existence-checks a configured `key_file` and falls
  through the rest of the chain when it's missing (previously returned a dead path) — so a local
  `key_file` no longer blocks an inline CI key, and a truly absent key reaches this guard.
- Scope note: the **seal** path already fails fast correctly (`seal.ts:344` for `--reseal`); this
  gap was specific to **boot/inject**. Decrypt failure with a _present_ key (wrong/corrupt) remains
  a warning for now — separate follow-up.

### B2. Make `seal --edit` a deliberate "start over" (`src/cli/commands/seal.ts`)

`--edit` is the no-original-key recovery path (re-type values from your source of truth, reseal
against the current recipient). Harden it so overwriting a sealed value is a conscious act:

- When `--edit` would replace an **already-sealed** `encrypted_value`, confirm first:
  `"Replace the sealed value for <KEY>? The previous value can't be recovered without the
original key. [y/N]"`. `--edit` is interactive-only already, so the prompt is free in automation.
- `--reseal` is unchanged — it decrypts with the original key and never prompts for the plaintext
  of an already-sealed entry.

### B3. Apply to the civ-devops package (the operational unblock)

- **Key recoverable** (the actual case — it exists on another machine): bring the private key to
  this machine at one of the precedence paths above. No wrapping, no config change.
- **Key truly lost**: `seal --edit` the package's secrets — re-enter each value from its source
  of truth (1Password / service dashboard), resealed against the current recipient. To also
  rotate to a fresh keypair: `keygen` + update `[identity].recipient`, then `--edit`.

---

## Testing Strategy

### Unit / CLI (run everywhere)

- **A1/A2**: `env export` on a `scope = "exec"` package emits **no** secret `export` lines; on
  `scope = "shell"` emits all under `CIV__*` wire names matching `exec`. `envpkt exec` injects
  the full set under both scopes (assert `scope` never weakens `exec`). With `--track`, asserts
  a trailing `export _ENVPKT_INJECTED="…"` line listing exactly the emitted wire names.
- **B1**: a package with `encrypted_value` entries and **no resolvable key** makes
  `boot`/`bootSafe` return `SealKeyUnavailable` (not empty secrets); `env export` exits non-zero,
  prints the searched-paths remediation, and emits nothing. With the key present, it resolves
  normally.
- **B2**: `seal --edit` on an already-sealed key prompts for confirmation before overwriting;
  declining leaves the ciphertext untouched. `--reseal` without the original key still fails fast
  (regression).
- **Regression**: a package with no `scope` and no namespace still behaves for non-secret env
  defaults; global package with `scope = "shell"` emits bare names as before.

### Smoke (environment-gated: needs age + a real package)

- **A3**: install the inject-capable hook, then in a `scope = "shell"` repo → `cd` in sets
  `CIV__BETTERSTACK_API_KEY`; `cd` out (to a non-package dir) unsets a key that had no prior
  value, and **restores** the prior value for a key the global package had set (the overlap
  case); `cd` A→B shows B's value, not A's. `cd` into a **subdir** of the same package is a no-op
  (dedup — no re-decrypt, no repeated audit). A shell opened _inside_ a package dir loads it at
  start (run-once). With the package's key **absent**, `cd` in prints `SealKeyUnavailable` once
  (not per subdir) and injects nothing. Confirm zsh + bash.
- **End-to-end**: from the project dir, `cd` in (or `envpkt exec`) → launch the agent → the
  namespaced MCPs authenticate.

## Implementation Order

1. **B1** — fail-fast on missing seal key (boot/inject). The direct fix for the incident,
   independent and small; land it first so the failure is legible while the rest is built.
2. **A1 + A2** — `scope` field + `env export` gating + `--track` (+ schema regen, CHANGELOG note).
3. **A3** — `envpkt config-path` (resolve-only primitive) + shell-hook injection (dedup → unset →
   inject → audit) + docs for re-installing the hook.
4. **B2 + B3** — `seal --edit` confirm-on-overwrite, and recover-or-re-provision the civ-devops
   key (operational; the recovery can be done manually ahead of B2).

B1 is independent and highest-value — land it first. A1 → A3 are sequential; B2/B3 can land any
time after B1.

## Note

The BetterStack disk-monitor task that triggered this investigation is independent of all the
above — the global package decrypts its token today, so the monitor can be built via
`envpkt exec -c <global-config> -- <curl to the Uptime REST API>` without any of these changes.
