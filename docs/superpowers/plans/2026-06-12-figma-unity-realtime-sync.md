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

- [ ] **Step 1: Viết test fail** — sửa import dòng 2 thành `import { parseFigmaNodeId, buildFigmaUrl } from "./figma-url.js";`, rồi thêm block sau vào cuối `figma-url.test.ts`:

```ts
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

---

## PHASE 3 — V2: Tách Sync/Build, staging `.unity-figma`, Library tab

> Tham chiếu spec: section "V2" trong `docs/superpowers/specs/2026-06-12-figma-unity-realtime-sync-design.md`.
> Baseline: v1 đã commit trên `feature/figma-unity-realtime-sync` (FigmaSyncWindow build-ngay-sau-sync).
>
> **Thứ tự bắt buộc:** Task 15 (server) → 16 (SyncLibrary) → 17 (client + patch tối thiểu để compile) → 18 (window rework) → 19 (docs + verify). Task 17 đổi chữ ký `TryExportElement` và patch luôn call-site trong cùng commit để Unity không bao giờ ở trạng thái không compile.

### Task 15: Server — `includePreview` + ghi `preview.png`

**Files:**
- Modify: `FigExportForUnity/server/src/tools.ts`
- Modify: `FigExportForUnity/server/src/leader.ts:171-176` (parse `includePreview`)
- Test: `FigExportForUnity/server/src/tools.test.ts`

- [ ] **Step 1: Viết test fail** — thêm vào cuối `tools.test.ts` (sau describe `exportElementToDisk` hiện có):

```ts
function typedSender(
  map: Record<string, unknown>,
  errors: Record<string, string> = {}
) {
  return {
    sendWithParams: async (type: string): Promise<BridgeResponse> => ({
      type: "response",
      requestId: "x",
      data: map[type],
      error: errors[type],
    }),
  };
}

const pngBase64 = Buffer.from([137, 80, 78, 71]).toString("base64");
const screenshotPayload = {
  exports: [
    {
      nodeId: "4029:12345",
      nodeName: "Shop Popup",
      format: "PNG",
      base64: pngBase64,
      width: 4,
      height: 1,
    },
  ],
};

