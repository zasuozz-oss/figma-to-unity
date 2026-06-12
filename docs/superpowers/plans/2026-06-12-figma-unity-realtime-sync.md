# Figma ↔ Unity Realtime Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync một Figma element vào Unity ngay trong Editor (dán URL hoặc dùng selection hiện tại → bấm Sync → prefab, trùng tên thì replace), không bắt buộc có AI; kèm cơ chế bàn giao cho AI sau khi import.

**Architecture:** Thêm REST `/api/*` vào HTTP server `Leader` của bridge (port 1994), tách core export ghi-disk thành hàm dùng chung cho cả MCP tool và route mới, thêm entry standalone không cần stdio MCP. Unity có `FigmaSyncWindow` gọi REST qua `UnityWebRequest`, rồi chạy `FigmaImportRunner.Run` cục bộ.

**Tech Stack:** TypeScript + `bun:test` (bridge `FigExportForUnity/server`), TypeScript (plugin `FigExportForUnity/src`), C# Unity Editor + NUnit EditMode (`UnityFigImporter/Editor`).

**Nhánh:** `feature/figma-unity-realtime-sync` (đã tạo, không push `main`).

**Spec:** `docs/superpowers/specs/2026-06-12-figma-unity-realtime-sync-design.md`

**Lệnh build/test bridge** (chạy trong `FigExportForUnity/server`):
- Test: `bun test src`
- Build: `bun run build` (tsc → `dist/`)

---

## File Structure

**Bridge (`FigExportForUnity/server/src`)**
- Modify `figma-url.ts` — thêm `buildFigmaUrl()` (pure).
- Modify `figma-url.test.ts` — test cho `buildFigmaUrl`.
- Modify `tools.ts` — tách `exportElementToDisk()` (export core dùng chung), thêm `getManifestSummary()`; MCP tool gọi lại core.
- Create `tools.test.ts` — test `exportElementToDisk` + `getManifestSummary` với fake sender.
- Modify `bridge.ts` — thêm `isPluginConnected()`.
- Modify `leader.ts` — thêm routes `/api/health`, `/api/selection`, `/api/export_element`.
- Create `api.ts` — handler thuần cho selection (build `{nodeId,name,fileKey,url}`) để test riêng.
- Create `api.test.ts` — test handler selection với fake sender.
- Create `standalone.ts` — entry boot Node+Election, không MCP/stdio.
- Modify `package.json` — thêm script `start:standalone`.

**Plugin (`FigExportForUnity/src`)**
- Modify `main.ts` — thêm `fileKey: figma.fileKey ?? null` vào response `get_metadata`.

**Unity (`UnityFigImporter/Editor`)**
- Create `Sync/FigmaSyncUrl.cs` — pure: chuẩn hóa URL/node-id.
- Create `Sync/ImportDescriptor.cs` — pure: ghi `last-import.json` + build prompt.
- Create `Sync/FigmaBridgeClient.cs` — UnityWebRequest client (health/selection/export).
- Create `Sync/BridgeLauncher.cs` — spawn standalone bridge bằng Process.
- Create `Sync/FigmaSyncWindow.cs` — EditorWindow.
- Create `Tests/FigmaImporter.Editor.Tests.asmdef` — test assembly.
- Create `Tests/FigmaSyncUrlTests.cs`, `Tests/ImportDescriptorTests.cs` — EditMode tests.

---

## PHASE 1 — Bridge REST API (TypeScript, TDD với bun:test)

### Task 1: `buildFigmaUrl` pure helper

**Files:**
- Modify: `FigExportForUnity/server/src/figma-url.ts`
- Test: `FigExportForUnity/server/src/figma-url.test.ts`

- [ ] **Step 1: Viết test fail** — thêm vào cuối `figma-url.test.ts`:

```ts
import { buildFigmaUrl } from "./figma-url.js";

describe("buildFigmaUrl", () => {
  test("returns null when fileKey is missing", () => {
    expect(buildFigmaUrl(null, "1:2", "Shop")).toBeNull();
    expect(buildFigmaUrl(undefined, "1:2", "Shop")).toBeNull();
  });

  test("builds a design URL with hyphenated node-id and slug", () => {
    expect(buildFigmaUrl("AbC123", "4029:12345", "Mobile Game UI")).toBe(
      "https://www.figma.com/design/AbC123/Mobile-Game-UI?node-id=4029-12345"
    );
  });

  test("falls back to 'design' slug when name empty", () => {
    expect(buildFigmaUrl("KeY", "1:2", "")).toBe(
      "https://www.figma.com/design/KeY/design?node-id=1-2"
    );
  });

  test("strips unsafe slug characters", () => {
    expect(buildFigmaUrl("KeY", "1:2", "Shop / Pack #1")).toBe(
      "https://www.figma.com/design/KeY/Shop-Pack-1?node-id=1-2"
    );
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `cd FigExportForUnity/server && bun test src/figma-url.test.ts`
Expected: FAIL — `buildFigmaUrl is not a function` / không export.

- [ ] **Step 3: Implement** — thêm vào cuối `figma-url.ts`:

```ts
/**
 * Best-effort canonical Figma design URL. Returns null when fileKey is
 * unavailable (figma.fileKey can be undefined for unsaved/community files);
 * callers must still work with the colon node-id alone.
 */
