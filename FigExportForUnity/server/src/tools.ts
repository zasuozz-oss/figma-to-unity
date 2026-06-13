import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseFigmaNodeId } from "./figma-url.js";
import type { Node } from "./node.js";
import { exportElementInput, toolInputSchemas } from "./schema.js";
import type { BridgeResponse } from "./types.js";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export type ExportFormat = "PNG" | "SVG" | "JPG" | "PDF";

export interface ScreenshotSender {
  sendWithParams(
    requestType: string,
    nodeIds?: string[],
    params?: Record<string, unknown>,
    timeoutMs?: number
  ): Promise<BridgeResponse>;
}

interface ScreenshotExport {
  nodeId: string;
  nodeName: string;
  format: ExportFormat;
  base64: string;
  width?: number;
  height?: number;
}

interface ExportElementAsset {
  name: string;
  data: number[];
}

interface ExportElementPayload {
  manifest: unknown;
  assets: ExportElementAsset[];
}

interface SaveScreenshotItemInput {
  nodeId: string;
  outputPath: string;
  format?: ExportFormat;
  scale?: number;
}

interface SaveScreenshotItemResult {
  index: number;
  nodeId: string;
  nodeName?: string;
  outputPath: string;
  format?: ExportFormat;
  width?: number;
  height?: number;
  bytesWritten?: number;
  success: boolean;
  error?: string;
}

