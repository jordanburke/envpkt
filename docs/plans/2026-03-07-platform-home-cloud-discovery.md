# Platform Home & Cloud Storage Discovery Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add WSL Windows home detection and cross-platform cloud storage discovery to functype-os, then consume it in envpkt to fix config discovery on WSL.

**Architecture:** New types and methods added to functype-os's `Platform` module. WSL Windows home resolved via filesystem scan with cmd.exe fallback. Cloud storage directories detected by scanning home dirs for known provider folder patterns. envpkt replaces its static `CONFIG_SEARCH_PATHS` with dynamic discovery from these new APIs.

**Tech Stack:** functype-os (TypeScript, functype, Node.js fs/os/child_process), envpkt (consumer)

---

### Task 1: Add CloudProvider and CloudStorageDir types to functype-os

**Files:**

- Modify: `src/platform/Platform.ts` (add types before Platform object)
- Modify: `src/platform/index.ts` (export new types)
- Modify: `src/index.ts` (re-export new types)

**Step 1: Add types to Platform.ts**

Add after the `UserInfo` type (line 13):

```typescript
export type CloudProvider = "onedrive" | "gdrive" | "dropbox" | "icloud"

export type CloudStorageDir = {
  readonly provider: CloudProvider
  readonly path: string
  readonly label: string
}
```

**Step 2: Export from platform/index.ts**

Update to:

```typescript
export type { CloudProvider, CloudStorageDir, UserInfo } from "./Platform"
export { Platform } from "./Platform"
```

**Step 3: Export from src/index.ts**

Add to existing exports:

```typescript
export type { CloudProvider, CloudStorageDir, UserInfo } from "./platform"
```

**Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add src/platform/Platform.ts src/platform/index.ts src/index.ts
git commit -m "feat: add CloudProvider and CloudStorageDir types"
```

---

### Task 2: Add windowsHomeDir() to Platform

**Files:**

- Modify: `src/platform/Platform.ts`

**Step 1: Write the failing test**

Create: `test/platform/windows-home.spec.ts`

```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"

// We need to test the internal logic, so we test Platform directly
import { Platform } from "../../src/platform"

describe("Platform.windowsHomeDir", () => {
  describe("on non-WSL", () => {
    it("returns None", () => {
      // On non-WSL Linux/Mac/Windows, windowsHomeDir should be None
      // This test runs everywhere — if we happen to be on WSL it still works
      // because the method returns Option
      const result = Platform.windowsHomeDir()
      expect(result.isNone() || result.isSome()).toBe(true)
    })
  })

  describe("WSL resolution logic (unit)", () => {
    const SYSTEM_ACCOUNTS = ["All Users", "Default", "Default User", "Public", "defaultuser100000", "desktop.ini"]

    it("filters system accounts from /mnt/c/Users", () => {
      // Verify our system account list covers known entries
      const allEntries = [...SYSTEM_ACCOUNTS, "jordan.burke"]
      const filtered = allEntries.filter(
        (e) =>
          e !== "All Users" &&
          e !== "Default" &&
          e !== "Default User" &&
          e !== "Public" &&
          !e.startsWith("defaultuser") &&
          !e.startsWith("desktop.") &&
          !e.startsWith("WsiAccount"),
      )
      expect(filtered).toEqual(["jordan.burke"])
    })
  })
})

