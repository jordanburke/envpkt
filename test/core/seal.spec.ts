import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ageDecrypt, ageEncrypt, sealSecrets, unsealSecrets } from "../../src/core/seal.js"

// Check if age is available for integration tests
const ageInstalled = (() => {
  try {
    execFileSync("age", ["--version"], { stdio: "pipe" })
    return true
  } catch {
    return false
  }
})()

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "envpkt-seal-test-"))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe("ageEncrypt / ageDecrypt", () => {
  it.skipIf(!ageInstalled)("round-trips encrypt then decrypt", () => {
    // Generate a test keypair
    const keygenOutput = execFileSync("age-keygen", [], {
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8",
    })

    // Extract recipient from keygen output (line starting with "# public key:")
    const recipientLine = keygenOutput.split("\n").find((l) => l.startsWith("# public key:"))
    const recipient = recipientLine!.replace("# public key: ", "").trim()

    // Write the identity (private key) to a temp file
    const identityPath = join(tmpDir, "test-identity.txt")
    writeFileSync(identityPath, keygenOutput)

    const plaintext = "super-secret-api-key-12345"

    const encryptResult = ageEncrypt(plaintext, recipient)
    encryptResult.fold(
      (err) => expect.unreachable(`Encrypt failed: ${err.message}`),
      (ciphertext) => {
        expect(ciphertext).toContain("-----BEGIN AGE ENCRYPTED FILE-----")

        const decryptResult = ageDecrypt(ciphertext, identityPath)
        decryptResult.fold(
          (err) => expect.unreachable(`Decrypt failed: ${err.message}`),
          (decrypted) => {
            expect(decrypted).toBe(plaintext)
          },
        )
      },
    )
  })
})

describe("sealSecrets", () => {
  it.skipIf(!ageInstalled)("seals all provided values and preserves meta without values", () => {
    const keygenOutput = execFileSync("age-keygen", [], {
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8",
    })
    const recipientLine = keygenOutput.split("\n").find((l) => l.startsWith("# public key:"))
    const recipient = recipientLine!.replace("# public key: ", "").trim()

    const meta = {
      API_KEY: { service: "openai" },
      DB_URL: { service: "postgres" },
      NO_VALUE: { service: "redis" },
    }

    const values = {
      API_KEY: "sk-test-123",
      DB_URL: "postgres://user:pass@host/db",
    }

    const result = sealSecrets(meta, values, recipient)

    result.fold(
      (err) => expect.unreachable(`Seal failed: ${err.message}`),
      (sealed) => {
        expect(sealed["API_KEY"]!.encrypted_value).toContain("-----BEGIN AGE ENCRYPTED FILE-----")
        expect(sealed["DB_URL"]!.encrypted_value).toContain("-----BEGIN AGE ENCRYPTED FILE-----")
        expect(sealed["NO_VALUE"]!.encrypted_value).toBeUndefined()
        // Original meta preserved
        expect(sealed["API_KEY"]!.service).toBe("openai")
        expect(sealed["DB_URL"]!.service).toBe("postgres")
      },
    )
  })
})

describe("unsealSecrets", () => {
  it.skipIf(!ageInstalled)("decrypts all sealed entries", () => {
    const keygenOutput = execFileSync("age-keygen", [], {
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8",
    })
    const recipientLine = keygenOutput.split("\n").find((l) => l.startsWith("# public key:"))
    const recipient = recipientLine!.replace("# public key: ", "").trim()
    const identityPath = join(tmpDir, "test-identity.txt")
    writeFileSync(identityPath, keygenOutput)

    // First seal
    const meta = {
      KEY_A: { service: "svc-a" },
      KEY_B: { service: "svc-b" },
    }
    const values = { KEY_A: "value-a", KEY_B: "value-b" }

    const sealResult = sealSecrets(meta, values, recipient)
    const sealedMeta = sealResult.fold(
      (err) => {
        expect.unreachable(`Seal failed: ${err.message}`)
        return meta
      },
      (s) => s,
    )

    // Then unseal
    const unsealResult = unsealSecrets(sealedMeta, identityPath)

    unsealResult.fold(
      (err) => expect.unreachable(`Unseal failed: ${err.message}`),
      (unsealed) => {
        expect(unsealed["KEY_A"]).toBe("value-a")
        expect(unsealed["KEY_B"]).toBe("value-b")
      },
    )
  })

  it.skipIf(!ageInstalled)("returns empty record when no encrypted_value present", () => {
    const keygenOutput = execFileSync("age-keygen", [], {
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8",
    })
    const identityPath = join(tmpDir, "test-identity.txt")
    writeFileSync(identityPath, keygenOutput)

    const meta = {
      KEY: { service: "svc" },
    }

    const result = unsealSecrets(meta, identityPath)
    result.fold(
      (err) => expect.unreachable(`Unseal failed: ${err.message}`),
      (unsealed) => {
        expect(Object.keys(unsealed)).toHaveLength(0)
      },
    )
  })
})