describe("exportElementToDisk includePreview", () => {
  test("writes preview.png and returns previewFile", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "figexp-"));
    const sender = typedSender({
      export_element: samplePayload,
      get_screenshot: screenshotPayload,
    });
    const result = await exportElementToDisk(sender, {
      nodeId: "4029:12345",
      outputDir: dir,
      includePreview: true,
    });

    expect(result.previewFile).toBe("preview.png");
    const files = (await readdir(result.outputDir)).sort();
    expect(files).toEqual(["icon.png", "manifest.json", "preview.png"]);
    const png = await readFile(path.join(result.outputDir, "preview.png"));
    expect([...png]).toEqual([137, 80, 78, 71]);
  });

  test("screenshot failure does not fail the export (best-effort)", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "figexp-"));
    const sender = typedSender(
      { export_element: samplePayload },
      { get_screenshot: "screenshot failed" }
    );
    const result = await exportElementToDisk(sender, {
      nodeId: "4029:12345",
      outputDir: dir,
      includePreview: true,
    });

    expect(result.previewFile).toBeNull();
    const files = (await readdir(result.outputDir)).sort();
    expect(files).toEqual(["icon.png", "manifest.json"]);
  });

  test("previewFile null when includePreview omitted", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "figexp-"));
    const result = await exportElementToDisk(fakeSender(samplePayload), {
      nodeId: "4029:12345",
      outputDir: dir,
    });
    expect(result.previewFile).toBeNull();
  });

  test("rejects plugin asset named preview.png", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "figexp-"));
    const evil = {
      manifest: samplePayload.manifest,
      assets: [{ name: "preview.png", data: [1, 2, 3] }],
    };
    await expect(
      exportElementToDisk(fakeSender(evil), {
        nodeId: "4029:12345",
        outputDir: dir,
      })
    ).rejects.toThrow(/Unsafe/);
  });
});
```

- [ ] **Step 2: Chạy test, verify fail**

Run: `cd FigExportForUnity/server && bun test src/tools.test.ts`
Expected: FAIL — `previewFile` không tồn tại trên result / asset `preview.png` không bị reject.

- [ ] **Step 3: Implement trong `tools.ts`** — 4 thay đổi:

(a) `ExportElementResult` thêm field:

```ts
export interface ExportElementResult {
  nodeId: string;
  outputDir: string;
  assetCount: number;
  assets: string[];
  name: string;
  nodeCount: number;
  previewFile: string | null;
}
```

(b) Chữ ký input của `exportElementToDisk` thêm `includePreview`:

```ts
export async function exportElementToDisk(
  sender: ScreenshotSender,
  input: {
    nodeId?: string;
    figmaUrl?: string;
    outputDir?: string;
    scale?: number;
    includePreview?: boolean;
  }
): Promise<ExportElementResult> {
```

(c) Sau vòng `for (const asset of payload.assets)` ghi assets, TRƯỚC `return`:

```ts
  let previewFile: string | null = null;
  if (input.includePreview) {
    try {
      const shot = await sender.sendWithParams(
        "get_screenshot",
        [resolvedNodeId],
        { format: "PNG" },
        120_000
      );
      if (shot.error) throw new Error(shot.error);
      const screenshot = getSingleScreenshotExport(shot.data);
      await writeFile(
        path.join(resolvedDir, "preview.png"),
        Buffer.from(screenshot.base64, "base64")
      );
      previewFile = "preview.png";
    } catch {
      // Best-effort: a failed preview must never fail the export itself.
      previewFile = null;
    }
  }
```

và thêm `previewFile,` vào object `return { ... }`.

(d) `isSafeAssetFileName` blacklist thêm preview:

```ts
    lowerName !== "manifest.json" &&
    lowerName !== "preview.png" &&
```

- [ ] **Step 4: Parse `includePreview` trong `leader.ts`** — trong `handleExportElement`, mở rộng type cast của `input`:

```ts
        const input = JSON.parse(body || "{}") as {
          nodeId?: string;
          figmaUrl?: string;
          outputDir?: string;
          scale?: number;
          includePreview?: boolean;
        };
```

(`exportElementToDisk(this.bridge, input)` đã truyền nguyên `input` — không cần đổi gì thêm.)

- [ ] **Step 5: Chạy toàn bộ test + build**

Run: `cd FigExportForUnity/server && bun test src && bun run build`
Expected: tất cả PASS (18 cũ + 4 mới), tsc build OK.

- [ ] **Step 6: Commit**

```bash
git add FigExportForUnity/server/src/tools.ts FigExportForUnity/server/src/leader.ts FigExportForUnity/server/src/tools.test.ts
git commit -m "feat(server): includePreview on export_element — write preview.png via get_screenshot relay"
```

---

### Task 16: `SyncLibrary` — model cho `.unity-figma` + EditMode tests

**Files:**
- Create: `UnityFigImporter/Editor/Sync/SyncLibrary.cs`
- Test: `UnityFigImporter/Editor/Tests/SyncLibraryTests.cs`

- [ ] **Step 1: Viết test fail** — `UnityFigImporter/Editor/Tests/SyncLibraryTests.cs`:

```csharp
using System;
using System.IO;
using FigmaImporter.Sync;
using NUnit.Framework;

namespace FigmaImporter.Tests
{
    public class SyncLibraryTests
    {
        string _root;

        [SetUp]
        public void SetUp()
        {
            _root = Path.Combine(Path.GetTempPath(), "unity-figma-tests-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(_root);
        }

        [TearDown]
        public void TearDown()
        {
            if (Directory.Exists(_root)) Directory.Delete(_root, true);
        }

        void WriteManifest(string folderName, string json)
        {
            var folder = Path.Combine(_root, folderName);
            Directory.CreateDirectory(folder);
            File.WriteAllText(Path.Combine(folder, "manifest.json"), json);
        }

        [Test]
        public void FolderFor_HyphenatesNodeId()
        {
            StringAssert.EndsWith("6839-39318", SyncLibrary.FolderFor("6839:39318"));
        }

        [Test]
        public void List_ParsesManifest()
        {
            WriteManifest("10-20", "{\"screen\":{\"name\":\"Shop\"},\"elements\":[{},{}]}");
            var entries = SyncLibrary.List(_root);
            Assert.AreEqual(1, entries.Count);
            Assert.AreEqual("Shop", entries[0].Name);
            Assert.AreEqual(2, entries[0].NodeCount);
            Assert.AreEqual("10:20", entries[0].NodeId);
            Assert.IsNull(entries[0].PreviewPath);
        }

        [Test]
        public void List_SkipsCorruptAndEmptyFolders()
        {
            WriteManifest("1-2", "not json at all");
            Directory.CreateDirectory(Path.Combine(_root, "3-4")); // no manifest
            WriteManifest("5-6", "{\"screen\":{\"name\":\"Ok\"},\"elements\":[]}");
            var entries = SyncLibrary.List(_root);
            Assert.AreEqual(1, entries.Count);
            Assert.AreEqual("Ok", entries[0].Name);
        }

        [Test]
        public void List_SortsNewestFirst()
        {
            WriteManifest("1-1", "{\"screen\":{\"name\":\"Old\"},\"elements\":[]}");
            WriteManifest("2-2", "{\"screen\":{\"name\":\"New\"},\"elements\":[]}");
            File.SetLastWriteTimeUtc(
                Path.Combine(_root, "1-1", "manifest.json"),
                DateTime.UtcNow.AddHours(-5));
            var entries = SyncLibrary.List(_root);
            Assert.AreEqual("New", entries[0].Name);
            Assert.AreEqual("Old", entries[1].Name);
        }

        [Test]
        public void FormatAge_MinutesHoursDays()
        {
            Assert.AreEqual("0m", SyncLibrary.FormatAge(DateTime.UtcNow));
            Assert.AreEqual("22m", SyncLibrary.FormatAge(DateTime.UtcNow.AddMinutes(-22)));
            Assert.AreEqual("4h", SyncLibrary.FormatAge(DateTime.UtcNow.AddHours(-4).AddMinutes(-5)));
            Assert.AreEqual("3d", SyncLibrary.FormatAge(DateTime.UtcNow.AddDays(-3).AddHours(-1)));
        }
    }
}
```

- [ ] **Step 2: Implement** — `UnityFigImporter/Editor/Sync/SyncLibrary.cs`:

```csharp
using System;
using System.Collections.Generic;
using System.IO;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace FigmaImporter.Sync
{
    /// <summary>Model for the .unity-figma staging folder (one subfolder per synced element).</summary>
    public static class SyncLibrary
    {
        public class Entry
        {
            public string Folder;
            public string Name;
            public string NodeId;
            public string ManifestPath;
            public string PreviewPath; // null when preview.png is missing
            public int NodeCount;
            public DateTime SyncedAtUtc;
        }

        /// <summary>&lt;UnityProject&gt;/.unity-figma — dot-prefix keeps it out of the asset pipeline.</summary>
        public static string Root =>
            Path.Combine(Path.GetDirectoryName(Application.dataPath), ".unity-figma");

        /// <summary>Subfolder for one element, keyed by hyphenated nodeId ("6839:39318" → "6839-39318").</summary>
        public static string FolderFor(string nodeId) =>
            Path.Combine(Root, nodeId.Replace(':', '-'));

        public static List<Entry> List() => List(Root);

        /// <summary>Scan a staging root; folders without a readable manifest are skipped. Newest first.</summary>
        public static List<Entry> List(string root)
        {
            var entries = new List<Entry>();
            if (!Directory.Exists(root)) return entries;
            foreach (var folder in Directory.GetDirectories(root))
            {
                var entry = Load(folder);
                if (entry != null) entries.Add(entry);
            }
            entries.Sort((a, b) => b.SyncedAtUtc.CompareTo(a.SyncedAtUtc));
            return entries;
        }

        public static Entry Load(string folder)
        {
            var manifestPath = Path.Combine(folder, "manifest.json");
            if (!File.Exists(manifestPath)) return null;
            try
            {
                var manifest = JObject.Parse(File.ReadAllText(manifestPath));
                var elements = manifest["elements"] as JArray;
                var previewPath = Path.Combine(folder, "preview.png");
                return new Entry
                {
                    Folder = folder,
                    Name = (string)manifest.SelectToken("screen.name") ?? Path.GetFileName(folder),
                    NodeId = Path.GetFileName(folder).Replace('-', ':'),
                    ManifestPath = manifestPath,
                    PreviewPath = File.Exists(previewPath) ? previewPath : null,
                    NodeCount = elements != null ? elements.Count : 0,
                    SyncedAtUtc = File.GetLastWriteTimeUtc(manifestPath),
                };
            }
            catch
            {
                return null; // corrupt manifest → skip this folder
            }
        }

        public static void Delete(Entry entry)
        {
            if (Directory.Exists(entry.Folder))
                Directory.Delete(entry.Folder, true);
        }

        public static Texture2D LoadPreview(Entry entry)
        {
            if (entry == null || entry.PreviewPath == null || !File.Exists(entry.PreviewPath))
                return null;
            var tex = new Texture2D(2, 2);
            return tex.LoadImage(File.ReadAllBytes(entry.PreviewPath)) ? tex : null;
        }

        /// <summary>"0m", "22m", "4h", "3d" — relative age for the Library list.</summary>
        public static string FormatAge(DateTime utc)
        {
            var span = DateTime.UtcNow - utc;
            if (span.TotalMinutes < 60) return Math.Max(0, (int)span.TotalMinutes) + "m";
            if (span.TotalHours < 24) return (int)span.TotalHours + "h";
            return (int)span.TotalDays + "d";
        }
    }
}
```

- [ ] **Step 3: Compile + chạy test**

Run: `utk --project /Users/zasuo/Unity/Unity-AI editor refresh --compile` rồi
`utk --project /Users/zasuo/Unity/Unity-AI test --filter FigmaImporter.Tests`
Expected: 0 compile error; 10/10 test PASS (5 cũ + 5 mới). Nếu lần đầu báo "connection closed before response" (domain reload) → đợi ~20s rồi chạy lại (tối đa 3 lần).

- [ ] **Step 4: Commit**

```bash
git add UnityFigImporter/Editor/Sync/SyncLibrary.cs UnityFigImporter/Editor/Sync/SyncLibrary.cs.meta UnityFigImporter/Editor/Tests/SyncLibraryTests.cs UnityFigImporter/Editor/Tests/SyncLibraryTests.cs.meta
git commit -m "feat(unity): SyncLibrary — .unity-figma staging model + EditMode tests"
```

---

### Task 17: `FigmaBridgeClient` v2 — `previewFile` + xuất vào staging

**Files:**
- Modify: `UnityFigImporter/Editor/Sync/FigmaBridgeClient.cs:28,42-46`
- Modify: `UnityFigImporter/Editor/Sync/FigmaSyncWindow.cs` (patch tối thiểu call-site — giữ compile; rework đầy đủ ở Task 18)

- [ ] **Step 1: Sửa `ExportResult` + `TryExportElement`** trong `FigmaBridgeClient.cs`:

```csharp
        [Serializable]
        public class ExportResult { public string nodeId; public string outputDir; public int assetCount; public string name; public int nodeCount; public string previewFile; }
```

```csharp
        public bool TryExportElement(string nodeId, string outputDir, out ExportResult result, out string error)
        {
            var body = JsonConvert.SerializeObject(new { nodeId, outputDir, includePreview = true });
            return Post("/api/export_element", body, out result, out error);
        }
```

- [ ] **Step 2: Patch call-site trong `FigmaSyncWindow.DoSync`** (giữ compile — hành vi tạm thời vẫn build ngay, Task 18 mới tách):

Thay block từ `var nodeId = ...` đến `if (!Client.TryExportElement(...)`:

```csharp
            var nodeId = FigmaSyncUrl.ExtractNodeId(_figmaUrl);
            if (nodeId == null)
            {
                SetStatus("Invalid Figma URL or node-id.", true);
                return;
            }

            EditorUtility.DisplayProgressBar("Figma Sync", "Exporting from Figma...", 0.3f);
            try
            {
                if (!Client.TryExportElement(nodeId, SyncLibrary.FolderFor(nodeId), out var export, out var err))
```

(Xoá biến `isUrl` — nodeId giờ bắt buộc resolve client-side vì tên folder staging cần nó.)

- [ ] **Step 3: Compile check**

Run: `utk --project /Users/zasuo/Unity/Unity-AI editor refresh --compile && utk --project /Users/zasuo/Unity/Unity-AI console --type error`
Expected: 0 error.

- [ ] **Step 4: Commit**

```bash
git add UnityFigImporter/Editor/Sync/FigmaBridgeClient.cs UnityFigImporter/Editor/Sync/FigmaSyncWindow.cs
git commit -m "feat(unity): bridge client exports to .unity-figma staging with includePreview"
```

---

### Task 18: `FigmaSyncWindow` v2 — 2 tab, Sync/Build tách, Library master-detail

**Files:**
- Rewrite: `UnityFigImporter/Editor/Sync/FigmaSyncWindow.cs` (toàn bộ nội dung mới bên dưới)

- [ ] **Step 1: Thay toàn bộ nội dung `FigmaSyncWindow.cs`:**

```csharp
using System.Collections.Generic;
using System.IO;
using FigmaImporter;
using UnityEditor;
using UnityEngine;

namespace FigmaImporter.Sync
{
    public class FigmaSyncWindow : EditorWindow
    {
        const string PREF_PORT = "FigmaSync_Port";
        const string PREF_SPRITE_FOLDER = "FigmaImporter_SpriteFolder";

        static readonly string[] Tabs = { "Sync", "Library" };
        int _tab;

        // Sync tab
        int _port = 1994;
        string _figmaUrl = "";
        string _selectionName = "";
        OutputMode _outputMode = OutputMode.Both;
        string _prefabSavePath = "Assets/Prefabs/UI/";
        string _spriteOutputFolder = "";

        FigmaBridgeClient.HealthInfo _health;
        string _status = "";
        bool _statusIsError;

        SyncLibrary.Entry _staged;
        Texture2D _stagedPreview;
        ImportDescriptor.Data _lastImport;

        // Library tab
        List<SyncLibrary.Entry> _entries = new List<SyncLibrary.Entry>();
        string _search = "";
        SyncLibrary.Entry _selected;
        Texture2D _selectedPreview;
        float _zoom = 1f;
        bool _fitZoom = true;
        Vector2 _listScroll, _previewScroll;

        [MenuItem("Window/Figma/Sync")]
        public static void Open()
        {
            GetWindow<FigmaSyncWindow>("Figma Sync");
        }

        void OnEnable()
        {
            _port = EditorPrefs.GetInt(PREF_PORT, 1994);
            _spriteOutputFolder = EditorPrefs.GetString(
                PREF_SPRITE_FOLDER,
                Path.Combine(Application.dataPath, "FigmaImport").Replace('\\', '/'));
            if (string.IsNullOrEmpty(_spriteOutputFolder))
                _spriteOutputFolder = Path.Combine(Application.dataPath, "FigmaImport").Replace('\\', '/');
            RefreshLibrary();
        }

        FigmaBridgeClient Client => new FigmaBridgeClient(_port);

        void OnGUI()
        {
            _tab = GUILayout.Toolbar(_tab, Tabs);
            EditorGUILayout.Space(6);
            if (_tab == 0) DrawSyncTab();
            else DrawLibraryTab();
        }

        // ───────────────── Sync tab ─────────────────

        void DrawSyncTab()
        {
            DrawConnection();
            EditorGUILayout.Space(6);
            DrawSource();
            EditorGUILayout.Space(6);
            using (new EditorGUI.DisabledScope(string.IsNullOrWhiteSpace(_figmaUrl)))
            {
                if (GUILayout.Button("Sync (export + preview)", GUILayout.Height(32)))
                    DoSync();
            }
            EditorGUILayout.Space(6);
            DrawStagedPreview();
            EditorGUILayout.Space(6);
            DrawOptions();
            using (new EditorGUI.DisabledScope(_staged == null))
            {
                if (GUILayout.Button("Build prefab", GUILayout.Height(32)))
                    DoBuild(_staged);
            }
            EditorGUILayout.Space(6);
            DrawStatus();
        }

        void DrawConnection()
        {
            EditorGUILayout.BeginHorizontal();
            int newPort = EditorGUILayout.IntField("Port", _port);
            if (newPort != _port) { _port = newPort; EditorPrefs.SetInt(PREF_PORT, _port); }
            if (GUILayout.Button("Check", GUILayout.Width(60)))
            {
                if (Client.TryHealth(out _health, out var err))
                    SetStatus($"Bridge OK (plugin {(_health.pluginConnected ? "connected" : "NOT connected")})", !_health.pluginConnected);
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
                    if (BridgeLauncher.TrySpawn(_port, out var err)) SetStatus("Spawned bridge - press Check in ~2s.", false);
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
            var newSpriteFolder = EditorGUILayout.TextField("Sprite Folder", _spriteOutputFolder);
            if (newSpriteFolder != _spriteOutputFolder)
            {
                _spriteOutputFolder = newSpriteFolder;
                EditorPrefs.SetString(PREF_SPRITE_FOLDER, _spriteOutputFolder);
            }
        }

        void DoSync()
        {
            var nodeId = FigmaSyncUrl.ExtractNodeId(_figmaUrl);
            if (nodeId == null)
            {
                SetStatus("Invalid Figma URL or node-id.", true);
                return;
            }

            EditorUtility.DisplayProgressBar("Figma Sync", "Exporting from Figma...", 0.5f);
            try
            {
                var outputDir = SyncLibrary.FolderFor(nodeId);
                if (!Client.TryExportElement(nodeId, outputDir, out var export, out var err))
                {
                    SetStatus(err, true);
                    return;
                }

                _staged = SyncLibrary.Load(export.outputDir);
                _stagedPreview = SyncLibrary.LoadPreview(_staged);
                _lastImport = null;
                RefreshLibrary();
                SetStatus($"Synced {export.name} ({export.nodeCount} nodes) → {export.outputDir}", false);
            }
            finally
            {
                EditorUtility.ClearProgressBar();
            }
        }

        void DoBuild(SyncLibrary.Entry entry)
        {
            if (entry == null) return;
            EditorUtility.DisplayProgressBar("Figma Sync", "Building prefab...", 0.5f);
            try
            {
                var request = new ImportRequest
                {
                    ExportFolder = entry.Folder,
                    OutputMode = _outputMode,
                    PrefabSavePath = _prefabSavePath,
                    SpriteOutputFolder = _spriteOutputFolder,
                };
                var result = FigmaImportRunner.Run(request);
                if (!result.Success)
                {
                    SetStatus("Build failed: " + string.Join(" | ", result.Log.ConvertAll(e => e.Message)), true);
                    return;
                }

                var prefabPath = Path.Combine(_prefabSavePath, result.RootName + ".prefab").Replace('\\', '/');
                _lastImport = new ImportDescriptor.Data
                {
                    name = entry.Name,
                    nodeId = entry.NodeId,
                    canonicalUrl = ReferenceEquals(entry, _staged) && !string.IsNullOrEmpty(_figmaUrl) ? _figmaUrl : entry.NodeId,
                    outputDir = entry.Folder,
                    prefabPath = prefabPath,
                };
                SetStatus($"Built {result.RootName} ({entry.NodeCount} nodes) → {prefabPath}", false);
            }
            finally
            {
                EditorUtility.ClearProgressBar();
            }
        }

        void DrawStagedPreview()
        {
            if (_staged == null) return;
            EditorGUILayout.LabelField($"Staged: {_staged.Name} ({_staged.NodeCount} nodes)", EditorStyles.boldLabel);
            if (_stagedPreview != null)
            {
                var rect = GUILayoutUtility.GetRect(256, 256, GUILayout.ExpandWidth(false));
                GUI.DrawTexture(rect, _stagedPreview, ScaleMode.ScaleToFit);
            }
            else
                EditorGUILayout.LabelField("No preview", EditorStyles.centeredGreyMiniLabel);
        }

        void DrawStatus()
        {
            if (!string.IsNullOrEmpty(_status))
                EditorGUILayout.HelpBox(_status, _statusIsError ? MessageType.Error : MessageType.Info);

            if (_lastImport != null && GUILayout.Button("Refine with AI (copy prompt + write descriptor)"))
            {
                var descPath = Path.Combine(Application.dataPath, "..", "Temp", "figma-last-import.json");
                ImportDescriptor.Write(Path.GetFullPath(descPath), _lastImport);
                EditorGUIUtility.systemCopyBuffer = ImportDescriptor.BuildPrompt(_lastImport);
                SetStatus($"Prompt copied. Descriptor: {Path.GetFullPath(descPath)}", false);
            }
        }

        // ───────────────── Library tab (master-detail) ─────────────────

        void RefreshLibrary()
        {
            _entries = SyncLibrary.List();
            if (_selected != null)
            {
                _selected = _entries.Find(e => e.Folder == _selected.Folder);
                if (_selected == null) _selectedPreview = null;
            }
            if (_staged != null && _entries.Find(e => e.Folder == _staged.Folder) == null)
            {
                _staged = null;
                _stagedPreview = null;
            }
        }

        void DrawLibraryTab()
        {
            EditorGUILayout.BeginHorizontal();
            DrawLibraryList();
            DrawLibraryDetail();
            EditorGUILayout.EndHorizontal();
            EditorGUILayout.Space(6);
            DrawStatus();
        }

        void DrawLibraryList()
        {
            EditorGUILayout.BeginVertical(GUILayout.Width(200));
            if (GUILayout.Button("Refresh")) RefreshLibrary();
            _search = EditorGUILayout.TextField(_search, EditorStyles.toolbarSearchField);
            _listScroll = EditorGUILayout.BeginScrollView(_listScroll);
            foreach (var entry in _entries)
            {
                if (!string.IsNullOrEmpty(_search) &&
                    entry.Name.IndexOf(_search, System.StringComparison.OrdinalIgnoreCase) < 0)
                    continue;
                EditorGUILayout.BeginHorizontal();
                var style = entry == _selected ? EditorStyles.boldLabel : EditorStyles.label;
                if (GUILayout.Button(entry.Name, style)) Select(entry);
                GUILayout.Label(SyncLibrary.FormatAge(entry.SyncedAtUtc), EditorStyles.miniLabel, GUILayout.Width(36));
                EditorGUILayout.EndHorizontal();
            }
            EditorGUILayout.EndScrollView();
            EditorGUILayout.EndVertical();
        }

        void Select(SyncLibrary.Entry entry)
        {
            _selected = entry;
            _selectedPreview = SyncLibrary.LoadPreview(entry);
            _fitZoom = true;
            Repaint();
        }

        void DrawLibraryDetail()
        {
            EditorGUILayout.BeginVertical();
            if (_selected == null)
            {
                EditorGUILayout.HelpBox("Select a synced element on the left.", MessageType.Info);
                EditorGUILayout.EndVertical();
                return;
            }

            EditorGUILayout.LabelField(_selected.Name, EditorStyles.boldLabel);
            EditorGUILayout.LabelField(_selected.ManifestPath, EditorStyles.miniLabel);
            EditorGUILayout.LabelField($"Last synced: {_selected.SyncedAtUtc.ToLocalTime():yyyy-MM-dd HH:mm}", EditorStyles.miniLabel);

            EditorGUILayout.BeginHorizontal();
            var newZoom = EditorGUILayout.Slider($"Zoom: {(int)(_zoom * 100)}%", _zoom, 0.1f, 2f);
            if (!Mathf.Approximately(newZoom, _zoom)) { _zoom = newZoom; _fitZoom = false; }
            if (GUILayout.Button("Fit", GUILayout.Width(40))) _fitZoom = true;
            if (GUILayout.Button("1:1", GUILayout.Width(40))) { _zoom = 1f; _fitZoom = false; }
            GUILayout.Label("Scroll wheel to zoom", EditorStyles.miniLabel);
            EditorGUILayout.EndHorizontal();

            DrawZoomPreview();

            EditorGUILayout.BeginHorizontal();
            if (GUILayout.Button("Build", GUILayout.Height(26))) DoBuild(_selected);
            if (GUILayout.Button("Delete", GUILayout.Height(26)))
            {
                if (EditorUtility.DisplayDialog(
                        "Delete synced data",
                        $"Delete {_selected.Name} from .unity-figma?\n{_selected.Folder}",
                        "Delete", "Cancel"))
                {
                    SyncLibrary.Delete(_selected);
                    _selected = null;
                    _selectedPreview = null;
                    RefreshLibrary();
                }
            }
            EditorGUILayout.EndHorizontal();
            EditorGUILayout.EndVertical();
        }

        void DrawZoomPreview()
        {
            var area = GUILayoutUtility.GetRect(100, 4000, 100, 4000, GUILayout.ExpandWidth(true), GUILayout.ExpandHeight(true));
            if (_selectedPreview == null)
            {
                GUI.Label(area, "No preview", EditorStyles.centeredGreyMiniLabel);
                return;
            }

            // Handle zoom BEFORE the scroll view consumes the wheel event.
            var evt = Event.current;
            if (evt.type == EventType.ScrollWheel && area.Contains(evt.mousePosition))
            {
                _zoom = Mathf.Clamp(_zoom * (evt.delta.y < 0 ? 1.1f : 0.9f), 0.1f, 2f);
                _fitZoom = false;
                evt.Use();
                Repaint();
            }

            if (_fitZoom)
                _zoom = Mathf.Clamp(
                    Mathf.Min(area.width / _selectedPreview.width, area.height / _selectedPreview.height),
                    0.1f, 2f);

            float w = _selectedPreview.width * _zoom;
            float h = _selectedPreview.height * _zoom;
            _previewScroll = GUI.BeginScrollView(area, _previewScroll, new Rect(0, 0, w, h));
            GUI.DrawTexture(new Rect(0, 0, w, h), _selectedPreview, ScaleMode.StretchToFill);
            GUI.EndScrollView();
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

- [ ] **Step 2: Compile + chạy lại toàn bộ EditMode tests**

Run: `utk --project /Users/zasuo/Unity/Unity-AI editor refresh --compile && utk --project /Users/zasuo/Unity/Unity-AI test --filter FigmaImporter.Tests`
Expected: 0 compile error; 10/10 PASS.

- [ ] **Step 3: Commit**

```bash
git add UnityFigImporter/Editor/Sync/FigmaSyncWindow.cs
git commit -m "feat(unity): FigmaSyncWindow v2 — Sync/Build split + Library master-detail tab"
```

---

### Task 19: README v2 + verification end-to-end

**Files:**
- Modify: `UnityFigImporter/README.md` (mục "Realtime Sync window")

- [ ] **Step 1: Thay mục "Realtime Sync window" trong README** bằng:

```markdown
## Realtime Sync window (Window ▸ Figma ▸ Sync)

Sync một element từ Figma vào Unity không cần AI. V2 tách 2 bước: **Sync** chỉ
export + preview ảnh thật từ Figma vào staging `.unity-figma/` (cạnh `Assets/`,
Unity bỏ qua folder này); **Build** mới tạo prefab.

1. Mở Figma Desktop + plugin FigExportForUnity.
2. Mở **Window ▸ Figma ▸ Sync**, bấm **Check** (port mặc định 1994).
   Nếu bridge offline, set "Bridge dir" = `FigExportForUnity/server` rồi **Spawn standalone bridge**.
3. Dán Figma URL hoặc bấm **Use current Figma selection**.
4. Bấm **Sync (export + preview)** → asset + manifest + `preview.png` được ghi vào
   `.unity-figma/<node-id>/`, ảnh preview hiện trong window. Chưa có gì vào `Assets/`.
5. Chỉnh Output Mode / Prefab Save Path nếu cần, bấm **Build prefab** → prefab được
   tạo (trùng tên thì replace). Data staging được giữ lại.
6. Tab **Library**: danh sách mọi element đã sync (search, tuổi "22m"/"4h"), chọn để
   xem preview (Zoom slider, Fit, 1:1, lăn chuột để zoom), **Build** lại hoặc
   **Delete** để xoá data khỏi `.unity-figma`.
7. (tùy chọn) **Refine with AI** sau khi Build để bàn giao cho Claude (figma-build 4-6).

> Khuyến nghị thêm `.unity-figma/` vào `.gitignore` của Unity project.
```

- [ ] **Step 2: Verify server**

Run: `cd FigExportForUnity/server && bun test src && bun run build`
Expected: tất cả PASS, build OK.

- [ ] **Step 3: Verify e2e thủ công** (cần Figma Desktop + plugin đang mở):
  1. Tab Sync → Check → Use current Figma selection → **Sync** →
     Expected: status "Synced <name> (N nodes) → …/.unity-figma/<id>"; `preview.png` tồn tại trong folder; ảnh hiện trong window; **chưa** có prefab mới.
  2. Bấm **Build prefab** → Expected: prefab xuất hiện tại Prefab Save Path; folder staging vẫn còn nguyên.
  3. Tab Library → Expected: entry vừa sync đứng đầu list với tuổi "0m"; search lọc đúng; zoom slider/Fit/1:1/scroll-wheel hoạt động.
  4. **Delete** entry (confirm) → Expected: folder bị xoá khỏi `.unity-figma`, list refresh, detail panel trống.

- [ ] **Step 4: Commit**

```bash
git add UnityFigImporter/README.md
git commit -m "docs(unity): document v2 Sync/Build split + .unity-figma staging + Library tab"
```

---

## Self-Review (Phase 3)

**Spec V2 coverage:**
- Sync chỉ export + preview thật, không build → Task 18 `DoSync` (không gọi `FigmaImportRunner`). ✓
- Nút Build riêng từ staging → Task 18 `DoBuild(entry)` với `ExportFolder = entry.Folder`. ✓
- Staging `.unity-figma/<node-id-hyphen>/` → Task 16 `SyncLibrary.Root`/`FolderFor`; Task 17 truyền `outputDir`. ✓
- `preview.png` server-side best-effort + `previewFile` + blacklist → Task 15. ✓
- Library tab master-detail (Refresh/search/tuổi | tên/path/last-synced/zoom-Fit-1:1-scroll/Build/Delete) → Task 18. ✓
- Giữ data sau Build, chỉ xoá qua Library → `DoBuild` không xoá; `Delete` chỉ trong Library tab. ✓
- Skip folder hỏng trong `List()` → Task 16 `Load` trả null + test. ✓

**Type consistency:** `ExportResult.previewFile` (Task 17) khớp `ExportElementResult.previewFile` (Task 15). `TryExportElement(nodeId, outputDir)` (Task 17) khớp call-site Task 17 Step 2 và Task 18 `DoSync`. `SyncLibrary.Entry` fields (Task 16) khớp mọi usage trong Task 18 (`Folder/Name/NodeId/ManifestPath/PreviewPath/NodeCount/SyncedAtUtc`). `SyncLibrary.List(string)` overload tồn tại cho test (Task 16).

**Placeholder scan:** không có TBD/“xử lý lỗi phù hợp”; mọi step có code/lệnh cụ thể.

---

# PHASE 4 — V3: Dashboard duy nhất + Unity render preview (Tasks 20-25)

> Spec: phần "V3" trong `docs/superpowers/specs/2026-06-12-figma-unity-realtime-sync-design.md`.
> Unity test project: `/Users/zasuo/Unity/Unity-AI` (manifest đã có `testables`).
> Lệnh Unity: `utk --project /Users/zasuo/Unity/Unity-AI editor refresh --compile`,
> `utk --project /Users/zasuo/Unity/Unity-AI test --filter FigmaImporter.Tests`,
> `utk --project /Users/zasuo/Unity/Unity-AI console --type error`.
> Lưu ý utk: call đầu sau compile có thể fail "connection closed before response"
> (domain reload) — đợi ~20s rồi retry, tối đa 3 lần.

**Impact đã kiểm (codegraph/grep):**
- `OutputMode` dùng ở: FigmaImportRunner.cs:125, FigmaImporterWindow.cs:474+894,
  FigmaSyncWindow.cs, FigmaHeadlessImporter.cs:25-42 (`Enum.Parse` — thêm value
  CUỐI enum không đổi giá trị Scene/Prefab/Both → an toàn), HierarchyBuilder.cs:51+85.
- `ImportResult` chỉ được tạo/đọc trong FigmaImportRunner.cs + 2 window + headless
  (chỉ đọc `Success/RootName/Log` → thêm field `Root` an toàn).
- `FigmaImporterWindow.ShowWindow` không có caller nào ngoài chính `[MenuItem]` —
  xoá attribute an toàn, class giữ nguyên.
- Side-effect chấp nhận (đã chốt trong spec): `OutputMode.None` xuất hiện trong
  EnumPopup "Output Mode" của cả 2 window; chọn None khi Build = chỉ import
  textures, không scene/prefab. Không chặn.

### Task 20: Server — blacklist `unity-preview.png`

**Files:**
- Modify: `FigExportForUnity/server/src/tools.ts` (hàm `isSafeAssetFileName`, ~dòng 576)
- Test: `FigExportForUnity/server/src/tools.test.ts`

- [ ] **Step 1: Viết test fail** — thêm vào cuối `describe("exportElementToDisk includePreview")` trong `tools.test.ts`:

```ts
  test("rejects plugin asset named unity-preview.png", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "figexp-"));
    const evil = {
      manifest: samplePayload.manifest,
      assets: [{ name: "unity-preview.png", data: [1, 2, 3] }],
    };
    await expect(
      exportElementToDisk(fakeSender(evil), {
        nodeId: "4029:12345",
        outputDir: dir,
      })
    ).rejects.toThrow(/Unsafe/);
  });
```

- [ ] **Step 2: Chạy test, verify FAIL**

Run: `cd FigExportForUnity/server && bun test src`
Expected: test mới FAIL (asset được ghi thay vì throw).

- [ ] **Step 3: Sửa `isSafeAssetFileName`** trong `tools.ts` — thêm 1 dòng blacklist:

```ts
function isSafeAssetFileName(name: string): boolean {
  const lowerName = name.toLowerCase();
  return (
    name.length > 0 &&
    name !== "." &&
    name !== ".." &&
    lowerName !== "manifest.json" &&
    lowerName !== "preview.png" &&
    lowerName !== "unity-preview.png" &&
    lowerName.endsWith(".png") &&
    !name.includes("\0") &&
    !path.isAbsolute(name) &&
    !name.includes("/") &&
    !name.includes("\\")
  );
}
```

- [ ] **Step 4: Chạy test + build, verify PASS**

Run: `cd FigExportForUnity/server && bun test src && bun run build`
Expected: 24 tests PASS, tsc OK.

- [ ] **Step 5: Commit**

```bash
git add FigExportForUnity/server/src/tools.ts FigExportForUnity/server/src/tools.test.ts
git commit -m "feat(server): blacklist unity-preview.png asset filename"
```

---

### Task 21: Unity — `OutputMode.None` + `ImportResult.Root`

**Files:**
- Modify: `UnityFigImporter/Editor/HierarchyBuilder.cs` (enum `OutputMode`, dòng 51-56)
- Modify: `UnityFigImporter/Editor/FigmaImportRunner.cs` (class `ImportResult` dòng 31-37, `Run` dòng 135)

- [ ] **Step 1: Thêm `None` vào CUỐI enum** trong `HierarchyBuilder.cs` (giữ nguyên giá trị 3 value cũ — FigmaHeadlessImporter dùng `Enum.Parse` theo tên nên không vỡ):

```csharp
    public enum OutputMode
    {
        Scene,
        Prefab,
        Both,
        /// <summary>Build hierarchy only — no scene canvas, no prefab. Used for Sync preview.</summary>
        None
    }
```

Không sửa gì khác trong `Build` — `None` tự rơi qua cả 2 nhánh
`if (outputMode == OutputMode.Scene || outputMode == OutputMode.Both)` và
`if (outputMode == OutputMode.Prefab || outputMode == OutputMode.Both)`.

- [ ] **Step 2: Thêm field `Root` vào `ImportResult`** trong `FigmaImportRunner.cs`:

```csharp
    public class ImportResult
    {
        public bool Success;
        public string RootName;
        public int TextureCount;
        public List<BuildLogEntry> Log = new List<BuildLogEntry>();
        /// <summary>Transient scene object — only set for the caller to render/destroy. Not an asset.</summary>
        public GameObject Root;
    }
```

- [ ] **Step 3: Gán `result.Root`** trong `Run` — sửa đoạn sau `HierarchyBuilder.Build(...)` (dòng ~135):

```csharp
                result.Root = root;
                result.RootName = root != null ? root.name : null;
                result.Success = root != null
                    && !result.Log.Exists(e => e.Level == BuildLogEntry.LogLevel.Error);
```

- [ ] **Step 4: Compile + test Unity**

Run: `utk --project /Users/zasuo/Unity/Unity-AI editor refresh --compile`
Run: `utk --project /Users/zasuo/Unity/Unity-AI test --filter FigmaImporter.Tests`
Expected: 0 errors, 10 tests PASS (chưa có test mới).

- [ ] **Step 5: Commit**

```bash
git add UnityFigImporter/Editor/HierarchyBuilder.cs UnityFigImporter/Editor/FigmaImportRunner.cs
git commit -m "feat(unity): OutputMode.None + ImportResult.Root for offscreen preview"
```

---

### Task 22: Unity — `SyncLibrary.UnityPreviewPath` + `LoadTexture`

**Files:**
- Modify: `UnityFigImporter/Editor/Sync/SyncLibrary.cs`
- Test: `UnityFigImporter/Editor/Tests/SyncLibraryTests.cs`

- [ ] **Step 1: Viết test fail** — thêm vào `SyncLibraryTests.cs`:

```csharp
        [Test]
        public void List_PopulatesUnityPreviewPath()
        {
            WriteManifest("7-8", "{\"screen\":{\"name\":\"Hud\"},\"elements\":[]}");
            File.WriteAllBytes(Path.Combine(_root, "7-8", "unity-preview.png"), new byte[] { 1 });
            var entries = SyncLibrary.List(_root);
            Assert.AreEqual(1, entries.Count);
            StringAssert.EndsWith("unity-preview.png", entries[0].UnityPreviewPath);
            Assert.IsNull(entries[0].PreviewPath);
        }
```

- [ ] **Step 2: Compile — verify FAIL** (compile error `UnityPreviewPath` chưa tồn tại)

Run: `utk --project /Users/zasuo/Unity/Unity-AI editor refresh --compile`
Expected: compile error về `UnityPreviewPath`.

- [ ] **Step 3: Sửa `SyncLibrary.cs`** — 3 thay đổi:

(a) Thêm field vào `Entry`:

```csharp
        public class Entry
        {
            public string Folder;
            public string Name;
            public string NodeId;
            public string ManifestPath;
            public string PreviewPath;
            public string UnityPreviewPath;
            public int NodeCount;
            public DateTime SyncedAtUtc;
        }
```

(b) Trong `Load(folder)`, populate field mới (thêm 2 dòng):

```csharp
                var previewPath = Path.Combine(folder, "preview.png");
                var unityPreviewPath = Path.Combine(folder, "unity-preview.png");
                return new Entry
                {
                    Folder = folder,
                    Name = (string)manifest.SelectToken("screen.name") ?? Path.GetFileName(folder),
                    NodeId = Path.GetFileName(folder).Replace('-', ':'),
                    ManifestPath = manifestPath,
                    PreviewPath = File.Exists(previewPath) ? previewPath : null,
                    UnityPreviewPath = File.Exists(unityPreviewPath) ? unityPreviewPath : null,
                    NodeCount = elements != null ? elements.Count : 0,
                    SyncedAtUtc = File.GetLastWriteTimeUtc(manifestPath),
                };
```

(c) Tổng quát hoá loader — thay `LoadPreview` bằng:

```csharp
        public static Texture2D LoadTexture(string path)
        {
            if (path == null || !File.Exists(path)) return null;
            var tex = new Texture2D(2, 2);
            if (tex.LoadImage(File.ReadAllBytes(path)))
                return tex;
            UnityEngine.Object.DestroyImmediate(tex);
            return null;
        }

        public static Texture2D LoadPreview(Entry entry) =>
            entry == null ? null : LoadTexture(entry.PreviewPath);
```

- [ ] **Step 4: Compile + test, verify PASS**

Run: `utk --project /Users/zasuo/Unity/Unity-AI editor refresh --compile`
Run: `utk --project /Users/zasuo/Unity/Unity-AI test --filter FigmaImporter.Tests`
Expected: 0 errors, 11 tests PASS (10 cũ + `List_PopulatesUnityPreviewPath`).

- [ ] **Step 5: Commit**

```bash
git add UnityFigImporter/Editor/Sync/SyncLibrary.cs UnityFigImporter/Editor/Tests/SyncLibraryTests.cs
git commit -m "feat(unity): SyncLibrary tracks unity-preview.png + generic LoadTexture"
```

---

### Task 23: Unity — `FigmaPreviewRenderer` (offscreen render → unity-preview.png)

**Files:**
- Create: `UnityFigImporter/Editor/Sync/FigmaPreviewRenderer.cs`
- Create: `UnityFigImporter/Editor/Sync/FigmaPreviewRenderer.cs.meta`

Không có EditMode test thuần cho task này (cần manifest + textures thật) —
verify qua e2e ở Task 25.

- [ ] **Step 1: Tạo `FigmaPreviewRenderer.cs`** với nội dung đầy đủ:

```csharp
using System.Collections.Generic;
using System.IO;
using UnityEngine;

namespace FigmaImporter.Sync
{
    /// <summary>
    /// Runs a real import (OutputMode.None) and renders the resulting hierarchy
    /// offscreen to a PNG, so the Sync preview shows exactly what Unity builds.
    /// </summary>
    public static class FigmaPreviewRenderer
    {
        const int MaxSize = 2048;
        const int UILayer = 5;

        /// <summary>
        /// Import (textures + hierarchy, no scene canvas, no prefab) then render
        /// the root to <paramref name="outputPng"/>. The transient root is always
        /// destroyed before returning. Render failure is best-effort: logged as
        /// a warning, the import result itself is unchanged.
        /// </summary>
        public static ImportResult ImportAndRender(ImportRequest request, string outputPng)
        {
            request.OutputMode = OutputMode.None;
            var result = FigmaImportRunner.Run(request);
            if (result.Root == null) return result;

            try
            {
                RenderRootToPng(result.Root, outputPng, result.Log);
            }
            catch (System.Exception ex)
            {
                result.Log.Add(new BuildLogEntry(
                    BuildLogEntry.LogLevel.Warning,
                    "Unity preview render failed: " + ex.Message));
            }
            finally
            {
                if (result.Root != null)
                    Object.DestroyImmediate(result.Root);
                result.Root = null;
            }
            return result;
        }

        static void RenderRootToPng(GameObject root, string outputPng, List<BuildLogEntry> log)
        {
            var rootRect = root.GetComponent<RectTransform>();
            float srcW = rootRect != null ? rootRect.rect.width : 256f;
            float srcH = rootRect != null ? rootRect.rect.height : 256f;
            if (srcW < 1f) srcW = 256f;
            if (srcH < 1f) srcH = 256f;
            float fit = Mathf.Min(1f, MaxSize / Mathf.Max(srcW, srcH));
            int w = Mathf.Max(8, Mathf.RoundToInt(srcW * fit));
            int h = Mathf.Max(8, Mathf.RoundToInt(srcH * fit));

            GameObject camGO = null, canvasGO = null;
            RenderTexture rt = null;
            Texture2D tex = null;
            try
            {
                camGO = new GameObject("~FigmaPreviewCamera") { hideFlags = HideFlags.HideAndDontSave };
                var cam = camGO.AddComponent<Camera>();
                cam.clearFlags = CameraClearFlags.SolidColor;
                cam.backgroundColor = new Color(0.16f, 0.16f, 0.16f, 1f);
                cam.cullingMask = 1 << UILayer;
                cam.orthographic = true;
                cam.nearClipPlane = 0.1f;
                cam.farClipPlane = 200f;

                canvasGO = new GameObject("~FigmaPreviewCanvas") { hideFlags = HideFlags.HideAndDontSave };
                canvasGO.layer = UILayer;
                var canvas = canvasGO.AddComponent<Canvas>();
                canvas.renderMode = RenderMode.ScreenSpaceCamera;
                canvas.worldCamera = cam;
                canvas.planeDistance = 100f;
                // No CanvasScaler: 1 canvas unit == 1 RenderTexture pixel.

                root.transform.SetParent(canvasGO.transform, false);
                SetLayerRecursive(root.transform, UILayer);
                if (rootRect != null)
                {
                    rootRect.anchorMin = rootRect.anchorMax = new Vector2(0.5f, 0.5f);
                    rootRect.pivot = new Vector2(0.5f, 0.5f);
                    rootRect.anchoredPosition = Vector2.zero;
                    root.transform.localScale = Vector3.one * fit;
                }

                rt = RenderTexture.GetTemporary(w, h, 24, RenderTextureFormat.ARGB32);
                cam.targetTexture = rt;

                Canvas.ForceUpdateCanvases();
                cam.Render();

                var prevActive = RenderTexture.active;
                RenderTexture.active = rt;
                tex = new Texture2D(w, h, TextureFormat.RGBA32, false);
                tex.ReadPixels(new Rect(0, 0, w, h), 0, 0);
                tex.Apply();
                RenderTexture.active = prevActive;

                File.WriteAllBytes(outputPng, tex.EncodeToPNG());
                log.Add(new BuildLogEntry(
                    BuildLogEntry.LogLevel.Success,
                    $"Unity preview rendered {w}x{h} -> {Path.GetFileName(outputPng)}"));
            }
            finally
            {
                if (tex != null) Object.DestroyImmediate(tex);
                if (rt != null)
                {
                    RenderTexture.active = null;
                    RenderTexture.ReleaseTemporary(rt);
                }
                // Destroying the canvas also destroys the reparented root.
                if (canvasGO != null) Object.DestroyImmediate(canvasGO);
                if (camGO != null) Object.DestroyImmediate(camGO);
            }
        }

        static void SetLayerRecursive(Transform t, int layer)
        {
            t.gameObject.layer = layer;
            for (int i = 0; i < t.childCount; i++)
                SetLayerRecursive(t.GetChild(i), layer);
        }
    }
}
```

- [ ] **Step 2: Tạo `FigmaPreviewRenderer.cs.meta`** (GUID 32 hex lowercase, theo format meta tối giản hiện có):

```yaml
fileFormatVersion: 2
guid: b2c3d4e5f6a708192b3c4d5e6f7a8091
```

- [ ] **Step 3: Compile + test**

Run: `utk --project /Users/zasuo/Unity/Unity-AI editor refresh --compile`
Run: `utk --project /Users/zasuo/Unity/Unity-AI test --filter FigmaImporter.Tests`
Expected: 0 errors, 11 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add UnityFigImporter/Editor/Sync/FigmaPreviewRenderer.cs UnityFigImporter/Editor/Sync/FigmaPreviewRenderer.cs.meta
git commit -m "feat(unity): FigmaPreviewRenderer — offscreen render import result to unity-preview.png"
```

---

### Task 24: Unity — Dashboard window (gộp 1 view) + bỏ menu Import

**Files:**
- Modify: `UnityFigImporter/Editor/FigmaImporterWindow.cs` (chỉ xoá attribute dòng 90)
- Modify: `UnityFigImporter/Editor/Sync/FigmaSyncWindow.cs` (rework toàn bộ)

- [ ] **Step 1: Xoá `[MenuItem("Window/Figma/Import")]`** trong `FigmaImporterWindow.cs` — xoá ĐÚNG 1 dòng attribute (dòng 90), GIỮ nguyên method `ShowWindow()` và toàn bộ class:

```csharp
        // Menu item removed in v3 — the Dashboard (FigmaSyncWindow) is the single
        // entry point. Open this window via FigmaImporterWindow.ShowWindow() if needed.
        public static void ShowWindow()
        {
            var window = GetWindow<FigmaImporterWindow>("Figma → Unity");
            window.minSize = new Vector2(380, 600);
        }
```

- [ ] **Step 2: Thay toàn bộ nội dung `FigmaSyncWindow.cs`** bằng:

```csharp
using System.Collections.Generic;
using System.IO;
using FigmaImporter;
using UnityEditor;
using UnityEngine;

namespace FigmaImporter.Sync
{
    public class FigmaSyncWindow : EditorWindow
    {
        const string PREF_PORT = "FigmaSync_Port";
        const string PREF_SPRITE_FOLDER = "FigmaImporter_SpriteFolder";

        static readonly string[] PreviewSources = { "Unity build", "Figma" };

        int _port = 1994;
        string _figmaUrl = "";
        string _selectionName = "";
        bool _showSettings;
        OutputMode _outputMode = OutputMode.Both;
        string _prefabSavePath = "Assets/Prefabs/UI/";
        string _spriteOutputFolder = "";

        FigmaBridgeClient.HealthInfo _health;
        string _status = "";
        bool _statusIsError;

        string _syncedFolder;          // folder of the most recent Sync (for canonicalUrl)
        string _syncedUrl;
        List<BuildLogEntry> _lastLog;  // log of the most recent Sync/Build (in-memory only)
        ImportDescriptor.Data _lastImport;

        List<SyncLibrary.Entry> _entries = new List<SyncLibrary.Entry>();
        string _search = "";
        SyncLibrary.Entry _selected;
        Texture2D _selectedPreview;
        int _previewSource;            // 0 = Unity build, 1 = Figma
        float _zoom = 1f;
        bool _fitZoom = true;
        Vector2 _listScroll, _previewScroll;

        [MenuItem("Window/Figma/Dashboard")]
        public static void Open()
        {
            GetWindow<FigmaSyncWindow>("Figma Dashboard");
        }

        void OnEnable()
        {
            _port = EditorPrefs.GetInt(PREF_PORT, 1994);
            _spriteOutputFolder = EditorPrefs.GetString(
                PREF_SPRITE_FOLDER,
                Path.Combine(Application.dataPath, "FigmaImport").Replace('\\', '/'));
            if (string.IsNullOrEmpty(_spriteOutputFolder))
                _spriteOutputFolder = Path.Combine(Application.dataPath, "FigmaImport").Replace('\\', '/');
            RefreshLibrary();
        }

        FigmaBridgeClient Client => new FigmaBridgeClient(_port);

        void OnGUI()
        {
            DrawTopBar();
            DrawSettings();
            EditorGUILayout.Space(4);
            EditorGUILayout.BeginHorizontal();
            DrawLibraryList();
            DrawDetail();
            EditorGUILayout.EndHorizontal();
            EditorGUILayout.Space(4);
            DrawStatus();
        }

        void DrawTopBar()
        {
            EditorGUILayout.BeginHorizontal();
            if (GUILayout.Button("Use current Figma selection", GUILayout.Width(190)))
            {
                if (Client.TryGetSelection(out var sel, out var err))
                {
                    _figmaUrl = !string.IsNullOrEmpty(sel.url) ? sel.url : sel.nodeId;
                    _selectionName = sel.name;
                    SetStatus($"Selected: {sel.name} ({sel.nodeId})", false);
                }
                else SetStatus(err, true);
            }
            _figmaUrl = EditorGUILayout.TextField(_figmaUrl);
            using (new EditorGUI.DisabledScope(string.IsNullOrWhiteSpace(_figmaUrl)))
            {
                if (GUILayout.Button("Sync", GUILayout.Width(60)))
                    DoSync();
            }
            EditorGUILayout.EndHorizontal();
            if (!string.IsNullOrEmpty(_selectionName))
                EditorGUILayout.LabelField("Selection", _selectionName);
        }

        void DrawSettings()
        {
            _showSettings = EditorGUILayout.Foldout(_showSettings, "Settings", true);
            if (!_showSettings) return;
            using (new EditorGUI.IndentLevelScope())
            {
                DrawConnection();
                DrawOptions();
            }
        }

        void DrawConnection()
        {
            EditorGUILayout.BeginHorizontal();
            int newPort = EditorGUILayout.IntField("Port", _port);
            if (newPort != _port) { _port = newPort; EditorPrefs.SetInt(PREF_PORT, _port); }
            if (GUILayout.Button("Check", GUILayout.Width(60)))
            {
                if (Client.TryHealth(out _health, out var err))
                    SetStatus($"Bridge OK (plugin {(_health.pluginConnected ? "connected" : "NOT connected")})", !_health.pluginConnected);
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
                    if (BridgeLauncher.TrySpawn(_port, out var err)) SetStatus("Spawned bridge - press Check in ~2s.", false);
                    else SetStatus(err, true);
                }
            }
        }

        void DrawOptions()
        {
            _outputMode = (OutputMode)EditorGUILayout.EnumPopup("Output Mode", _outputMode);
            if (_outputMode == OutputMode.Prefab || _outputMode == OutputMode.Both)
                _prefabSavePath = EditorGUILayout.TextField("Prefab Save Path", _prefabSavePath);
            var newSpriteFolder = EditorGUILayout.TextField("Sprite Folder", _spriteOutputFolder);
            if (newSpriteFolder != _spriteOutputFolder)
            {
                _spriteOutputFolder = newSpriteFolder;
                EditorPrefs.SetString(PREF_SPRITE_FOLDER, _spriteOutputFolder);
            }
        }

        void DoSync()
        {
            var nodeId = FigmaSyncUrl.ExtractNodeId(_figmaUrl);
            if (nodeId == null)
            {
                SetStatus("Invalid Figma URL or node-id.", true);
                return;
            }

            try
            {
                EditorUtility.DisplayProgressBar("Figma Sync", "Exporting from Figma...", 0.3f);
                var outputDir = SyncLibrary.FolderFor(nodeId);
                if (!Client.TryExportElement(nodeId, outputDir, out var export, out var err))
                {
                    SetStatus(err, true);
                    return;
                }

                EditorUtility.DisplayProgressBar("Figma Sync", "Importing into Unity (preview)...", 0.6f);
                var request = new ImportRequest
                {
                    ExportFolder = export.outputDir,
                    SpriteOutputFolder = _spriteOutputFolder,
                };
                var preview = FigmaPreviewRenderer.ImportAndRender(
                    request, Path.Combine(export.outputDir, "unity-preview.png"));
                _lastLog = preview.Log;
                _lastImport = null;
                _syncedFolder = export.outputDir;
                _syncedUrl = _figmaUrl;

                RefreshLibrary();
                Select(_entries.Find(e => e.Folder == export.outputDir)
                       ?? SyncLibrary.Load(export.outputDir));

                if (preview.Success)
                    SetStatus($"Synced {export.name} ({export.nodeCount} nodes) — Unity preview ready.", false);
                else
                    SetStatus($"Synced {export.name} but Unity import failed — see log below.", true);
            }
            finally
            {
                EditorUtility.ClearProgressBar();
            }
        }

        void DoBuild(SyncLibrary.Entry entry)
        {
            if (entry == null) return;
            EditorUtility.DisplayProgressBar("Figma Sync", "Building...", 0.5f);
            try
            {
                var request = new ImportRequest
                {
                    ExportFolder = entry.Folder,
                    OutputMode = _outputMode,
                    PrefabSavePath = _prefabSavePath,
                    SpriteOutputFolder = _spriteOutputFolder,
                };
                var result = FigmaImportRunner.Run(request);
                _lastLog = result.Log;
                if (!result.Success)
                {
                    SetStatus("Build failed: " + string.Join(" | ", result.Log.ConvertAll(e => e.Message)), true);
                    return;
                }

                var prefabPath = Path.Combine(_prefabSavePath, result.RootName + ".prefab").Replace('\\', '/');
                if (_outputMode == OutputMode.Prefab || _outputMode == OutputMode.Both)
                {
                    var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath);
                    if (prefab != null) EditorGUIUtility.PingObject(prefab);
                }
                _lastImport = new ImportDescriptor.Data
                {
                    name = entry.Name,
                    nodeId = entry.NodeId,
                    canonicalUrl = entry.Folder == _syncedFolder && !string.IsNullOrEmpty(_syncedUrl)
                        ? _syncedUrl : entry.NodeId,
                    outputDir = entry.Folder,
                    prefabPath = prefabPath,
                };
                SetStatus($"Built {result.RootName} ({entry.NodeCount} nodes) -> {prefabPath}", false);
            }
            finally
            {
                EditorUtility.ClearProgressBar();
            }
        }

        void RefreshLibrary()
        {
            _entries = SyncLibrary.List();
            if (_selected != null)
            {
                _selected = _entries.Find(e => e.Folder == _selected.Folder);
                if (_selected == null) _selectedPreview = null;
                else LoadSelectedPreview();
            }
        }

        void DrawLibraryList()
        {
            EditorGUILayout.BeginVertical(GUILayout.Width(200));
            if (GUILayout.Button("Refresh")) RefreshLibrary();
            _search = EditorGUILayout.TextField(_search, EditorStyles.toolbarSearchField);
            _listScroll = EditorGUILayout.BeginScrollView(_listScroll);
            foreach (var entry in _entries)
            {
                if (!string.IsNullOrEmpty(_search) &&
                    entry.Name.IndexOf(_search, System.StringComparison.OrdinalIgnoreCase) < 0)
                    continue;
                EditorGUILayout.BeginHorizontal();
                var style = entry == _selected ? EditorStyles.boldLabel : EditorStyles.label;
                if (GUILayout.Button(entry.Name, style)) Select(entry);
                GUILayout.Label(SyncLibrary.FormatAge(entry.SyncedAtUtc), EditorStyles.miniLabel, GUILayout.Width(36));
                EditorGUILayout.EndHorizontal();
            }
            EditorGUILayout.EndScrollView();
            EditorGUILayout.EndVertical();
        }

        void Select(SyncLibrary.Entry entry)
        {
            _selected = entry;
            _previewSource = entry != null && entry.UnityPreviewPath != null ? 0 : 1;
            LoadSelectedPreview();
            _fitZoom = true;
            Repaint();
        }

        void LoadSelectedPreview()
        {
            _selectedPreview = null;
            if (_selected == null) return;
            var path = _previewSource == 0 ? _selected.UnityPreviewPath : _selected.PreviewPath;
            _selectedPreview = SyncLibrary.LoadTexture(path);
        }

        void DrawDetail()
        {
            EditorGUILayout.BeginVertical();
            if (_selected == null)
            {
                EditorGUILayout.HelpBox("Sync an element or select one on the left.", MessageType.Info);
                EditorGUILayout.EndVertical();
                return;
            }

            EditorGUILayout.LabelField(_selected.Name, EditorStyles.boldLabel);
            EditorGUILayout.LabelField(_selected.ManifestPath, EditorStyles.miniLabel);
            EditorGUILayout.LabelField($"Last synced: {_selected.SyncedAtUtc.ToLocalTime():yyyy-MM-dd HH:mm}", EditorStyles.miniLabel);

            EditorGUILayout.BeginHorizontal();
            if (_selected.UnityPreviewPath != null)
            {
                int newSource = GUILayout.Toolbar(_previewSource, PreviewSources, GUILayout.Width(180));
                if (newSource != _previewSource)
                {
                    _previewSource = newSource;
                    LoadSelectedPreview();
                    _fitZoom = true;
                }
            }
            else
            {
                _previewSource = 1;
                GUILayout.Label("No Unity preview yet — press Sync to generate.", EditorStyles.miniLabel);
            }
            GUILayout.FlexibleSpace();
            EditorGUILayout.EndHorizontal();

            EditorGUILayout.BeginHorizontal();
            var newZoom = EditorGUILayout.Slider($"Zoom: {(int)(_zoom * 100)}%", _zoom, 0.1f, 2f);
            if (!Mathf.Approximately(newZoom, _zoom)) { _zoom = newZoom; _fitZoom = false; }
            if (GUILayout.Button("Fit", GUILayout.Width(40))) _fitZoom = true;
            if (GUILayout.Button("1:1", GUILayout.Width(40))) { _zoom = 1f; _fitZoom = false; }
            GUILayout.Label("Scroll wheel to zoom", EditorStyles.miniLabel);
            EditorGUILayout.EndHorizontal();

            DrawZoomPreview();
            DrawLog();

            EditorGUILayout.BeginHorizontal();
            if (GUILayout.Button("Build", GUILayout.Height(26))) DoBuild(_selected);
            if (GUILayout.Button("Delete", GUILayout.Height(26)))
            {
                if (EditorUtility.DisplayDialog(
                        "Delete synced data",
                        $"Delete {_selected.Name} from .unity-figma?\n{_selected.Folder}",
                        "Delete", "Cancel"))
                {
                    SyncLibrary.Delete(_selected);
                    _selected = null;
                    _selectedPreview = null;
                    RefreshLibrary();
                }
            }
            EditorGUILayout.EndHorizontal();
            EditorGUILayout.EndVertical();
        }

        void DrawZoomPreview()
        {
            var area = GUILayoutUtility.GetRect(100, 4000, 100, 4000, GUILayout.ExpandWidth(true), GUILayout.ExpandHeight(true));
            if (_selectedPreview == null)
            {
                GUI.Label(area, "No preview", EditorStyles.centeredGreyMiniLabel);
                return;
            }

            var evt = Event.current;
            if (evt.type == EventType.ScrollWheel && area.Contains(evt.mousePosition))
            {
                _zoom = Mathf.Clamp(_zoom * (evt.delta.y < 0 ? 1.1f : 0.9f), 0.1f, 2f);
                _fitZoom = false;
                evt.Use();
                Repaint();
            }

            if (_fitZoom)
                _zoom = Mathf.Clamp(
                    Mathf.Min(area.width / _selectedPreview.width, area.height / _selectedPreview.height),
                    0.1f, 2f);

            float w = _selectedPreview.width * _zoom;
            float h = _selectedPreview.height * _zoom;
            _previewScroll = GUI.BeginScrollView(area, _previewScroll, new Rect(0, 0, w, h));
            GUI.DrawTexture(new Rect(0, 0, w, h), _selectedPreview, ScaleMode.StretchToFill);
            GUI.EndScrollView();
        }

        void DrawLog()
        {
            if (_lastLog == null) return;
            foreach (var entry in _lastLog)
            {
                if (entry.Level == BuildLogEntry.LogLevel.Success) continue;
                EditorGUILayout.HelpBox(entry.Message,
                    entry.Level == BuildLogEntry.LogLevel.Error ? MessageType.Error : MessageType.Warning);
            }
        }

        void DrawStatus()
        {
            if (!string.IsNullOrEmpty(_status))
                EditorGUILayout.HelpBox(_status, _statusIsError ? MessageType.Error : MessageType.Info);

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

Khác biệt chính so với v2 (để reviewer đối chiếu nhanh):
- Bỏ `Tabs`/`_tab`/`DrawSyncTab`/`DrawLibraryTab`/`DrawSource`/`DrawStagedPreview`;
  bỏ state `_staged`/`_stagedPreview` (thay bằng `_syncedFolder`/`_syncedUrl`).
- MenuItem `Window/Figma/Sync` → `Window/Figma/Dashboard`, title "Figma Dashboard".
- `DoSync` chạy thêm `FigmaPreviewRenderer.ImportAndRender` (OutputMode.None) →
  `unity-preview.png`, auto-select entry, lưu log.
- `DoBuild` ping prefab qua `EditorGUIUtility.PingObject`, set `_lastLog`.
- Detail có toggle `Unity build | Figma` + `DrawLog` (warning/error).
- `RefreshLibrary` reload preview texture của entry đang chọn (file unity-preview
  vừa được ghi lại sau Sync).

- [ ] **Step 3: Compile + console + test**

Run: `utk --project /Users/zasuo/Unity/Unity-AI editor refresh --compile`
Run: `utk --project /Users/zasuo/Unity/Unity-AI console --type error`
Run: `utk --project /Users/zasuo/Unity/Unity-AI test --filter FigmaImporter.Tests`
Expected: 0 errors, 11 tests PASS.

- [ ] **Step 4: Verify menu** — trong Unity Editor: menu **Window ▸ Figma** chỉ còn đúng 1 item **Dashboard** (Import và Sync biến mất).

- [ ] **Step 5: Commit**

```bash
git add UnityFigImporter/Editor/FigmaImporterWindow.cs UnityFigImporter/Editor/Sync/FigmaSyncWindow.cs
git commit -m "feat(unity): single Figma Dashboard — merged view, settings foldout, Unity render preview"
```

---

### Task 25: README v3 + verify e2e

**Files:**
- Modify: `UnityFigImporter/README.md` (mục "Realtime Sync window")

- [ ] **Step 1: Thay mục "Realtime Sync window" trong README** bằng:

```markdown
## Figma Dashboard (Window ▸ Figma ▸ Dashboard)

Menu duy nhất của tool. Sync một element từ Figma, xem ngay **kết quả import
thật của Unity**, rồi mới Build prefab.

1. Mở Figma Desktop + plugin FigExportForUnity.
2. Mở **Window ▸ Figma ▸ Dashboard**. Mở foldout **Settings** nếu cần đổi
   Port (mặc định 1994, nút **Check**), spawn standalone bridge, Output Mode,
   Prefab Save Path, Sprite Folder.
3. Bấm **Use current Figma selection** (hoặc dán URL/node-id) → **Sync**.
4. Sync = export assets + manifest vào `.unity-figma/<node-id>/` **+ chạy
   pipeline import thật** (textures vào Sprite Folder, dựng hierarchy offscreen)
   → render `unity-preview.png`. Detail panel hiện đúng những gì Unity sẽ build —
   thấy ngay lỗi gộp ảnh / nhầm font / nhầm text để quay lại sửa trên Figma.
   Toggle **Unity build | Figma** để so với render gốc; log warning/error hiện
   dưới preview.
5. Ưng rồi thì bấm **Build** → prefab được tạo (Output Mode trong Settings) và
   được ping trong Project window. Data staging giữ nguyên.
6. Cột trái: mọi element đã sync (search, tuổi "22m"/"4h"); chọn để xem lại,
   **Build** lại hoặc **Delete** (xoá khỏi `.unity-figma`).
7. (tùy chọn) **Refine with AI** sau khi Build để bàn giao cho Claude (figma-build 4-6).

> Khuyến nghị thêm `.unity-figma/` vào `.gitignore` của Unity project.
```

- [ ] **Step 2: Verify server + plugin**

Run: `cd FigExportForUnity/server && bun test src && bun run build`
Expected: 24 tests PASS, build OK.

- [ ] **Step 3: Verify e2e thủ công** (cần Figma Desktop + plugin + bridge đang chạy):
  1. Menu **Window ▸ Figma** → chỉ còn **Dashboard**.
  2. Dashboard → Settings → Check → "Bridge OK (plugin connected)".
  3. Use current Figma selection → **Sync** → Expected: entry mới auto-select;
     detail hiện **Unity render** (toggle ở "Unity build"); file
     `.unity-figma/<id>/unity-preview.png` tồn tại (`file` cho thấy PNG hợp lệ);
     sprites đã import vào Sprite Folder; **chưa** có prefab.
  4. Toggle **Figma** → hiện `preview.png` (render gốc).
  5. **Build** → prefab tạo tại Prefab Save Path + được ping trong Project window.
  6. Chọn entry cũ (sync trước v3) → toggle ẩn, hint "No Unity preview yet",
     hiện Figma preview.

- [ ] **Step 4: Commit**

```bash
git add UnityFigImporter/README.md
git commit -m "docs(unity): document v3 Figma Dashboard — single menu + Unity render preview"
```

---

## Self-Review (Phase 4)

**Spec V3 coverage:**
- Bỏ 2 menu, còn `Window/Figma/Dashboard` → Task 24 Step 1 (xoá attribute Import,
  giữ class) + Step 2 (MenuItem Dashboard). ✓
- Gộp Sync + Library thành 1 view → Task 24 `OnGUI` (TopBar/Settings/list+detail/status). ✓
- Config vào Settings foldout (Port/Check, spawn, Output Mode, Prefab Path, Sprite Folder) → Task 24 `DrawSettings`. ✓
- Selection button + URL ở ngoài, cạnh Sync → Task 24 `DrawTopBar`. ✓
- Sync hiển thị kết quả import Unity thật → Task 21 (`OutputMode.None` + `Root`) +
  Task 23 (`FigmaPreviewRenderer`) + Task 24 `DoSync` (auto-select, toggle mặc định Unity). ✓
- Toggle Unity/Figma + entry cũ fallback → Task 24 `DrawDetail` + Task 22 (`UnityPreviewPath` null). ✓
- Log warnings/errors cho QA → Task 24 `DrawLog`. ✓
- Build ping prefab → Task 24 `DoBuild`. ✓
- Server blacklist `unity-preview.png` → Task 20. ✓
- Render fail best-effort → Task 23 catch → Warning log, không fail import. ✓
- Clamp 2048 → Task 23 `MaxSize` + `fit`. ✓

**Type consistency:** `ImportResult.Root` (Task 21) khớp usage Task 23
(`result.Root`); `SyncLibrary.UnityPreviewPath`/`LoadTexture` (Task 22) khớp
Task 24 (`Select`/`LoadSelectedPreview`/`DrawDetail`); `FigmaPreviewRenderer.ImportAndRender(ImportRequest, string)`
(Task 23) khớp call-site Task 24 `DoSync`; `BuildLogEntry.LogLevel` dùng đúng
3 mức Success/Warning/Error đã có.

**Placeholder scan:** không có TBD; mọi step có code/lệnh/expected cụ thể.