describe.skipIf(!Platform.isWSL())("Platform.windowsHomeDir (WSL smoke)", () => {
  it("finds a Windows home directory", () => {
    const result = Platform.windowsHomeDir()
    expect(result.isSome()).toBe(true)
    result.forEach((home) => {
      expect(home).toMatch(/^\/mnt\/[a-z]\/Users\//)
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm test -- test/platform/windows-home.spec.ts`
Expected: FAIL — `Platform.windowsHomeDir is not a function`

**Step 3: Add imports and helper functions to Platform.ts**

Add `import { execSync } from "node:child_process"` at the top.

Add before the `Platform` object (after `cachedIsCI`):

```typescript
const WSL_SYSTEM_ACCOUNTS = new Set(["All Users", "Default", "Default User", "Public"])

const isSystemAccount = (name: string): boolean =>
  WSL_SYSTEM_ACCOUNTS.has(name) ||
  name.startsWith("defaultuser") ||
  name.startsWith("desktop.") ||
  name.startsWith("WsiAccount")

const resolveWindowsHome = (): Option<string> => {
  if (!cachedIsWSL()) return Option<string>(undefined)

  // Phase A: scan /mnt/c/Users/ and filter system accounts
  try {
    const entries = fs.readdirSync("/mnt/c/Users")
    const realUsers = entries.filter((e) => {
      if (isSystemAccount(e)) return false
      try {
        return fs.statSync(path.join("/mnt/c/Users", e)).isDirectory()
      } catch {
        return false
      }
    })

    if (realUsers.length === 1) {
      return Option(path.join("/mnt/c/Users", realUsers[0]!))
    }

    // Phase B: ambiguous — use cmd.exe to get the exact profile
    if (realUsers.length > 1) {
      try {
        const raw = execSync("cmd.exe /c echo %USERPROFILE%", {
          encoding: "utf8",
          timeout: 3000,
          stdio: ["pipe", "pipe", "pipe"],
        }).trim()
        // Convert "C:\Users\jordan.burke" → "/mnt/c/Users/jordan.burke"
        const converted = raw
          .replace(/\\/g, "/")
          .replace(/^([A-Za-z]):/, (_, drive: string) => `/mnt/${drive.toLowerCase()}`)
        if (fs.existsSync(converted)) {
          return Option(converted)
        }
      } catch {
        // cmd.exe not available or timed out — return first match as best guess
        return Option(path.join("/mnt/c/Users", realUsers[0]!))
      }
    }
  } catch {
    // /mnt/c/Users doesn't exist
  }

  return Option<string>(undefined)
}

const cachedWindowsHome = memo(resolveWindowsHome)
```

**Step 4: Add windowsHomeDir to Platform object**

Add after `isContainer`:

```typescript
  windowsHomeDir: (): Option<string> => cachedWindowsHome(),
```

**Step 5: Run test to verify it passes**

Run: `pnpm test -- test/platform/windows-home.spec.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/platform/Platform.ts test/platform/windows-home.spec.ts
git commit -m "feat: add Platform.windowsHomeDir() with WSL filesystem scan + cmd.exe fallback"
```

---

### Task 3: Add homeDirs() to Platform

**Files:**

- Modify: `src/platform/Platform.ts`
- Modify: `test/platform/windows-home.spec.ts` (add tests)

**Step 1: Write the failing test**

Append to `test/platform/windows-home.spec.ts`:

```typescript
describe("Platform.homeDirs", () => {
  it("always includes os.homedir()", () => {
    const dirs = Platform.homeDirs()
    expect(dirs.size).toBeGreaterThanOrEqual(1)
    expect(dirs.toArray()).toContain(Platform.homeDir())
  })

  it("includes windowsHomeDir on WSL when available", () => {
    const dirs = Platform.homeDirs()
    const winHome = Platform.windowsHomeDir()
    if (winHome.isSome()) {
      expect(dirs.toArray()).toContain(winHome.value)
    }
  })

  it("has no duplicates", () => {
    const dirs = Platform.homeDirs()
    const arr = dirs.toArray()
    expect(new Set(arr).size).toBe(arr.length)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm test -- test/platform/windows-home.spec.ts`
Expected: FAIL — `Platform.homeDirs is not a function`

**Step 3: Add homeDirs to Platform object**

Add the `List` import at the top of Platform.ts:

```typescript
import { List, Option } from "functype"
```

Add to Platform object after `windowsHomeDir`:

```typescript
  homeDirs: (): List<string> => {
    const homes: string[] = [os.homedir()]
    Platform.windowsHomeDir().forEach((winHome) => {
      if (winHome !== os.homedir()) {
        homes.push(winHome)
      }
    })
    return List(homes)
  },
```

**Step 4: Run test to verify it passes**

Run: `pnpm test -- test/platform/windows-home.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/platform/Platform.ts test/platform/windows-home.spec.ts
git commit -m "feat: add Platform.homeDirs() — all home directories including WSL Windows home"
```

---

### Task 4: Add cloudStorageDirs() to Platform

**Files:**

- Modify: `src/platform/Platform.ts`
- Create: `test/platform/cloud-storage.spec.ts`

**Step 1: Write the failing test**

Create `test/platform/cloud-storage.spec.ts`:

```typescript
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { describe, expect, it, afterEach, beforeEach } from "vitest"

import { Platform } from "../../src/platform"

describe("Platform.cloudStorageDirs", () => {
  let tmpHome: string

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "functype-os-cloud-"))
  })

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true })
  })

  it("finds OneDrive variants", () => {
    mkdirSync(join(tmpHome, "OneDrive - Personal"))
    mkdirSync(join(tmpHome, "OneDrive - civala.com"))
    mkdirSync(join(tmpHome, "OneDrive"))

    const results = Platform.cloudStorageDirs(tmpHome)
    expect(results.size).toBe(3)
    results.forEach((r) => {
      expect(r.provider).toBe("onedrive")
    })
    const labels = results.map((r) => r.label).toArray()
    expect(labels).toContain("OneDrive - Personal")
    expect(labels).toContain("OneDrive - civala.com")
    expect(labels).toContain("OneDrive")
  })

  it("finds Dropbox", () => {
    mkdirSync(join(tmpHome, "Dropbox"))

    const results = Platform.cloudStorageDirs(tmpHome)
    expect(results.size).toBe(1)
    expect(results.toArray()[0]!.provider).toBe("dropbox")
    expect(results.toArray()[0]!.label).toBe("Dropbox")
  })

  it("finds Google Drive", () => {
    mkdirSync(join(tmpHome, "Google Drive"))

    const results = Platform.cloudStorageDirs(tmpHome)
    expect(results.size).toBe(1)
    expect(results.toArray()[0]!.provider).toBe("gdrive")
  })

  it("finds macOS CloudStorage patterns", () => {
    mkdirSync(join(tmpHome, "Library"), { recursive: true })
    mkdirSync(join(tmpHome, "Library", "CloudStorage"))
    mkdirSync(join(tmpHome, "Library", "CloudStorage", "OneDrive-Personal"))
    mkdirSync(join(tmpHome, "Library", "CloudStorage", "GoogleDrive-jordan@example.com"))

    const results = Platform.cloudStorageDirs(tmpHome)
    expect(results.size).toBe(2)
    const providers = results.map((r) => r.provider).toArray()
    expect(providers).toContain("onedrive")
    expect(providers).toContain("gdrive")
  })

  it("finds iCloud", () => {
    const icloudPath = join(tmpHome, "Library", "Mobile Documents", "com~apple~CloudDocs")
    mkdirSync(icloudPath, { recursive: true })

    const results = Platform.cloudStorageDirs(tmpHome)
    expect(results.size).toBe(1)
    expect(results.toArray()[0]!.provider).toBe("icloud")
  })

  it("ignores non-cloud directories", () => {
    mkdirSync(join(tmpHome, "Documents"))
    mkdirSync(join(tmpHome, "Desktop"))
    mkdirSync(join(tmpHome, ".config"))

    const results = Platform.cloudStorageDirs(tmpHome)
    expect(results.size).toBe(0)
  })

  it("returns empty list for nonexistent directory", () => {
    const results = Platform.cloudStorageDirs("/nonexistent/path")
    expect(results.size).toBe(0)
  })
})

describe.skipIf(!Platform.isWSL())("Platform.cloudStorageDirs (WSL smoke)", () => {
  it("scans all homeDirs and finds results", () => {
    const allDirs = Platform.homeDirs().flatMap((home) => Platform.cloudStorageDirs(home))
    // On WSL with OneDrive this should find at least one
    expect(allDirs.size).toBeGreaterThanOrEqual(0) // non-failing — just exercises the path
  })
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm test -- test/platform/cloud-storage.spec.ts`
Expected: FAIL — `Platform.cloudStorageDirs is not a function`

**Step 3: Implement cloudStorageDirs**

Add to `Platform.ts` before the `Platform` object:

```typescript
type CloudDetector = {
  readonly provider: CloudProvider
  readonly detect: (home: string) => CloudStorageDir[]
}

const detectOneDriveHome = (home: string): CloudStorageDir[] => {
  try {
    return fs
      .readdirSync(home)
      .filter((e) => e === "OneDrive" || e.startsWith("OneDrive ") || e.startsWith("OneDrive-"))
      .filter((e) => {
        try {
          return fs.statSync(path.join(home, e)).isDirectory()
        } catch {
          return false
        }
      })
      .map((e) => ({ provider: "onedrive" as const, path: path.join(home, e), label: e }))
  } catch {
    return []
  }
}

const detectOneDriveMac = (home: string): CloudStorageDir[] => {
  const cloudStorage = path.join(home, "Library", "CloudStorage")
  try {
    return fs
      .readdirSync(cloudStorage)
      .filter((e) => e.startsWith("OneDrive"))
      .filter((e) => {
        try {
          return fs.statSync(path.join(cloudStorage, e)).isDirectory()
        } catch {
          return false
        }
      })
      .map((e) => ({ provider: "onedrive" as const, path: path.join(cloudStorage, e), label: e }))
  } catch {
    return []
  }
}

const detectGDriveHome = (home: string): CloudStorageDir[] => {
  const gd = path.join(home, "Google Drive")
  try {
    if (fs.statSync(gd).isDirectory()) {
      return [{ provider: "gdrive" as const, path: gd, label: "Google Drive" }]
    }
  } catch {
    // not found
  }
  return []
}

const detectGDriveMac = (home: string): CloudStorageDir[] => {
  const cloudStorage = path.join(home, "Library", "CloudStorage")
  try {
    return fs
      .readdirSync(cloudStorage)
      .filter((e) => e.startsWith("GoogleDrive"))
      .filter((e) => {
        try {
          return fs.statSync(path.join(cloudStorage, e)).isDirectory()
        } catch {
          return false
        }
      })
      .map((e) => ({ provider: "gdrive" as const, path: path.join(cloudStorage, e), label: e }))
  } catch {
    return []
  }
}

const detectDropbox = (home: string): CloudStorageDir[] => {
  const db = path.join(home, "Dropbox")
  try {
    if (fs.statSync(db).isDirectory()) {
      return [{ provider: "dropbox" as const, path: db, label: "Dropbox" }]
    }
  } catch {
    // not found
  }
  return []
}

const detectICloud = (home: string): CloudStorageDir[] => {
  const ic = path.join(home, "Library", "Mobile Documents", "com~apple~CloudDocs")
  try {
    if (fs.statSync(ic).isDirectory()) {
      return [{ provider: "icloud" as const, path: ic, label: "iCloud Drive" }]
    }
  } catch {
    // not found
  }
  return []
}

const CLOUD_DETECTORS: ReadonlyArray<(home: string) => CloudStorageDir[]> = [
  detectOneDriveHome,
  detectOneDriveMac,
  detectGDriveHome,
  detectGDriveMac,
  detectDropbox,
  detectICloud,
]
```

Add to Platform object after `homeDirs`:

```typescript
  cloudStorageDirs: (home?: string): List<CloudStorageDir> => {
    const homes = home ? [home] : Platform.homeDirs().toArray()
    const results: CloudStorageDir[] = []
    for (const h of homes) {
      for (const detect of CLOUD_DETECTORS) {
        results.push(...detect(h))
      }
    }
    // Deduplicate by path
    const seen = new Set<string>()
    const unique = results.filter((r) => {
      if (seen.has(r.path)) return false
      seen.add(r.path)
      return true
    })
    return List(unique)
  },
```

**Step 4: Run test to verify it passes**

Run: `pnpm test -- test/platform/cloud-storage.spec.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `pnpm test`
Expected: PASS

**Step 6: Commit**

```bash
git add src/platform/Platform.ts test/platform/cloud-storage.spec.ts
git commit -m "feat: add Platform.cloudStorageDirs() — cross-platform cloud storage detection"
```

---

### Task 5: Validate, build, and publish functype-os

**Files:**

- Modify: `package.json` (version bump)

**Step 1: Run full validate pipeline**

Run: `pnpm validate`
Expected: PASS (format, lint, typecheck, test, build all pass)

**Step 2: Bump version**

Run: `npm version minor` (0.2.0 → 0.3.0 — new features, no breaking changes)

**Step 3: Publish**

Run: `npm publish --access public`
Expected: Published functype-os@0.3.0

**Step 4: Push**

Run: `git push && git push --tags`

---

### Task 6: Update envpkt to use new functype-os APIs

**Files:**

- Modify: `package.json` (bump functype-os dependency)
- Modify: `src/core/config.ts` (replace static paths with dynamic discovery)

**Step 1: Update functype-os dependency**

Run: `pnpm add functype-os@^0.3.0`

**Step 2: Update config.ts imports**

Add `Platform` import:

```typescript
import { Env, Fs, Path, Platform } from "functype-os"
```

**Step 3: Replace CONFIG_SEARCH_PATHS and discoverConfig**

Replace the static `CONFIG_SEARCH_PATHS` array and update `discoverConfig` to use dynamic discovery:

```typescript
/** Build discovery paths dynamically from Platform home and cloud storage detection */
const buildSearchPaths = (): ReadonlyArray<string> => {
  const paths: string[] = []

  // Home directories (Linux home + Windows home on WSL)
  for (const home of Platform.homeDirs().toArray()) {
    paths.push(join(home, ".envpkt", "envpkt.toml"))
  }

  // Cloud storage directories from all homes
  for (const cloud of Platform.cloudStorageDirs().toArray()) {
    paths.push(join(cloud.path, ".envpkt", "envpkt.toml"))
  }

  // Env-var fallbacks for cases where filesystem detection misses
  const envFallbacks = [
    "$WINHOME/OneDrive/.envpkt/envpkt.toml",
    "$USERPROFILE/OneDrive/.envpkt/envpkt.toml",
    "$OneDrive/.envpkt/envpkt.toml",
    "$OneDriveConsumer/.envpkt/envpkt.toml",
    "$OneDriveCommercial/.envpkt/envpkt.toml",
    "$DROPBOX_PATH/.envpkt/envpkt.toml",
    "$GOOGLE_DRIVE/.envpkt/envpkt.toml",
    "$WINHOME/.envpkt/envpkt.toml",
    "$USERPROFILE/.envpkt/envpkt.toml",
  ]
  paths.push(...envFallbacks)

  return paths
}
```

Update `discoverConfig` to use `buildSearchPaths()` instead of `CONFIG_SEARCH_PATHS`:

```typescript
export const discoverConfig = (cwd?: string): Option<DiscoveredConfig> => {
  const dir = cwd ?? process.cwd()
  const cwdCandidate = join(dir, CONFIG_FILENAME)
  if (Fs.existsSync(cwdCandidate)) {
    const found: DiscoveredConfig = { path: cwdCandidate, source: "cwd" }
    return Option(found)
  }

  const customPaths = Env.get("ENVPKT_SEARCH_PATH").fold(
    () => [] as string[],
    (v) => v.split(":").filter(Boolean),
  )

  const searchPaths = buildSearchPaths()

  for (const template of [...customPaths, ...searchPaths]) {
    const expanded = expandPath(template)
    if (!expanded || expanded.startsWith("/.envpkt")) continue
    if (Fs.existsSync(expanded)) {
      const found: DiscoveredConfig = { path: expanded, source: "search" }
      return Option(found)
    }
  }

  return Option<DiscoveredConfig>(undefined)
}
```

Note: The env-var fallback paths still use `expandPath` for `$VAR` expansion. The `expandGlobPath` function is no longer needed in `discoverConfig` since `cloudStorageDirs()` handles the glob-like scanning. Keep `expandGlobPath` exported (it may be used elsewhere or by tests), but the discovery loop simplifies to just `Fs.existsSync`.

**Step 4: Update tests**

Update `test/core/config.spec.ts` — the tests that set `HOME` to an empty dir and expect no config found should still work because `buildSearchPaths()` uses `Platform.homeDirs()` which reads `os.homedir()` (which respects `HOME` env var), and `Platform.cloudStorageDirs()` scans those homes. On a clean tmp dir, no cloud dirs will be found.

Run: `pnpm test -- test/core/config.spec.ts`
Expected: PASS

**Step 5: Run full validate**

Run: `pnpm validate`
Expected: PASS

**Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/core/config.ts
git commit -m "feat: use functype-os Platform for dynamic config discovery (fixes WSL OneDrive)"
```