export function buildFigmaUrl(
  fileKey: string | null | undefined,
  nodeId: string,
  name?: string
): string | null {
  if (!fileKey) return null;
  const slug =
    (name ?? "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^A-Za-z0-9-]/g, "") || "design";
  const hyphenId = nodeId.replace(":", "-");
  return `https://www.figma.com/design/${fileKey}/${slug}?node-id=${hyphenId}`;
}
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `cd FigExportForUnity/server && bun test src/figma-url.test.ts`
Expected: PASS (all `buildFigmaUrl` + `parseFigmaNodeId` tests).

- [ ] **Step 5: Commit**

```bash
git add FigExportForUnity/server/src/figma-url.ts FigExportForUnity/server/src/figma-url.test.ts
git commit -m "feat(bridge): add buildFigmaUrl pure helper"
```

---

### Task 2: Tách export core `exportElementToDisk` + `getManifestSummary`

**Files:**
- Modify: `FigExportForUnity/server/src/tools.ts:168-233` (export_element tool body)
- Create: `FigExportForUnity/server/src/tools.test.ts`

- [ ] **Step 1: Viết test fail** — tạo `tools.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { exportElementToDisk, getManifestSummary } from "./tools.js";
import type { BridgeResponse } from "./types.js";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function fakeSender(data: unknown) {
  return {
    sendWithParams: async (): Promise<BridgeResponse> => ({
      type: "response",
      requestId: "x",
      data,
    }),
  };
}

const samplePayload = {
  manifest: { screen: { name: "Shop Popup" }, elements: [{}, {}, {}] },
  assets: [{ name: "icon.png", data: [137, 80, 78, 71] }],
};

describe("getManifestSummary", () => {
  test("reads name + nodeCount from manifest", () => {
    expect(getManifestSummary(samplePayload.manifest)).toEqual({
      name: "Shop Popup",
      nodeCount: 3,
    });
  });

  test("defaults when manifest is malformed", () => {
    expect(getManifestSummary(null)).toEqual({ name: "export", nodeCount: 0 });
  });
});

describe("exportElementToDisk", () => {
  test("writes manifest.json + assets and returns summary", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "figexp-"));
    const result = await exportElementToDisk(fakeSender(samplePayload), {
      nodeId: "4029:12345",
      outputDir: dir,
    });

    expect(result.nodeId).toBe("4029:12345");
    expect(result.outputDir).toBe(path.resolve(dir));
    expect(result.assetCount).toBe(1);
    expect(result.assets).toEqual(["icon.png"]);
    expect(result.name).toBe("Shop Popup");
    expect(result.nodeCount).toBe(3);

    const files = (await readdir(result.outputDir)).sort();
    expect(files).toEqual(["icon.png", "manifest.json"]);
    const manifest = JSON.parse(
      await readFile(path.join(result.outputDir, "manifest.json"), "utf8")
    );
    expect(manifest.screen.name).toBe("Shop Popup");
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `cd FigExportForUnity/server && bun test src/tools.test.ts`
Expected: FAIL — `exportElementToDisk`/`getManifestSummary` không export.

- [ ] **Step 3: Implement** — trong `tools.ts`, thêm 2 hàm exported (đặt ngay trước `function getExportElementPayload`):

```ts
export interface ExportElementResult {
  nodeId: string;
  outputDir: string;
  assetCount: number;
  assets: string[];
  name: string;
  nodeCount: number;
}

/** Reads { name, nodeCount } from a manifest, with safe defaults. */
export function getManifestSummary(manifest: unknown): {
  name: string;
  nodeCount: number;
} {
  const m = manifest as { screen?: { name?: string }; elements?: unknown[] };
  return {
    name: m?.screen?.name ?? "export",
    nodeCount: Array.isArray(m?.elements) ? m!.elements!.length : 0,
  };
}

/**
 * Export core shared by the MCP `export_element` tool and the REST
 * `/api/export_element` route: calls the plugin, then writes manifest.json
 * + PNG assets to disk. Throws on any error.
 */
export async function exportElementToDisk(
  sender: ScreenshotSender,
  input: { nodeId?: string; figmaUrl?: string; outputDir?: string; scale?: number }
): Promise<ExportElementResult> {
  const resolvedNodeId = parseFigmaNodeId({
    nodeId: input.nodeId,
    figmaUrl: input.figmaUrl,
  });
  const explicitDir =
    input.outputDir !== undefined ? resolveExportDir(input.outputDir) : null;

  const resp = await sender.sendWithParams(
    "export_element",
    [resolvedNodeId],
    input.scale !== undefined && input.scale > 0 ? { scale: input.scale } : undefined,
    120_000
  );
  if (resp.error) throw new Error(resp.error);

  const payload = getExportElementPayload(resp.data);
  const resolvedDir = explicitDir ?? defaultExportDir(payload.manifest);
  const summary = getManifestSummary(payload.manifest);

  await emptyDir(resolvedDir);
  await writeFile(
    path.join(resolvedDir, "manifest.json"),
    JSON.stringify(payload.manifest, null, 2)
  );
  for (const asset of payload.assets) {
    await writeFile(path.join(resolvedDir, asset.name), Buffer.from(asset.data));
  }

  return {
    nodeId: resolvedNodeId,
    outputDir: resolvedDir,
    assetCount: payload.assets.length,
    assets: payload.assets.map((a) => a.name),
    name: summary.name,
    nodeCount: summary.nodeCount,
  };
}
```

- [ ] **Step 4: Refactor MCP tool gọi core** — thay body tool `export_element` (`tools.ts:172-232`) bằng:

```ts
    async ({ nodeId, figmaUrl, outputDir, scale }): Promise<ToolResult> => {
      try {
        const result = await exportElementToDisk(node, {
          nodeId,
          figmaUrl,
          outputDir,
          scale,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: err instanceof Error ? err.message : String(err),
            },
          ],
          isError: true,
        };
      }
    }
```

- [ ] **Step 5: Chạy toàn bộ test bridge, xác nhận pass**

Run: `cd FigExportForUnity/server && bun test src`
Expected: PASS (figma-url + tools tests).

- [ ] **Step 6: Commit**

```bash
git add FigExportForUnity/server/src/tools.ts FigExportForUnity/server/src/tools.test.ts
git commit -m "refactor(bridge): extract exportElementToDisk core shared by tool + REST"
```

---

### Task 3: `Bridge.isPluginConnected()`

**Files:**
- Modify: `FigExportForUnity/server/src/bridge.ts`

- [ ] **Step 1: Implement** — thêm method vào class `Bridge` (sau `sendWithParams`, trước `nextId`):

```ts
  isPluginConnected(): boolean {
    return this.conn !== null && this.conn.readyState === WebSocket.OPEN;
  }