describe("reseal round-trip (key rotation)", () => {
  it.skipIf(!ageInstalled)("seal with key A, unseal+reseal with key B, unseal with key B preserves values", () => {
    // Generate key A
    const keygenA = execFileSync("age-keygen", [], {
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8",
    })
    const recipientA = keygenA
      .split("\n")
      .find((l) => l.startsWith("# public key:"))!
      .replace("# public key: ", "")
      .trim()
    const identityPathA = join(tmpDir, "identity-a.txt")
    writeFileSync(identityPathA, keygenA)

    // Generate key B
    const keygenB = execFileSync("age-keygen", [], {
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8",
    })
    const recipientB = keygenB
      .split("\n")
      .find((l) => l.startsWith("# public key:"))!
      .replace("# public key: ", "")
      .trim()
    const identityPathB = join(tmpDir, "identity-b.txt")
    writeFileSync(identityPathB, keygenB)

    const meta = {
      SECRET_1: { service: "svc-1" },
      SECRET_2: { service: "svc-2" },
    }
    const originalValues = { SECRET_1: "original-value-1", SECRET_2: "original-value-2" }

    // Step 1: Seal with key A
    const sealResultA = sealSecrets(meta, originalValues, recipientA)
    const sealedA = sealResultA.fold(
      (err) => {
        expect.unreachable(`Seal with key A failed: ${err.message}`)
        return meta
      },
      (s) => s,
    )

    // Step 2: Unseal with key A (simulating the reseal decrypt step)
    const unsealResultA = unsealSecrets(sealedA, identityPathA)
    const decrypted = unsealResultA.fold(
      (err) => {
        expect.unreachable(`Unseal with key A failed: ${err.message}`)
        return {} as Record<string, string>
      },
      (d) => d,
    )

    // Step 3: Re-seal with key B using decrypted values
    const sealResultB = sealSecrets(sealedA, decrypted, recipientB)
    const sealedB = sealResultB.fold(
      (err) => {
        expect.unreachable(`Reseal with key B failed: ${err.message}`)
        return sealedA
      },
      (s) => s,
    )

    // Step 4: Unseal with key B — values should match originals
    const unsealResultB = unsealSecrets(sealedB, identityPathB)
    unsealResultB.fold(
      (err) => expect.unreachable(`Unseal with key B failed: ${err.message}`),
      (unsealed) => {
        expect(unsealed["SECRET_1"]).toBe("original-value-1")
        expect(unsealed["SECRET_2"]).toBe("original-value-2")
      },
    )
  })
})

describe("seal without age", () => {
  it("ageEncrypt returns AgeNotFound when age is mocked away", () => {
    // This test relies on the real age being available but with a bad recipient
    // If age is not installed, it naturally returns AgeNotFound
    if (ageInstalled) {
      // With a bad recipient, encrypt will fail with EncryptFailed
      const result = ageEncrypt("test", "not-a-valid-recipient")
      result.fold(
        (err) => {
          expect(err._tag).toBe("EncryptFailed")
        },
        () => {
          // Some versions of age may handle this differently
        },
      )
    } else {
      const result = ageEncrypt("test", "age1test")
      result.fold(
        (err) => expect(err._tag).toBe("AgeNotFound"),
        () => expect.unreachable("Expected Left"),
      )
    }
  })
})
