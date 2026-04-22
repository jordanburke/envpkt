# File-Scoped Export, Shell-Hook Injection & Per-Package Key Sync

**Date**: 2026-06-09
**Status**: Approved
**Repos**: envpkt (this repo); consumers: dotfiles (`.zshrc`/`.bashrc` shell hook), per-project `envpkt.toml`

> **Revision (2026-06-09)**: Track A originally outsourced the cd-load lifecycle to direnv.
> Reversed — the existing `chpwd`/`PROMPT_COMMAND` shell hook (which already fires on every
> directory change) gains injection directly, so ambient per-project loading needs no extra
> dependency and no per-repo `.envrc`. Track B unchanged.

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
- **Cause 2 — decryption.** The project package seals against a per-package recipient whose
  private key was absent on the machine, so its sealed secrets resolved to empty even when
  injection was correct. There is no way today to unwrap a per-package key that has been
  encrypted ("wrapped") against a global recipient.

## Solution

Two independent tracks:

- **A — file-scoped export + shell-hook injection.** A single package-level `scope` field gates
  whether `env export` emits secrets. The existing `chpwd`/`PROMPT_COMMAND` shell hook gains
  injection: on every directory change it unsets the previously-injected package vars, then
  injects the CWD package's resolved vars (load-on-enter **and** unload-on-leave, both owned by
  the hook). `env export --track` emits the list of injected names so the hook can clean them up.
- **B — per-package key wrapping/sync.** Per-package keys are kept (isolation) but stored
  age-encrypted against a global recipient, so one global key on each machine decrypts every
  project package. OneDrive carries ciphertext keys; the global root key stays local-only.

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

---

## Track A — file-scoped export + shell-hook injection

### A1. `scope` field (`src/core/schema.ts`)

Add to `NamespaceSchema` (currently lines 48–61), default `exec` when unset:

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
- `src/core/types.ts`: the re-exported `Namespace` type picks this up automatically.

### A2. `env export` respects `scope` (`src/cli/commands/env.ts`)

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

### A3. shell-hook injection (`src/cli/commands/shell-hook.ts`)

Extend the emitted `chpwd` (zsh) / `PROMPT_COMMAND` (bash) hook from audit-only to
**unset → inject → audit**. The hook already fires on every directory change and resolves the
CWD package (config discovery is CWD-first), so no new triggering machinery is needed — the
secret-loading half the hook's comment always implied finally exists.

```zsh
_envpkt_chpwd() {
  # 1. TEARDOWN the previously-injected package — RESTORE prior values, not blind unset.
  #    For each key in $_ENVPKT_INJECTED: if _ENVPKT_HAD_<key> was set, restore _ENVPKT_PREV_<key>;
  #    else unset <key>. Then clear the tracker vars. Keyed off $_ENVPKT_INJECTED alone, so it is
  #    safe to re-run after a partial/crashed hook.
  _envpkt_restore
  # 2. INJECT the CWD package. `env export --track` (A2) emits, per key, the snapshot + set:
  #      _ENVPKT_HAD_<key>=…; _ENVPKT_PREV_<key>="…"; export <key>="…"
  #    plus a trailing _ENVPKT_INJECTED="<key1> <key2> …". Runs AFTER teardown so the snapshot
  #    captures the true pre-envpkt baseline (post-restore), making cd A→B correct.
  eval "$(envpkt env export --track 2>/dev/null)"
  # 3. keep the existing audit-on-cd warning
  envpkt audit --format minimal 2>/dev/null
}
add-zsh-hook chpwd _envpkt_chpwd
_envpkt_chpwd   # run once: chpwd does NOT fire at shell start, so load the opening directory
```

- **Restore, not unset** — a key may have a prior value (e.g. the global package set `CIV__FOO`);
  on leave it must be restored, not deleted. The `_ENVPKT_HAD_<key>` marker distinguishes
  "was empty" from "was unset". This is the bounded teardown (O(declared keys)) — not a direnv
  reimplementation.
- **Teardown before inject** — without step 1 first, `cd` A→B captures A's injected value as B's
  "baseline" and leaks it. This is correctness, not just hygiene.
- **Only `env export` output is eval'd** — which is `scope`-gated (A2), so an `exec`-only package
  injects nothing secret ambiently even though the hook ran.
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

## Track B — per-package key wrapping + sync

