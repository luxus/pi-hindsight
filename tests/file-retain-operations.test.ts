import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../extensions/config.js";
import { createFileRetainOperations } from "../extensions/file-retain-operations.js";
import type { HindsightLikeClient } from "../extensions/types.js";

describe("file retain operations", () => {
  it("uploads local files with merged shared and per-file metadata", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-hindsight-file-retain-"));
    const path = join(cwd, "guide.md");
    await writeFile(path, "# Guide\n");
    await writeFile(join(cwd, "shared.md"), "# Shared\n");
    const retainFiles = vi.fn(async () => ({ operation_ids: ["op-file"] }));
    const client: HindsightLikeClient = {
      retain: async () => undefined,
      recall: async () => [],
      reflect: async () => ({}),
      retainFiles,
    };
    const ops = createFileRetainOperations({
      getClient: () => client,
      getConfig: () => DEFAULT_CONFIG,
      getProjectBankId: () => "project-bank",
    });

    const result = await ops.retainFiles({
      cwd,
      files: [
        {
          path: "guide.md",
          context: "per file api_key: secret-value",
          documentId: "doc-guide",
          tags: ["file:guide"],
          metadata: { file: "guide", token: "ghp_abcdefghijklmnopqrstuvwxyz" },
        },
        {
          path: "shared.md",
          documentId: "doc-shared",
          tags: ["file:shared"],
        },
      ],
      context: "shared Bearer abcdefghijklmnopqrstuvwxyz",
      tags: ["shared"],
      metadata: { source: "unit", password: "secret-password" },
    });

    expect(result.bankId).toBe("project-bank");
    expect(result.fileCount).toBe(2);
    expect(retainFiles).toHaveBeenCalledWith("project-bank", [expect.any(Blob), expect.any(Blob)], {
      context: "shared Bearer [REDACTED]",
      filesMetadata: [
        {
          context: "per file api_key: [REDACTED]",
          documentId: "doc-guide",
          tags: ["shared", "file:guide"],
          metadata: {
            source: "unit",
            password: "[REDACTED]",
            file: "guide",
            token: "[REDACTED]",
          },
        },
        {
          context: "shared Bearer [REDACTED]",
          documentId: "doc-shared",
          tags: ["shared", "file:shared"],
          metadata: {
            source: "unit",
            password: "[REDACTED]",
          },
        },
      ],
    });
  });

  it("rejects file retain paths outside cwd", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-hindsight-file-retain-"));
    const outside = await mkdtemp(join(tmpdir(), "pi-hindsight-outside-"));
    await writeFile(join(outside, "secret.md"), "secret\n");
    const retainFiles = vi.fn(async () => ({ operation_ids: ["op-file"] }));
    const ops = createFileRetainOperations({
      getClient: () => ({
        retain: async () => undefined,
        recall: async () => [],
        reflect: async () => ({}),
        retainFiles,
      }),
      getConfig: () => DEFAULT_CONFIG,
      getProjectBankId: () => "project-bank",
    });

    await expect(
      ops.retainFiles({ cwd, files: [{ path: join(outside, "secret.md") }] }),
    ).rejects.toThrow("File retain path must stay within cwd");
    expect(retainFiles).not.toHaveBeenCalled();
  });
});
