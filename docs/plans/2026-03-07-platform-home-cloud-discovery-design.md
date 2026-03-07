# Platform Home & Cloud Storage Discovery

**Date**: 2026-03-07
**Status**: Approved
**Repos**: functype-os (new APIs), envpkt (consumer)

## Problem

envpkt config discovery on WSL fails to find OneDrive-synced `envpkt.toml` because:

1. `$USER` in WSL differs from Windows username (e.g. `jordanburke` vs `jordan.burke`)
2. OneDrive folder names vary (e.g. `OneDrive - civala.com`, `OneDrive - Personal`, `OneDrive`)
3. Static hardcoded paths can't handle this variation

## Solution

Add home-first discovery to `functype-os` Platform module, then replace envpkt's static path list with dynamic discovery.

## functype-os Changes

### New Types

```typescript
type CloudProvider = "onedrive" | "gdrive" | "dropbox" | "icloud"

type CloudStorageDir = {
  readonly provider: CloudProvider
  readonly path: string
  readonly label: string // e.g. "OneDrive - Personal", "Dropbox"
}
```

### New Platform Methods

#### `Platform.windowsHomeDir(): Option<string>`

WSL only. Two-phase resolution:

- **Phase A**: Scan `/mnt/c/Users/`, filter system accounts (`Public`, `Default`, `Default User`, `All Users`, `defaultuser*`). If exactly one real user, return their home.
- **Phase B** (fallback if ambiguous): Shell out to `cmd.exe /c echo %USERPROFILE%`, convert to WSL path.
- Returns `None` on non-WSL or if resolution fails entirely.
- Memoized (lazy-cached).

#### `Platform.homeDirs(): List<string>`

All known home directories for the current user:

- Linux/Mac: `[os.homedir()]`
- WSL: `[os.homedir(), windowsHomeDir()]` (if found)

#### `Platform.cloudStorageDirs(home?: string): List<CloudStorageDir>`

Scans home directory(ies) for known cloud storage folders. If no `home` provided, scans all `homeDirs()`.

Detection patterns per provider:

- **onedrive**: `OneDrive*`, `Library/CloudStorage/OneDrive-*`
- **gdrive**: `Google Drive`, `Library/CloudStorage/GoogleDrive-*`
- **dropbox**: `Dropbox`
- **icloud**: `Library/Mobile Documents/com~apple~CloudDocs`

Label is the actual directory name (e.g. `OneDrive - civala.com`).

## envpkt Changes

Replace static `CONFIG_SEARCH_PATHS` with dynamic discovery using functype-os:

1. Check CWD (unchanged)
2. Check `ENVPKT_SEARCH_PATH` (unchanged)
3. For each home from `Platform.homeDirs()`: check `<home>/.envpkt/envpkt.toml`
4. For each cloud dir from `Platform.cloudStorageDirs()`: check `<cloudDir>/.envpkt/envpkt.toml`
5. Keep env-var fallbacks (`$USERPROFILE`, `$OneDrive`, etc.) as last resort

This eliminates the WSL username mismatch, hardcoded OneDrive names, and the need for multi-segment glob expansion.

## Testing Strategy

### Unit Tests (run everywhere, mocked)

- `windowsHomeDir()`: mock `Fs.readdirSync("/mnt/c/Users/")` and `Platform.isWSL()`
  - Single real user -> returns home
  - Multiple real users -> falls back to cmd.exe mock
  - System accounts filtered correctly
- `cloudStorageDirs()`: mock `Fs.readdirSync` on home dir
  - Finds OneDrive variants, Dropbox, GDrive, iCloud
  - Tags correct provider and label
  - Ignores unrelated directories
- `homeDirs()`: mock `Platform.isWSL()` and `windowsHomeDir()`

### Smoke Tests (environment-gated)

- `describe.skipIf(!Platform.isWSL())` — real WSL tests that find actual Windows home and cloud dirs

## Implementation Order

1. Add types and `windowsHomeDir()` to functype-os Platform
2. Add `homeDirs()` to functype-os Platform
3. Add `cloudStorageDirs()` to functype-os Platform
4. Write tests for all three
5. Publish functype-os
6. Update envpkt to consume new APIs, replace static paths
7. Update envpkt tests