export function registerTools(server: McpServer, node: Node): void {
  server.tool(
    "get_document",
    "Get the current Figma page document tree",
    async (): Promise<ToolResult> => {
      return renderResponse(() => node.send("get_document"));
    }
  );

  server.tool(
    "get_selection",
    "Get the currently selected nodes in Figma",
    async (): Promise<ToolResult> => {
      return renderResponse(() => node.send("get_selection"));
    }
  );

  server.tool(
    "get_node",
    "Get a specific Figma node by ID. Must use colon format, e.g. '4029:12345', never use hyphens.",
    toolInputSchemas.get_node.shape,
    async ({ nodeId }): Promise<ToolResult> => {
      return renderResponse(() => node.send("get_node", [nodeId]));
    }
  );

  server.tool(
    "get_styles",
    "Get all local styles in the document",
    async (): Promise<ToolResult> => {
      return renderResponse(() => node.send("get_styles"));
    }
  );

  server.tool(
    "get_metadata",
    "Get metadata about the current Figma document including file name, pages, and current page info",
    async (): Promise<ToolResult> => {
      return renderResponse(() => node.send("get_metadata"));
    }
  );

  server.tool(
    "get_design_context",
    "Get the design context for the current selection or page. Returns a summarized tree structure optimized for understanding the current design context.",
    toolInputSchemas.get_design_context.shape,
    async ({ depth }): Promise<ToolResult> => {
      const params: Record<string, unknown> = {};
      if (depth !== undefined && depth > 0) {
        params.depth = depth;
      }
      return renderResponse(() =>
        node.sendWithParams("get_design_context", undefined, params)
      );
    }
  );

  server.tool(
    "get_variable_defs",
    "Get all local variable definitions including variable collections, modes, and variable values. Variables are Figma's system for design tokens (colors, numbers, strings, booleans).",
    async (): Promise<ToolResult> => {
      return renderResponse(() => node.send("get_variable_defs"));
    }
  );

  server.tool(
    "get_screenshot",
    "Export a screenshot of the selected nodes or specific nodes by ID. Returns base64-encoded image data.",
    toolInputSchemas.get_screenshot.shape,
    async ({ nodeIds, format, scale }): Promise<ToolResult> => {
      const params: Record<string, unknown> = {};
      if (format) params.format = format;
      if (scale !== undefined && scale > 0) params.scale = scale;
      return renderResponse(() =>
        node.sendWithParams("get_screenshot", nodeIds, params)
      );
    }
  );

  server.tool(
    "save_screenshots",
    "Export screenshots for multiple nodes and save them directly to the local filesystem. Returns metadata only (no base64).",
    toolInputSchemas.save_screenshots.shape,
    async ({ items, format, scale }): Promise<ToolResult> => {
      try {
        const result = await executeSaveScreenshots(node, items, format, scale);
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
  );

  server.tool(
    "export_element",
    "Export one Figma element (frame/component) through the full Unity export pipeline: writes manifest.json + PNG assets to outputDir, preserving the manifest contract (assetBounds, icon detection, naming, text resolution). Requires the FigExportForUnity plugin to be open in Figma Desktop.",
    exportElementInput.shape,
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
  );

  // -------------------------------------------------------------------------
  // Write tools — build UI Contract + node-level mutates
  // -------------------------------------------------------------------------

  server.tool(
    "figma_build",
    "Build a full native UI tree in Figma from a UI Contract (frames/text/shapes/assets with real fills, strokes, effects, auto-layout). Returns the created id tree {id,name,type,children} plus warnings. Requires the FigExportForUnity plugin open in Figma Desktop.",
    toolInputSchemas.figma_build.shape,
    async ({ contract, parentId }): Promise<ToolResult> => {
      return renderResponse(() =>
        node.sendWithParams("figma_build", undefined, { contract, parentId }, 120_000)
      );
    }
  );

  server.tool(
    "figma_set_fill",
    "Set the fill (solid color or gradient) of a Figma node by ID.",
    toolInputSchemas.figma_set_fill.shape,
    async ({ nodeId, paint }): Promise<ToolResult> => {
      return renderResponse(() =>
        node.sendWithParams("figma_set_fill", [nodeId], { paint })
      );
    }
  );

  server.tool(
    "figma_set_stroke",
    "Set the stroke (outline color, weight, align) of a Figma node by ID.",
    toolInputSchemas.figma_set_stroke.shape,
    async ({ nodeId, stroke }): Promise<ToolResult> => {
      return renderResponse(() =>
        node.sendWithParams("figma_set_stroke", [nodeId], { stroke })
      );
    }
  );

  server.tool(
    "figma_set_text",
    "Update a TEXT node: content, font family/style/size, color, alignment, line height, letter spacing. Only provided fields change.",
    toolInputSchemas.figma_set_text.shape,
    async ({ nodeId, text }): Promise<ToolResult> => {
      return renderResponse(() =>
        node.sendWithParams("figma_set_text", [nodeId], { text })
      );
    }
  );

  server.tool(
    "figma_set_effects",
    "Replace all effects (drop shadow, inner shadow, layer blur) on a Figma node by ID.",
    toolInputSchemas.figma_set_effects.shape,
    async ({ nodeId, effects }): Promise<ToolResult> => {
      return renderResponse(() =>
        node.sendWithParams("figma_set_effects", [nodeId], { effects })
      );
    }
  );

  server.tool(
    "figma_set_layout",
    "Apply or disable auto-layout on a FRAME node (mode, gap, padding, alignment).",
    toolInputSchemas.figma_set_layout.shape,
    async ({ nodeId, layout }): Promise<ToolResult> => {
      return renderResponse(() =>
        node.sendWithParams("figma_set_layout", [nodeId], { layout })
      );
    }
  );

  server.tool(
    "figma_move_resize",
    "Move and resize a Figma node: absolute x/y in parent coordinates plus width/height.",
    toolInputSchemas.figma_move_resize.shape,
    async ({ nodeId, rect }): Promise<ToolResult> => {
      return renderResponse(() =>
        node.sendWithParams("figma_move_resize", [nodeId], { rect })
      );
    }
  );

  server.tool(
    "figma_place_asset",
    "Replace a node with a raster/vector asset: custom bytes (PNG/SVG) or an Iconify icon by name (e.g. 'mdi:home'). Keeps the node's name, position and size. Returns the new nodeId.",
    toolInputSchemas.figma_place_asset.shape,
    async ({ nodeId, source }): Promise<ToolResult> => {
      return renderResponse(() =>
        node.sendWithParams("figma_place_asset", [nodeId], { source }, 60_000)
      );
    }
  );

  server.tool(
    "figma_create_node",
    "Create a new ContractNode subtree under a parent node, optionally at a specific child index. Returns the created id tree.",
    toolInputSchemas.figma_create_node.shape,
    async ({ parentId, node: contractNodeInput, index }): Promise<ToolResult> => {
      return renderResponse(() =>
        node.sendWithParams(
          "figma_create_node",
          undefined,
          { parentId, node: contractNodeInput, index },
          120_000
        )
      );
    }
  );

  server.tool(
    "figma_delete_node",
    "Delete a Figma node by ID.",
    toolInputSchemas.figma_delete_node.shape,
    async ({ nodeId }): Promise<ToolResult> => {
      return renderResponse(() =>
        node.sendWithParams("figma_delete_node", [nodeId], {})
      );
    }
  );

  server.tool(
    "figma_rename_node",
    "Rename a Figma node by ID. Use PascalCase English names (BtnConfirm, TxtTitle, PnlItemList).",
    toolInputSchemas.figma_rename_node.shape,
    async ({ nodeId, name }): Promise<ToolResult> => {
      return renderResponse(() =>
        node.sendWithParams("figma_rename_node", [nodeId], { name })
      );
    }
  );

  // -------------------------------------------------------------------------
  // Library tools — components + variables (design tokens)
  // -------------------------------------------------------------------------

  server.tool(
    "figma_create_component",
    "Turn existing nodes into Figma components. With combineAsVariants, the resulting components merge into one component set (variants). Returns the component ids (and componentSetId when combined).",
    toolInputSchemas.figma_create_component.shape,
    async ({ nodeIds, combineAsVariants, name }): Promise<ToolResult> => {
      return renderResponse(() =>
        node.sendWithParams(
          "figma_create_component",
          nodeIds,
          { combineAsVariants, name },
          60_000
        )
      );
    }
  );

  server.tool(
    "figma_create_variable_collection",
    "Create a local variable collection (design tokens) with optional modes (e.g. Light/Dark) and variables. Color values are RGBA arrays with 0-1 channels. Returns collection, mode and variable ids for later figma_bind_variable calls.",
    toolInputSchemas.figma_create_variable_collection.shape,
    async ({ name, modes, variables }): Promise<ToolResult> => {
      return renderResponse(() =>
        node.sendWithParams(
          "figma_create_variable_collection",
          undefined,
          { name, modes, variables },
          60_000
        )
      );
    }
  );

  server.tool(
    "figma_bind_variable",
    "Bind a variable to a node field: fill/stroke take a color variable; cornerRadius/gap/padding take a number variable. Get variable ids from get_variable_defs or figma_create_variable_collection.",
    toolInputSchemas.figma_bind_variable.shape,
    async ({ nodeId, field, variableId }): Promise<ToolResult> => {
      return renderResponse(() =>
        node.sendWithParams("figma_bind_variable", [nodeId], { field, variableId })
      );
    }
  );
}

export async function executeSaveScreenshots(
  sender: ScreenshotSender,
  items: SaveScreenshotItemInput[],
  format?: ExportFormat,
  scale?: number
): Promise<{
  total: number;
  succeeded: number;
  failed: number;
  hasErrors: boolean;
  results: SaveScreenshotItemResult[];
}> {
  const results: SaveScreenshotItemResult[] = [];

  for (const [index, item] of items.entries()) {
    const result = await saveScreenshotItemToFile(
      sender,
      item,
      index,
      process.cwd(),
      format,
      scale
    );
    results.push(result);
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.length - succeeded;

  return {
    total: results.length,
    succeeded,
    failed,
    hasErrors: failed > 0,
    results,
  };
}

async function renderResponse(
  fn: () => Promise<BridgeResponse>
): Promise<ToolResult> {
  try {
    const resp = await fn();
    if (resp.error) {
      return {
        content: [{ type: "text", text: resp.error }],
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(resp.data) }],
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

function resolveAndValidateOutputPath(
  outputPath: string,
  workspaceRoot: string
): string {
  const resolvedRoot = path.resolve(workspaceRoot);
  const resolvedPath = path.resolve(resolvedRoot, outputPath);
  const relativePath = path.relative(resolvedRoot, resolvedPath);
  const escapesRoot =
    relativePath.startsWith("..") || path.isAbsolute(relativePath);
  if (escapesRoot) {
    throw new Error(
      `outputPath must be inside the MCP server working directory: ${resolvedRoot}`
    );
  }
  return resolvedPath;
}

/**
 * Resolve the export directory. Unlike save_screenshots (locked to cwd),
 * export_element may target a Unity project outside the server cwd, so
 * absolute paths are allowed. If FIGMA_EXPORT_ROOT is set, the resolved
 * path must stay inside it.
 */
function resolveExportDir(outputDir: string): string {
  const resolved = path.resolve(process.cwd(), outputDir);
  const root = process.env.FIGMA_EXPORT_ROOT;
  if (root) {
    const resolvedRoot = path.resolve(root);
    const relative = path.relative(resolvedRoot, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(
        `outputDir must be inside FIGMA_EXPORT_ROOT: ${resolvedRoot}`
      );
    }
  }
  return resolved;
}

/**
 * Default export directory when the caller omits outputDir:
 * <FIGMA_EXPORT_ROOT or ~/Desktop/FigmaImports>/<sanitized element name>.
 * Raw exports live OUTSIDE any Unity project; the Unity importer copies
 * what it needs into Assets/ itself.
 */
function defaultExportDir(manifest: unknown): string {
  const name = (manifest as { screen?: { name?: string } })?.screen?.name;
  const safe =
    (name ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, "_")
      .replace(/^_+|_+$/g, "") || "export";
  const base =
    process.env.FIGMA_EXPORT_ROOT ??
    path.join(os.homedir(), "Desktop", "FigmaImports");
  return path.join(base, safe);
}

/** Create dir if missing and delete its current contents (re-export policy). */
async function emptyDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const entry of await readdir(dir)) {
    await rm(path.join(dir, entry), { recursive: true, force: true });
  }
}

function inferFormatFromPath(outputPath: string): ExportFormat | null {
  const ext = path.extname(outputPath).toLowerCase();
  switch (ext) {
    case ".png":
      return "PNG";
    case ".svg":
      return "SVG";
    case ".jpg":
    case ".jpeg":
      return "JPG";
    case ".pdf":
      return "PDF";
    default:
      return null;
  }
}

function resolveExportFormat(
  format: ExportFormat | undefined,
  inferredFormat: ExportFormat | null
): ExportFormat {
  if (format && inferredFormat && format !== inferredFormat) {
    throw new Error(
      `format ${format} conflicts with outputPath extension (${inferredFormat})`
    );
  }
  return format ?? inferredFormat ?? "PNG";
}

function getSingleScreenshotExport(data: unknown): ScreenshotExport {
  if (!data || (typeof data !== "object" && !Array.isArray(data))) {
    throw new Error("Invalid screenshot response from plugin");
  }

  const exports = Array.isArray(data)
    ? data
    : (data as { exports?: unknown }).exports;
  if (!Array.isArray(exports) || exports.length === 0) {
    throw new Error("No screenshot export returned by plugin");
  }

  const first = exports[0];
  if (
    !first ||
    typeof first !== "object" ||
    typeof (first as { nodeId?: unknown }).nodeId !== "string"
  ) {
    throw new Error("Malformed screenshot export payload");
  }

  const raw = first as {
    nodeId: string;
    nodeName?: unknown;
    name?: unknown;
    format?: unknown;
    base64?: unknown;
    data?: unknown;
    width?: unknown;
    height?: unknown;
  };
  const nodeName =
    typeof raw.nodeName === "string"
      ? raw.nodeName
      : typeof raw.name === "string"
        ? raw.name
        : "";
  const format =
    typeof raw.format === "string" ? (raw.format as ExportFormat) : "PNG";
  const width = typeof raw.width === "number" ? raw.width : undefined;
  const height = typeof raw.height === "number" ? raw.height : undefined;

  if (typeof raw.base64 === "string") {
    return { nodeId: raw.nodeId, nodeName, format, base64: raw.base64, width, height };
  }

  if (Array.isArray(raw.data)) {
    for (const byte of raw.data) {
      if (
        typeof byte !== "number" ||
        !Number.isInteger(byte) ||
        byte < 0 ||
        byte > 255
      ) {
        throw new Error("Malformed byte data for screenshot export");
      }
    }
    return {
      nodeId: raw.nodeId,
      nodeName,
      format,
      base64: Buffer.from(raw.data as number[]).toString("base64"),
      width,
      height,
    };
  }

  throw new Error("Malformed screenshot export payload");
}

export interface ExportElementResult {
  nodeId: string;
  outputDir: string;
  assetCount: number;
  assets: string[];
  name: string;
  nodeCount: number;
  previewFile: string | null;
}

/** Reads { name, nodeCount } from a manifest, with safe defaults. */
export function getManifestSummary(manifest: unknown): {
  name: string;
  nodeCount: number;
} {
  const m = manifest as { screen?: { name?: string }; elements?: unknown[] };
  return {
    name: m?.screen?.name ?? "export",
    nodeCount: Array.isArray(m?.elements) ? m.elements.length : 0,
  };
}

/**
 * Export core shared by the MCP `export_element` tool and the REST
 * `/api/export_element` route: calls the plugin, then writes manifest.json
 * + PNG assets to disk. Throws on any error.
 */
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
  const resolvedNodeId = parseFigmaNodeId({
    nodeId: input.nodeId,
    figmaUrl: input.figmaUrl,
  });
  const explicitDir =
    input.outputDir !== undefined ? resolveExportDir(input.outputDir) : null;

  const resp = await sender.sendWithParams(
    "export_element",
    [resolvedNodeId],
    input.scale !== undefined && input.scale > 0
      ? { scale: input.scale }
      : undefined,
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

  return {
    nodeId: resolvedNodeId,
    outputDir: resolvedDir,
    assetCount: payload.assets.length,
    assets: payload.assets.map((a) => a.name),
    name: summary.name,
    nodeCount: summary.nodeCount,
    previewFile,
  };
}

function getExportElementPayload(data: unknown): ExportElementPayload {
  if (!data || typeof data !== "object") {
    throw new Error("Malformed export_element payload from plugin");
  }

  const payload = data as { manifest?: unknown; assets?: unknown };
  if (
    !payload.manifest ||
    typeof payload.manifest !== "object" ||
    Array.isArray(payload.manifest) ||
    !Array.isArray(payload.assets)
  ) {
    throw new Error("Malformed export_element payload from plugin");
  }

  const assets: ExportElementAsset[] = [];
  for (const asset of payload.assets) {
    if (
      !asset ||
      typeof asset !== "object" ||
      typeof (asset as { name?: unknown }).name !== "string" ||
      !Array.isArray((asset as { data?: unknown }).data)
    ) {
      throw new Error("Malformed export_element asset from plugin");
    }

    const name = (asset as { name: string }).name;
    if (!isSafeAssetFileName(name)) {
      throw new Error(`Unsafe export_element asset filename: ${name}`);
    }

    const bytes = (asset as { data: unknown[] }).data;
    for (const byte of bytes) {
      if (
        typeof byte !== "number" ||
        !Number.isInteger(byte) ||
        byte < 0 ||
        byte > 255
      ) {
        throw new Error(`Malformed byte data for export_element asset: ${name}`);
      }
    }

    assets.push({ name, data: bytes as number[] });
  }

  return { manifest: payload.manifest, assets };
}

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

async function saveScreenshotItemToFile(
  sender: ScreenshotSender,
  item: SaveScreenshotItemInput,
  index: number,
  workspaceRoot: string,
  defaultFormat?: ExportFormat,
  defaultScale?: number
): Promise<SaveScreenshotItemResult> {
  let resolvedOutputPath = item.outputPath;

  try {
    resolvedOutputPath = resolveAndValidateOutputPath(
      item.outputPath,
      workspaceRoot
    );
    const inferredFormat = inferFormatFromPath(resolvedOutputPath);
    const resolvedFormat = resolveExportFormat(
      item.format ?? defaultFormat,
      inferredFormat
    );
    const resolvedScale = resolveScale(item.scale, defaultScale);

    const params: Record<string, unknown> = { format: resolvedFormat };
    if (resolvedScale !== undefined) {
      params.scale = resolvedScale;
    }

    const resp = await sender.sendWithParams(
      "get_screenshot",
      [item.nodeId],
      params
    );
    if (resp.error) {
      throw new Error(resp.error);
    }

    const screenshotExport = getSingleScreenshotExport(resp.data);
    const bytesWritten = await writeBase64ToFile(
      screenshotExport.base64,
      resolvedOutputPath
    );

    return {
      index,
      nodeId: screenshotExport.nodeId,
      nodeName: screenshotExport.nodeName,
      outputPath: resolvedOutputPath,
      format: resolvedFormat,
      width: screenshotExport.width,
      height: screenshotExport.height,
      bytesWritten,
      success: true,
    };
  } catch (err) {
    return {
      index,
      nodeId: item.nodeId,
      outputPath: resolvedOutputPath,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function writeBase64ToFile(
  base64: string,
  outputPath: string
): Promise<number> {
  const bytes = Buffer.from(base64, "base64");
  await mkdir(path.dirname(outputPath), { recursive: true });
  try {
    await writeFile(outputPath, bytes, { flag: "wx" });
  } catch (err) {
    if (isNodeError(err) && err.code === "EEXIST") {
      throw new Error(`File already exists at outputPath: ${outputPath}`);
    }
    throw err;
  }
  return bytes.length;
}

function resolveScale(
  itemScale?: number,
  defaultScale?: number
): number | undefined {
  const resolvedScale = itemScale ?? defaultScale;
  if (resolvedScale === undefined || resolvedScale <= 0) {
    return undefined;
  }
  return resolvedScale;
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error;
}