### B1. Recipient-wrap unwrap (`src/fnox/identity.ts`)

`unwrapAgentKey` (lines 25–55) currently runs `age --decrypt <file>` with **no `--identity`**,
so it handles only plain or passphrase-protected key files. Extend it to accept an optional
unwrap-identity and, for a recipient-wrapped key file, run:

```
age --decrypt --identity <globalKey> <wrappedKeyFile>
```

`<globalKey>` resolves via the existing `resolveKeyPath()` (`src/core/keygen.ts:11` →
`ENVPKT_AGE_KEY_FILE` or `~/.envpkt/age-key.txt`). Thread the unwrap-identity through
`boot.ts` `resolveIdentityFilePath` (47–58) → `resolveIdentityKey` (60–70).

### B2. Config + storage (`src/core/schema.ts` `IdentitySchema`)

- Add an explicit marker that `key_file` is wrapped and unwraps with the global key, e.g.
  `key_file_wrapped: Type.Optional(Type.Boolean(...))` (unwrap identity defaults to
  `resolveKeyPath()`). Explicit flag preferred over silent fallback.
- Convention: wrapped per-package keys live at
  `~/OneDrive/.envpkt/keys/<project>-key.txt.age`. OneDrive carries **ciphertext** keys only;
  the global root key stays local-only at `~/.envpkt/age-key.txt`. `key_file` points at the
  `.age` path.
- Optional CLI helper `envpkt key wrap`:
  `age --encrypt -r <global-recipient> <plain-package-key>` → the OneDrive path. Otherwise
  document the one-liner.

### B3. Apply to the civ-devops package (the operational unblock)

The civ-devops private key is absent locally. Determine if it exists on another machine:

- **Recoverable**: wrap it against the global recipient, place the `.age` at the OneDrive path,
  set `key_file` + `key_file_wrapped`.
- **Lost**: re-key — `envpkt keygen` a new package key, `envpkt seal --reseal` the package's
  secrets against the new recipient, update `[identity].recipient`, then wrap + store as above.

---

## Testing Strategy

### Unit / CLI (run everywhere)

- **A1/A2**: `env export` on a `scope = "exec"` package emits **no** secret `export` lines; on
  `scope = "shell"` emits all under `CIV__*` wire names matching `exec`. `envpkt exec` injects
  the full set under both scopes (assert `scope` never weakens `exec`). With `--track`, asserts
  a trailing `export _ENVPKT_INJECTED="…"` line listing exactly the emitted wire names.
- **B1**: wrap a throwaway key against the global recipient, point `key_file` at it with
  `key_file_wrapped = true`, assert `envpkt audit` / `envpkt exec -- printenv` resolves the
  sealed secrets with only the global key present.
- **Regression**: a package with no `scope` and no namespace still behaves for non-secret env
  defaults; global package with `scope = "shell"` emits bare names as before.

### Smoke (environment-gated: needs age + a real package)

- **A3**: install the inject-capable hook, then in a `scope = "shell"` repo → `cd` in sets
  `CIV__BETTERSTACK_API_KEY`; `cd` out (to a non-package dir) unsets a key that had no prior
  value, and **restores** the prior value for a key the global package had set (the overlap
  case); `cd` A→B shows B's value, not A's. A shell opened *inside* a package dir loads it at
  start (run-once). Confirm zsh + bash.
- **End-to-end**: from the project dir, `cd` in (or `envpkt exec`) → launch the agent → the
  namespaced MCPs authenticate.

## Implementation Order

1. **A1 + A2** — `scope` field + `env export` gating (+ schema regen, CHANGELOG note). Smallest,
   self-contained, unblocks the ergonomics once the global package is migrated to `scope = "shell"`.
2. **A3** — shell-hook injection (unset → inject → audit) + docs for re-installing the hook.
3. **B1 + B2** — recipient-wrap unwrap + `key_file_wrapped` + storage convention (+ optional
   `envpkt key wrap`).
4. **B3** — recover-or-rekey the civ-devops key and wrap/store it (operational; can also be done
   manually ahead of the code as the immediate unblock).

Tracks A and B are independent; either can land first.

## Note

The BetterStack disk-monitor task that triggered this investigation is independent of all the
above — the global package decrypts its token today, so the monitor can be built via
`envpkt exec -c <global-config> -- <curl to the Uptime REST API>` without any of these changes.