```

- [ ] **Step 2: Build để chắc compile**

Run: `cd FigExportForUnity/server && bun run build`
Expected: tsc thành công, không lỗi.

- [ ] **Step 3: Commit**

```bash
git add FigExportForUnity/server/src/bridge.ts
git commit -m "feat(bridge): add isPluginConnected helper"
```

---

### Task 4: Selection API handler (pure) `buildSelectionInfo`

**Files:**
- Create: `FigExportForUnity/server/src/api.ts`
- Create: `FigExportForUnity/server/src/api.test.ts`

- [ ] **Step 1: Viết test fail** — tạo `api.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { buildSelectionInfo } from "./api.js";
import type { BridgeResponse } from "./types.js";

function sender(map: Record<string, unknown>) {
  return {
    sendWithParams: async (type: string): Promise<BridgeResponse> => ({
      type: "response",
      requestId: "x",
      data: map[type],
    }),
  };
}

describe("buildSelectionInfo", () => {
  test("returns nodeId + name + fileKey + url for first selected node", async () => {
    const s = sender({
      get_selection: [{ id: "4029:12345", name: "Shop", type: "FRAME" }],
      get_metadata: { fileName: "F", fileKey: "AbC123" },
    });
    expect(await buildSelectionInfo(s)).toEqual({
      nodeId: "4029:12345",
      name: "Shop",
      fileKey: "AbC123",
      url: "https://www.figma.com/design/AbC123/Shop?node-id=4029-12345",
    });
  });

  test("url null when fileKey missing", async () => {
    const s = sender({
      get_selection: [{ id: "1:2", name: "X", type: "FRAME" }],
      get_metadata: { fileName: "F", fileKey: null },
    });
    const info = await buildSelectionInfo(s);
    expect(info.fileKey).toBeNull();
    expect(info.url).toBeNull();
  });

  test("throws when nothing selected", async () => {
    const s = sender({ get_selection: [], get_metadata: {} });
    await expect(buildSelectionInfo(s)).rejects.toThrow(/No selection/);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `cd FigExportForUnity/server && bun test src/api.test.ts`
Expected: FAIL — module `api.js` chưa tồn tại.

- [ ] **Step 3: Implement** — tạo `api.ts`:

```ts
import { buildFigmaUrl } from "./figma-url.js";
import type { ScreenshotSender } from "./tools.js";

export interface SelectionInfo {
  nodeId: string;
  name: string;
  fileKey: string | null;
  url: string | null;
}

/** Combine plugin get_selection (first node) + get_metadata (fileKey). */
export async function buildSelectionInfo(
  sender: ScreenshotSender
): Promise<SelectionInfo> {
  const selResp = await sender.sendWithParams("get_selection");
  if (selResp.error) throw new Error(selResp.error);
  const nodes = Array.isArray(selResp.data) ? selResp.data : [];
  const first = nodes[0] as { id?: string; name?: string } | undefined;
  if (!first || typeof first.id !== "string") {
    throw new Error("No selection in Figma");
  }

  const metaResp = await sender.sendWithParams("get_metadata");
  const fileKey =
    (metaResp.data as { fileKey?: string | null } | undefined)?.fileKey ?? null;

  const nodeId = first.id;
  const name = first.name ?? "";
  return { nodeId, name, fileKey, url: buildFigmaUrl(fileKey, nodeId, name) };
}
```

- [ ] **Step 4: Export `ScreenshotSender`** — xác nhận `tools.ts` đã `export interface ScreenshotSender` (đã có, dòng 17). Nếu chưa export thì thêm `export`.

- [ ] **Step 5: Chạy test, xác nhận pass**

Run: `cd FigExportForUnity/server && bun test src/api.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add FigExportForUnity/server/src/api.ts FigExportForUnity/server/src/api.test.ts
git commit -m "feat(bridge): buildSelectionInfo combining selection + fileKey"
```

---

### Task 5: REST routes trong `Leader`

**Files:**
- Modify: `FigExportForUnity/server/src/leader.ts`

- [ ] **Step 1: Thêm imports** — đầu `leader.ts`, sau import hiện có:

```ts
import { exportElementToDisk } from "./tools.js";
import { buildSelectionInfo } from "./api.js";
```

- [ ] **Step 2: Thêm routing `/api/*`** — trong callback `http.createServer`, ngay trước `res.writeHead(404)`:

```ts
        if (req.url === "/api/health" && req.method === "GET") {
          this.sendJSON(res, 200, {
            data: {
              ok: true,
              version: VERSION,
              pluginConnected: this.bridge.isPluginConnected(),
            },
          });
          return;
        }

        if (req.url === "/api/selection" && req.method === "GET") {
          this.handleSelection(res);
          return;
        }

        if (req.url === "/api/export_element" && req.method === "POST") {
          this.handleExportElement(req, res);
          return;
        }
```

> `sendJSON` nhận `RPCResponse` (`{ data?, error? }`); ta gói payload trong `data`. Unity đọc trường `data`.

- [ ] **Step 3: Thêm 2 handler** — trong class `Leader`, sau `handleRPC`:

```ts
  private async handleSelection(res: http.ServerResponse): Promise<void> {
    try {
      const info = await buildSelectionInfo(this.bridge);
      this.sendJSON(res, 200, { data: info });
    } catch (err) {
      this.sendJSON(res, 200, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private handleExportElement(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): void {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on("end", async () => {
      try {
        const input = JSON.parse(body || "{}") as {
          nodeId?: string;
          figmaUrl?: string;
          outputDir?: string;
          scale?: number;
        };
        const result = await exportElementToDisk(this.bridge, input);
        this.sendJSON(res, 200, { data: result });
      } catch (err) {
        this.sendJSON(res, 200, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }
```

- [ ] **Step 4: Build, xác nhận compile**

Run: `cd FigExportForUnity/server && bun run build`
Expected: tsc thành công (tsconfig không bật `noUnusedLocals`; build bỏ qua `*.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add FigExportForUnity/server/src/leader.ts
git commit -m "feat(bridge): REST /api/health, /api/selection, /api/export_element"
```

---

### Task 6: Entry standalone (không stdio MCP)

**Files:**
- Create: `FigExportForUnity/server/src/standalone.ts`
- Modify: `FigExportForUnity/server/package.json`

- [ ] **Step 1: Implement** — tạo `standalone.ts`:

```ts
#!/usr/bin/env node

import { Node } from "./node.js";
import { Election } from "./election.js";

const PORT = Number(process.env.FIGMA_BRIDGE_PORT ?? 1994);

async function main(): Promise<void> {
  const node = new Node(PORT);
  const election = new Election(PORT, node);
  await election.start();

  const shutdown = () => {
    election.stop();
    node.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.error(`Standalone Figma bridge running (role: ${node.roleName})`);
  // Keep process alive; the HTTP/WS server (Leader) is bound by Election.
  setInterval(() => {}, 1 << 30);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Thêm script** — trong `package.json`, mục `scripts`:

```json
    "start:standalone": "node dist/standalone.js",
```

- [ ] **Step 3: Build**

Run: `cd FigExportForUnity/server && bun run build`
Expected: sinh `dist/standalone.js`.

- [ ] **Step 4: Smoke test thủ công** — mở Figma Desktop + plugin trước, rồi:

Run: `cd FigExportForUnity/server && (node dist/standalone.js &) ; sleep 2 ; curl -s http://localhost:1994/api/health ; kill %1 2>/dev/null`
Expected: JSON `{"data":{"ok":true,"version":"...","pluginConnected":true|false}}`.

- [ ] **Step 5: Commit**

```bash
git add FigExportForUnity/server/src/standalone.ts FigExportForUnity/server/package.json
git commit -m "feat(bridge): standalone entry (HTTP+WS, no stdio MCP)"
```

---

### Task 7: Plugin lộ `fileKey` qua `get_metadata`

**Files:**
- Modify: `FigExportForUnity/src/main.ts:548-559` (case `get_metadata`)

- [ ] **Step 1: Thêm field** — trong `case 'get_metadata':`, thêm `fileKey` vào object `response.data`:

```ts
            case 'get_metadata': {
                response.data = {
                    fileName: figma.root.name,
                    fileKey: figma.fileKey ?? null,
                    currentPage: {
                        id: figma.currentPage.id,
                        name: figma.currentPage.name,
                    },
                    pageCount: figma.root.children.length,
                    pages: figma.root.children.map(function (p: PageNode) {
                        return { id: p.id, name: p.name };
                    }),
                };
                break;
```

- [ ] **Step 2: Build plugin** (theo cách repo build plugin — kiểm tra `FigExportForUnity/package.json`):

Run: `cd FigExportForUnity && cat package.json | grep -A8 '"scripts"'`
Then run build script đó (vd `npm run build` / esbuild). Expected: bundle plugin cập nhật, không lỗi TS.

- [ ] **Step 3: Commit**

```bash
git add FigExportForUnity/src/main.ts
git commit -m "feat(plugin): expose figma.fileKey in get_metadata for URL building"
```

> ⚠️ Nếu tsc/typings báo `figma.fileKey` không tồn tại, dùng `(figma as any).fileKey ?? null`.

---

## PHASE 2 — Unity Editor (C#, EditMode test cho pure helpers)

### Task 8: `FigmaSyncUrl` pure helper + EditMode test infra

**Files:**
- Create: `UnityFigImporter/Editor/Sync/FigmaSyncUrl.cs`
- Create: `UnityFigImporter/Editor/Tests/FigmaImporter.Editor.Tests.asmdef`
- Create: `UnityFigImporter/Editor/Tests/FigmaSyncUrlTests.cs`

- [ ] **Step 1: Tạo test asmdef** — `Tests/FigmaImporter.Editor.Tests.asmdef`:

```json
{
    "name": "FigmaImporter.Editor.Tests",
    "rootNamespace": "FigmaImporter.Tests",
    "references": [
        "FigmaImporter.Editor",
        "UnityEngine.TestRunner",
        "UnityEditor.TestRunner"
    ],
    "includePlatforms": ["Editor"],
    "excludePlatforms": [],
    "overrideReferences": true,
    "precompiledReferences": ["nunit.framework.dll"],
    "autoReferenced": false,
    "defineConstraints": ["UNITY_INCLUDE_TESTS"]
}
```

- [ ] **Step 2: Viết test fail** — `Tests/FigmaSyncUrlTests.cs`:

```csharp
using NUnit.Framework;
using FigmaImporter.Sync;

namespace FigmaImporter.Tests
{
    public class FigmaSyncUrlTests
    {
        [Test]
        public void ExtractNodeId_FromUrl_ReturnsColonId()
        {
            Assert.AreEqual(
                "4029:12345",
                FigmaSyncUrl.ExtractNodeId(
                    "https://www.figma.com/design/AbC/My-File?node-id=4029-12345&t=x"));
        }

        [Test]
        public void ExtractNodeId_FromColonId_ReturnsVerbatim()
        {
            Assert.AreEqual("1:2", FigmaSyncUrl.ExtractNodeId("1:2"));
        }

        [Test]
        public void ExtractNodeId_Invalid_ReturnsNull()
        {
            Assert.IsNull(FigmaSyncUrl.ExtractNodeId("not a url"));
            Assert.IsNull(FigmaSyncUrl.ExtractNodeId(""));
        }
    }
}
```

- [ ] **Step 3: Implement** — `Sync/FigmaSyncUrl.cs`:

```csharp
using System.Text.RegularExpressions;

namespace FigmaImporter.Sync
{
    /// <summary>Pure helpers for normalizing Figma node references.</summary>
    public static class FigmaSyncUrl
    {
        static readonly Regex ColonId = new Regex(@"^\d+:\d+$");
        static readonly Regex NodeIdParam = new Regex(@"[?&]node-id=([0-9]+-[0-9]+)");

        /// <summary>
        /// Returns a colon node-id ("4029:12345") from either a colon id or a
        /// Figma URL with a node-id query param. Null if neither matches.
        /// </summary>
        public static string ExtractNodeId(string input)
        {
            if (string.IsNullOrWhiteSpace(input)) return null;
            input = input.Trim();
            if (ColonId.IsMatch(input)) return input;

            var m = NodeIdParam.Match(input);
            if (m.Success) return m.Groups[1].Value.Replace('-', ':');
            return null;
        }
    }
}
```

- [ ] **Step 4: Chạy EditMode test**

Run: `utk test --mode EditMode --filter FigmaImporter.Tests.FigmaSyncUrlTests`
Expected: 3 test PASS. (Nếu `utk` không có filter, chạy `utk test` và đọc kết quả.)

- [ ] **Step 5: Commit**

```bash
git add UnityFigImporter/Editor/Sync/FigmaSyncUrl.cs UnityFigImporter/Editor/Tests/
git commit -m "feat(unity): FigmaSyncUrl node-id parser + EditMode test infra"
```

---

### Task 9: `ImportDescriptor` (AI handoff) pure + test

**Files:**
- Create: `UnityFigImporter/Editor/Sync/ImportDescriptor.cs`
- Create: `UnityFigImporter/Editor/Tests/ImportDescriptorTests.cs`

- [ ] **Step 1: Viết test fail** — `Tests/ImportDescriptorTests.cs`:

```csharp
using System.IO;
using NUnit.Framework;
using FigmaImporter.Sync;

namespace FigmaImporter.Tests
{
    public class ImportDescriptorTests
    {
        [Test]
        public void Write_ProducesJsonWithAllFields()
        {
            var dir = Path.Combine(Path.GetTempPath(), Path.GetRandomFileName());
            Directory.CreateDirectory(dir);
            var path = Path.Combine(dir, "last-import.json");

            ImportDescriptor.Write(path, new ImportDescriptor.Data
            {
                name = "Shop",
                nodeId = "1:2",
                canonicalUrl = "https://figma/x",
                outputDir = "/tmp/exp",
                prefabPath = "Assets/Prefabs/UI/Shop.prefab",
            });

            StringAssert.Contains("\"name\": \"Shop\"", File.ReadAllText(path));
            StringAssert.Contains("\"prefabPath\": \"Assets/Prefabs/UI/Shop.prefab\"",
                File.ReadAllText(path));
        }

        [Test]
        public void BuildPrompt_ReferencesPrefabAndOutputDir()
        {
            var prompt = ImportDescriptor.BuildPrompt(new ImportDescriptor.Data
            {
                name = "Shop",
                outputDir = "/tmp/exp",
                prefabPath = "Assets/Prefabs/UI/Shop.prefab",
            });
            StringAssert.Contains("/tmp/exp", prompt);
            StringAssert.Contains("Assets/Prefabs/UI/Shop.prefab", prompt);
            StringAssert.Contains("figma-build", prompt);
        }
    }
}
```

- [ ] **Step 2: Implement** — `Sync/ImportDescriptor.cs`:

```csharp
using System.IO;
using Newtonsoft.Json;

namespace FigmaImporter.Sync
{
    /// <summary>
    /// Hand-off artifact written after an import so the AI agent (Claude) can
    /// continue with figma-build steps 4-6 (rename, hierarchy cleanup, scripts).
    /// Unity cannot call Claude directly — this prepares the descriptor + prompt.
    /// </summary>
    public static class ImportDescriptor
    {
        public class Data
        {
            public string name;
            public string nodeId;
            public string canonicalUrl;
            public string outputDir;
            public string prefabPath;
        }

        public static void Write(string path, Data data)
        {
            File.WriteAllText(path, JsonConvert.SerializeObject(data, Formatting.Indented));
        }

        public static string BuildPrompt(Data data)
        {
            return
$@"Continue the figma-build pipeline (steps 4-6) for the freshly imported prefab.
- Element: {data.name}
- Export folder: {data.outputDir}
- Imported prefab: {data.prefabPath}
Clean up the hierarchy to Unity naming standards, then generate and wire scripts per the figma-build skill.";
        }
    }
}
```

- [ ] **Step 3: Chạy EditMode test**

Run: `utk test --mode EditMode --filter FigmaImporter.Tests.ImportDescriptorTests`
Expected: 2 test PASS.

- [ ] **Step 4: Commit**

```bash
git add UnityFigImporter/Editor/Sync/ImportDescriptor.cs UnityFigImporter/Editor/Tests/ImportDescriptorTests.cs
git commit -m "feat(unity): ImportDescriptor for AI handoff (json + prompt)"
```

---

### Task 10: `FigmaBridgeClient` (UnityWebRequest)

**Files:**
- Create: `UnityFigImporter/Editor/Sync/FigmaBridgeClient.cs`

> Phần networking cần bridge sống nên verify thủ công (Task 14). Step build chỉ đảm bảo compile.

- [ ] **Step 1: Implement** — `Sync/FigmaBridgeClient.cs`:

```csharp
using System;
using System.Text;
using System.Threading;
using Newtonsoft.Json;
using UnityEngine.Networking;

namespace FigmaImporter.Sync
{
    /// <summary>Blocking REST client for the Figma bridge (localhost, fast).</summary>
    public class FigmaBridgeClient
    {
        readonly string _baseUrl;
        readonly int _timeoutMs;

        public FigmaBridgeClient(int port, int timeoutMs = 130000)
        {
            _baseUrl = $"http://localhost:{port}";
            _timeoutMs = timeoutMs;
        }

        [Serializable]
        public class HealthInfo { public bool ok; public string version; public bool pluginConnected; }

        [Serializable]
        public class SelectionInfo { public string nodeId; public string name; public string fileKey; public string url; }

        [Serializable]
        public class ExportResult { public string nodeId; public string outputDir; public int assetCount; public string name; public int nodeCount; }

        // Envelope: { data?: T, error?: string }
        class Envelope<T> { public T data; public string error; }

        public bool TryHealth(out HealthInfo info, out string error)
        {
            return Get("/api/health", out info, out error);
        }

        public bool TryGetSelection(out SelectionInfo info, out string error)
        {
            return Get("/api/selection", out info, out error);
        }

        public bool TryExportElement(string nodeId, string figmaUrl, out ExportResult result, out string error)
        {
            var body = JsonConvert.SerializeObject(new { nodeId, figmaUrl });
            return Post("/api/export_element", body, out result, out error);
        }

        bool Get<T>(string path, out T value, out string error)
        {
            using (var req = UnityWebRequest.Get(_baseUrl + path))
                return Send(req, out value, out error);
        }

        bool Post<T>(string path, string json, out T value, out string error)
        {
            using (var req = new UnityWebRequest(_baseUrl + path, "POST"))
            {
                req.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(json));
                req.downloadHandler = new DownloadHandlerBuffer();
                req.SetRequestHeader("Content-Type", "application/json");
                return Send(req, out value, out error);
            }
        }

        bool Send<T>(UnityWebRequest req, out T value, out string error)
        {
            value = default;
            error = null;
            var op = req.SendWebRequest();
            int waited = 0;
            while (!op.isDone && waited < _timeoutMs)
            {
                Thread.Sleep(15);
                waited += 15;
            }
            if (!op.isDone) { error = "Bridge request timed out"; return false; }
            if (req.result != UnityWebRequest.Result.Success)
            {
                error = $"Bridge offline ({req.error})";
                return false;
            }
            var env = JsonConvert.DeserializeObject<Envelope<T>>(req.downloadHandler.text);
            if (env != null && !string.IsNullOrEmpty(env.error)) { error = env.error; return false; }
            if (env == null || env.data == null) { error = "Empty bridge response"; return false; }
            value = env.data;
            return true;
        }
    }
}
```

- [ ] **Step 2: Build/compile check**

Run: `utk exec 'return 1+1;'`
Expected: trả `2` (= compile sạch, không lỗi mới trong `utk console`).

- [ ] **Step 3: Commit**

```bash
git add UnityFigImporter/Editor/Sync/FigmaBridgeClient.cs
git commit -m "feat(unity): FigmaBridgeClient REST wrapper for the Figma bridge"
```

---

### Task 11: `BridgeLauncher` (spawn standalone)

**Files:**
- Create: `UnityFigImporter/Editor/Sync/BridgeLauncher.cs`

- [ ] **Step 1: Implement** — `Sync/BridgeLauncher.cs`:

```csharp
using System.Diagnostics;
using System.IO;
using UnityEditor;

namespace FigmaImporter.Sync
{
    /// <summary>Spawns the standalone bridge (node dist/standalone.js) when none is running.</summary>
    public static class BridgeLauncher
    {
        const string PREF_NODE = "FigmaSync_NodePath";
        const string PREF_BRIDGE = "FigmaSync_BridgeDir";

        public static string NodePath
        {
            get => EditorPrefs.GetString(PREF_NODE, "node");
            set => EditorPrefs.SetString(PREF_NODE, value);
        }

        /// <summary>Path to FigExportForUnity/server (contains dist/standalone.js).</summary>
        public static string BridgeDir
        {
            get => EditorPrefs.GetString(PREF_BRIDGE, "");
            set => EditorPrefs.SetString(PREF_BRIDGE, value);
        }

        public static bool TrySpawn(out string error)
        {
            error = null;
            var script = Path.Combine(BridgeDir, "dist", "standalone.js");
            if (string.IsNullOrEmpty(BridgeDir) || !File.Exists(script))
            {
                error = $"standalone.js not found at: {script}. Set the bridge dir.";
                return false;
            }
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = NodePath,
                    Arguments = $"\"{script}\"",
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WorkingDirectory = BridgeDir,
                };
                Process.Start(psi);
                return true;
            }
            catch (System.Exception ex)
            {
                error = $"Failed to spawn node: {ex.Message}";
                return false;
            }
        }
    }
}
```

- [ ] **Step 2: Compile check**

Run: `utk exec 'return 1+1;'`
Expected: `2`, không lỗi mới.

- [ ] **Step 3: Commit**

```bash
git add UnityFigImporter/Editor/Sync/BridgeLauncher.cs
git commit -m "feat(unity): BridgeLauncher to spawn standalone bridge"
```

---

### Task 12: `FigmaSyncWindow` EditorWindow

**Files:**
- Create: `UnityFigImporter/Editor/Sync/FigmaSyncWindow.cs`

- [ ] **Step 1: Implement** — `Sync/FigmaSyncWindow.cs`:

```csharp
using System.IO;
using Newtonsoft.Json;
using UnityEditor;
using UnityEngine;

namespace FigmaImporter.Sync
{
    public class FigmaSyncWindow : EditorWindow
    {
        const string PREF_PORT = "FigmaSync_Port";

        int _port = 1994;
        string _figmaUrl = "";
        string _selectionName = "";
        OutputMode _outputMode = OutputMode.Both;
        string _prefabSavePath = "Assets/Prefabs/UI/";

        FigmaBridgeClient.HealthInfo _health;
        string _status = "";
        bool _statusIsError;

        ImportDescriptor.Data _lastImport;
        Texture2D _previewTex;

        [MenuItem("Window/Figma/Sync")]
        public static void Open()
        {
            GetWindow<FigmaSyncWindow>("Figma Sync");
        }

        void OnEnable()
        {
            _port = EditorPrefs.GetInt(PREF_PORT, 1994);
        }

        FigmaBridgeClient Client => new FigmaBridgeClient(_port);

        void OnGUI()
        {
            EditorGUILayout.LabelField("Figma → Unity Sync", EditorStyles.boldLabel);
            EditorGUILayout.Space(6);

            DrawConnection();
            EditorGUILayout.Space(6);
            DrawSource();
            EditorGUILayout.Space(6);
            DrawOptions();
            EditorGUILayout.Space(6);
            DrawSyncButton();
            EditorGUILayout.Space(6);
            DrawResult();
        }

        void DrawConnection()
        {
            EditorGUILayout.BeginHorizontal();
            int newPort = EditorGUILayout.IntField("Port", _port);
            if (newPort != _port) { _port = newPort; EditorPrefs.SetInt(PREF_PORT, _port); }
            if (GUILayout.Button("Check", GUILayout.Width(60)))
            {
                if (Client.TryHealth(out _health, out var err))
                    SetStatus($"Bridge OK (plugin {( _health.pluginConnected ? "connected" : "NOT connected")})", !_health.pluginConnected);
                else { _health = null; SetStatus(err, true); }
            }
            EditorGUILayout.EndHorizontal();

            if (_health == null)
            {
                EditorGUILayout.HelpBox("Bridge offline. Open Figma Desktop + plugin, or spawn standalone.", MessageType.Warning);
                BridgeLauncher.BridgeDir = EditorGUILayout.TextField("Bridge dir", BridgeLauncher.BridgeDir);
                BridgeLauncher.NodePath = EditorGUILayout.TextField("node path", BridgeLauncher.NodePath);
                if (GUILayout.Button("Spawn standalone bridge"))
                {
                    if (BridgeLauncher.TrySpawn(out var err)) SetStatus("Spawned bridge — press Check in ~2s.", false);
                    else SetStatus(err, true);
                }
            }
        }

        void DrawSource()
        {
            _figmaUrl = EditorGUILayout.TextField("Figma URL / node-id", _figmaUrl);
            if (GUILayout.Button("Use current Figma selection"))
            {
                if (Client.TryGetSelection(out var sel, out var err))
                {
                    _figmaUrl = !string.IsNullOrEmpty(sel.url) ? sel.url : sel.nodeId;
                    _selectionName = sel.name;
                    SetStatus($"Selected: {sel.name} ({sel.nodeId})", false);
                }
                else SetStatus(err, true);
            }
            if (!string.IsNullOrEmpty(_selectionName))
                EditorGUILayout.LabelField("Selection", _selectionName);
        }

        void DrawOptions()
        {
            _outputMode = (OutputMode)EditorGUILayout.EnumPopup("Output Mode", _outputMode);
            if (_outputMode == OutputMode.Prefab || _outputMode == OutputMode.Both)
                _prefabSavePath = EditorGUILayout.TextField("Prefab Save Path", _prefabSavePath);
        }

        void DrawSyncButton()
        {
            using (new EditorGUI.DisabledScope(string.IsNullOrWhiteSpace(_figmaUrl)))
            {
                if (GUILayout.Button("Sync", GUILayout.Height(32)))
                    DoSync();
            }
        }

        void DoSync()
        {
            var nodeId = FigmaSyncUrl.ExtractNodeId(_figmaUrl);
            var isUrl = nodeId == null && _figmaUrl.Contains("figma.com");
            if (nodeId == null && !isUrl)
            {
                SetStatus("Invalid Figma URL or node-id.", true);
                return;
            }

            EditorUtility.DisplayProgressBar("Figma Sync", "Exporting from Figma...", 0.3f);
            try
            {
                if (!Client.TryExportElement(nodeId, isUrl ? _figmaUrl : null, out var export, out var err))
                {
                    SetStatus(err, true);
                    return;
                }

                EditorUtility.DisplayProgressBar("Figma Sync", "Importing into Unity...", 0.7f);
                var request = new ImportRequest
                {
                    ExportFolder = export.outputDir,
                    OutputMode = _outputMode,
                    PrefabSavePath = _prefabSavePath,
                };
                var result = FigmaImportRunner.Run(request);
                if (!result.Success)
                {
                    SetStatus("Import failed: " + string.Join(" | ", result.Log.ConvertAll(e => e.Message)), true);
                    return;
                }

                var prefabPath = Path.Combine(_prefabSavePath, result.RootName + ".prefab").Replace('\\', '/');
                _lastImport = new ImportDescriptor.Data
                {
                    name = export.name,
                    nodeId = export.nodeId,
                    canonicalUrl = _figmaUrl,
                    outputDir = export.outputDir,
                    prefabPath = prefabPath,
                };
                LoadPreview(prefabPath);
                SetStatus($"Done. Built {result.RootName} ({export.nodeCount} nodes).", false);
            }
            finally
            {
                EditorUtility.ClearProgressBar();
            }
        }

        void LoadPreview(string prefabPath)
        {
            var go = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath);
            _previewTex = go != null ? AssetPreview.GetAssetPreview(go) : null;
        }

        void DrawResult()
        {
            if (!string.IsNullOrEmpty(_status))
                EditorGUILayout.HelpBox(_status, _statusIsError ? MessageType.Error : MessageType.Info);

            if (_previewTex != null)
            {
                var rect = GUILayoutUtility.GetRect(256, 256, GUILayout.ExpandWidth(false));
                GUI.DrawTexture(rect, _previewTex, ScaleMode.ScaleToFit);
            }

            if (_lastImport != null && GUILayout.Button("Refine with AI (copy prompt + write descriptor)"))
            {
                var descPath = Path.Combine(Application.dataPath, "..", "Temp", "figma-last-import.json");
                ImportDescriptor.Write(Path.GetFullPath(descPath), _lastImport);
                EditorGUIUtility.systemCopyBuffer = ImportDescriptor.BuildPrompt(_lastImport);
                SetStatus($"Prompt copied. Descriptor: {Path.GetFullPath(descPath)}", false);
            }
        }

        void SetStatus(string msg, bool isError)
        {
            _status = msg;
            _statusIsError = isError;
            Repaint();
        }
    }
}
```

- [ ] **Step 2: Compile check + window mở được**

Run: `utk exec 'UnityEditor.EditorWindow.GetWindow(System.Type.GetType("FigmaImporter.Sync.FigmaSyncWindow, FigmaImporter.Editor")); return "opened";'`
Expected: trả `"opened"`, không lỗi compile trong `utk console`.

- [ ] **Step 3: Commit**

```bash
git add UnityFigImporter/Editor/Sync/FigmaSyncWindow.cs
git commit -m "feat(unity): FigmaSyncWindow — connect, select, sync, preview, AI handoff"
```

---

### Task 13: Cập nhật `.meta` tracking + tài liệu README ngắn

**Files:**
- Modify: `UnityFigImporter/README.md` (mục mới "Realtime Sync window")

- [ ] **Step 1: Đảm bảo `.meta` mới được track** (repo track `.cs.meta`):

Run: `git status --short UnityFigImporter/Editor/Sync UnityFigImporter/Editor/Tests`
Expected: thấy các file `.cs` + `.cs.meta`. `git add` cả `.meta`.

- [ ] **Step 2: Thêm mục README** — thêm vào `UnityFigImporter/README.md`:

```markdown
## Realtime Sync window (Window ▸ Figma ▸ Sync)

Sync một element từ Figma vào Unity không cần AI:
1. Mở Figma Desktop + plugin FigExportForUnity.
2. Mở **Window ▸ Figma ▸ Sync**, bấm **Check** (port mặc định 1994).
   Nếu bridge offline, set "Bridge dir" = `FigExportForUnity/server` rồi **Spawn standalone bridge**.
3. Dán Figma URL hoặc bấm **Use current Figma selection**.
4. Chọn Output Mode (mặc định Both) và bấm **Sync** → prefab được tạo (trùng tên thì replace).
5. (tùy chọn) **Refine with AI** để bàn giao cho Claude làm rename/scripts (figma-build 4-6).
```

- [ ] **Step 3: Commit**

```bash
git add UnityFigImporter/Editor/Sync UnityFigImporter/Editor/Tests UnityFigImporter/README.md
git commit -m "docs(unity): document Figma Sync window; track Sync/Tests meta files"
```

---

### Task 14: Verification end-to-end (thủ công)

- [ ] **Step 1: Build bridge + plugin**

Run: `cd FigExportForUnity/server && bun run build && bun test src`
Expected: build OK, tất cả test PASS.

- [ ] **Step 2: Mở Figma Desktop + plugin**, chọn 1 frame/popup.

- [ ] **Step 3: Trong Unity**, mở Window ▸ Figma ▸ Sync → Check → "Use current Figma selection".
Expected: URL + tên element xuất hiện.

- [ ] **Step 4: Bấm Sync.**
Expected: status "Done. Built <name> (N nodes)", ảnh preview prefab hiện ra, prefab xuất hiện tại `Assets/Prefabs/UI/<name>.prefab`.

- [ ] **Step 5: Sync lại cùng element.**
Expected: prefab cũ bị overwrite (không tạo bản `(1)`).

- [ ] **Step 6: Bấm "Refine with AI".**
Expected: clipboard chứa prompt; file `Temp/figma-last-import.json` tồn tại.

- [ ] **Step 7: Báo cáo** mọi sai lệch; nếu pass hết → plan hoàn tất.

---

## Self-Review

**Spec coverage:**
- Chọn URL + selection → Task 4 (selection API) + Task 12 (window source). ✓
- Replace prefab khi trùng tên → tự động qua `SaveAsPrefabAsset` (Task 12 dùng `FigmaImportRunner.Run`); verify Task 14 Step 5. ✓
- Preview kết quả Unity + status → Task 12 `LoadPreview`/`AssetPreview` + "Done. Built …". ✓
- Auto-detect kết nối + standalone spawn → Task 6 (standalone) + Task 11 (launcher) + Task 12 (Check/Spawn). ✓
- Chạy không cần AI + handoff AI → Task 9 + Task 12 "Refine with AI". ✓
- URL chuẩn dùng chung 2 chiều → Task 1 `buildFigmaUrl` (server, neutral) + Task 7 plugin `fileKey`. ✓
- fileKey best-effort (rủi ro) → Task 1 trả null khi thiếu, Task 4 url=null. ✓
- nodeCount derive từ elements → Task 2 `getManifestSummary`. ✓
- Sửa TS source rồi rebuild → các step build trong Phase 1. ✓

**Type consistency:** `ExportResult` (C# Task 10) khớp field server trả từ `exportElementToDisk` (Task 2): `nodeId,outputDir,assetCount,name,nodeCount`. `SelectionInfo` (Task 10) khớp `buildSelectionInfo` (Task 4): `nodeId,name,fileKey,url`. `ImportDescriptor.Data` dùng nhất quán Task 9 ↔ Task 12. Envelope `{data,error}` khớp `sendJSON` (Task 5).

**Placeholder scan:** không có TBD/“xử lý lỗi phù hợp”; mọi step có code/lệnh cụ thể.
