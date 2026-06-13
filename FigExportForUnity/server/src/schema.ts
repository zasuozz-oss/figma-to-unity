import { z } from "zod";
import {
  uiContract, contractNode, contractPaint, contractStroke, contractEffect,
  contractAutoLayout, contractTextProps, contractRect, assetSource, rgba,
} from "./ui-contract.js";

/** Figma node IDs use colon-separated format, e.g. "4029:12345". */
export const figmaNodeId = z
  .string()
  .regex(/^\d+:\d+$/, "Node ID must use colon format, e.g. '4029:12345'");
const exportFormat = z.enum(["PNG", "SVG", "JPG", "PDF"]);

/** Variable value: RGBA tuple for color, plain primitives otherwise. */
const variableValue = z.union([rgba, z.number(), z.string(), z.boolean()]);
const variableDef = z.object({
  name: z.string().min(1).describe("Variable name; use slash paths for grouping, e.g. 'color/primary'"),
  type: z.enum(["color", "number", "string", "boolean"]).describe("Resolved variable type"),
  valuesByMode: z
    .record(z.string(), variableValue)
    .describe("Value per mode name (keys must match the collection's modes). Color = RGBA array, channels 0-1"),
});
const bindableField = z
  .enum(["fill", "stroke", "cornerRadius", "gap", "padding"])
  .describe("Node field to bind: fill/stroke take color variables; cornerRadius/gap/padding take number variables");

export const toolInputSchemas = {
  get_node: z.object({
    nodeId: figmaNodeId.describe("The node ID to fetch"),
  }),

  get_design_context: z.object({
    depth: z
      .number()
      .optional()
      .describe("How many levels deep to traverse the node tree (default 2)"),
  }),

  get_screenshot: z.object({
    nodeIds: z
      .array(figmaNodeId)
      .optional()
      .describe(
        "Optional list of node IDs to export (colon-separated format, e.g. '4029:12345' — never use hyphens). If empty, exports the current selection",
      ),
    format: exportFormat
      .optional()
      .describe("Export format: PNG (default) or SVG or JPG or PDF"),
    scale: z
      .number()
      .optional()
      .describe("Export scale for raster formats (default 2)"),
  }),

  save_screenshots: z.object({
    items: z
      .array(
        z.object({
          nodeId: figmaNodeId.describe("The node ID to export"),
          outputPath: z
            .string()
            .min(1)
            .describe(
              "Output file path (relative paths resolve from the MCP server current working directory)",
            ),
          format: exportFormat
            .optional()
            .describe("Per-item export format override: PNG, SVG, JPG, or PDF"),
          scale: z
            .number()
            .optional()
            .describe("Per-item export scale override for raster formats"),
        }),
      )
      .min(1)
      .describe("List of screenshot save operations to execute in batch"),
    format: exportFormat
      .optional()
      .describe("Default export format: PNG (default) or SVG or JPG or PDF"),
    scale: z
      .number()
      .optional()
      .describe("Default export scale for raster formats (default 2)"),
  }),

  figma_build: z.object({
    contract: uiContract.describe("UI Contract describing the full tree to build"),
    parentId: figmaNodeId.optional().describe("Parent node to build under (default: current page)"),
  }),

  figma_set_fill: z.object({
    nodeId: figmaNodeId.describe("Target node"),
    paint: contractPaint.describe("New fill: solid, gradient, or none"),
  }),

  figma_set_stroke: z.object({
    nodeId: figmaNodeId.describe("Target node"),
    stroke: contractStroke.describe("Stroke: color, weight, align"),
  }),

  figma_set_text: z.object({
    nodeId: figmaNodeId.describe("Target TEXT node"),
    text: contractTextProps.partial().describe("Fields to update (content, fontSize, color, ...)"),
  }),

  figma_set_effects: z.object({
    nodeId: figmaNodeId.describe("Target node"),
    effects: z.array(contractEffect).describe("Replace all effects (shadow/blur)"),
  }),

  figma_set_layout: z.object({
    nodeId: figmaNodeId.describe("Target FRAME node"),
    layout: contractAutoLayout.describe("Auto-layout settings; mode 'none' disables"),
  }),

  figma_move_resize: z.object({
    nodeId: figmaNodeId.describe("Target node"),
    rect: contractRect.describe("New absolute position + size in parent coordinates"),
  }),

  figma_place_asset: z.object({
    nodeId: figmaNodeId.describe("Node to replace with the asset (keeps name/position/size)"),
    source: assetSource.describe("custom bytes or iconify icon name"),
  }),

  figma_create_node: z.object({
    parentId: figmaNodeId.describe("Parent node to insert under"),
    node: contractNode.describe("ContractNode subtree to create"),
    index: z.number().int().min(0).optional().describe("Insert position among siblings"),
  }),

  figma_delete_node: z.object({
    nodeId: figmaNodeId.describe("Node to delete"),
  }),

  figma_rename_node: z.object({
    nodeId: figmaNodeId.describe("Node to rename"),
    name: z.string().min(1).describe("New name (PascalCase English)"),
  }),

  figma_create_component: z.object({
    nodeIds: z
      .array(figmaNodeId)
      .min(1)
      .describe("Nodes to turn into components (each becomes its own component)"),
    combineAsVariants: z
      .boolean()
      .optional()
      .describe("Combine the resulting components into one component set (variants)"),
    name: z
      .string()
      .min(1)
      .optional()
      .describe("Name for the component set when combining (PascalCase English)"),
  }),

  figma_create_variable_collection: z.object({
    name: z.string().min(1).describe("Collection name, e.g. 'Tokens'"),
    modes: z
      .array(z.string().min(1))
      .min(1)
      .optional()
      .describe("Mode names, e.g. ['Light', 'Dark']. Omit for a single default mode"),
    variables: z
      .array(variableDef)
      .optional()
      .describe("Variables to create inside the collection"),
  }),

  figma_bind_variable: z.object({
    nodeId: figmaNodeId.describe("Target node"),
    field: bindableField,
    variableId: z
      .string()
      .min(1)
      .describe("Variable ID from get_variable_defs or figma_create_variable_collection"),
  }),
} as const;

/**
 * Input for the export_element MCP tool. Kept OUT of toolInputSchemas on
 * purpose: that map also validates the follower→leader RPC wire format,
 * which for export_element only carries nodeIds + scale (outputDir is
 * resolved locally by whichever instance received the MCP call).
 */
export const exportElementInput = z.object({
  nodeId: figmaNodeId
    .optional()
    .describe("Node ID in colon format, e.g. '4029:12345'"),
  figmaUrl: z
    .string()
    .optional()
    .describe(
      "Figma URL containing ?node-id=... (alternative to nodeId; nodeId wins if both given)",
    ),
  outputDir: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Directory to write manifest.json + PNG assets into (absolute path, or relative to the MCP server cwd). Defaults to ~/Desktop/FigmaImports/<element-name>. Existing files inside are deleted first.",
    ),
  scale: z.number().optional().describe("Export scale (default 2)"),
});

type ToolName = keyof typeof toolInputSchemas;

/**
 * Maps the RPC wire format { tool, nodeIds?, params? } to each tool's
 * expected input shape. Typed as Record<ToolName, ...> so adding a schema
 * without a mapper is a compile error.
 */
const rpcToArgs: Record<
  ToolName,
  (nodeIds?: string[], params?: Record<string, unknown>) => unknown
> = {
  get_node: (nodeIds) => ({ nodeId: nodeIds?.[0] }),
  get_design_context: (_nodeIds, params) => ({ ...params }),
  get_screenshot: (nodeIds, params) => ({ nodeIds, ...params }),
  save_screenshots: (_nodeIds, params) => ({ ...params }),
  figma_build: (_nodeIds, params) => ({ ...params }),
  figma_set_fill: (nodeIds, params) => ({ nodeId: nodeIds?.[0], ...params }),
  figma_set_stroke: (nodeIds, params) => ({ nodeId: nodeIds?.[0], ...params }),
  figma_set_text: (nodeIds, params) => ({ nodeId: nodeIds?.[0], ...params }),
  figma_set_effects: (nodeIds, params) => ({ nodeId: nodeIds?.[0], ...params }),
  figma_set_layout: (nodeIds, params) => ({ nodeId: nodeIds?.[0], ...params }),
  figma_move_resize: (nodeIds, params) => ({ nodeId: nodeIds?.[0], ...params }),
  figma_place_asset: (nodeIds, params) => ({ nodeId: nodeIds?.[0], ...params }),
  figma_create_node: (_nodeIds, params) => ({ ...params }),
  figma_delete_node: (nodeIds, params) => ({ nodeId: nodeIds?.[0], ...params }),
  figma_rename_node: (nodeIds, params) => ({ nodeId: nodeIds?.[0], ...params }),
  figma_create_component: (nodeIds, params) => ({ nodeIds: nodeIds ?? [], ...params }),
  figma_create_variable_collection: (_nodeIds, params) => ({ ...params }),
  figma_bind_variable: (nodeIds, params) => ({ nodeId: nodeIds?.[0], ...params }),
};

/**
 * Validate an RPC request against the corresponding tool's input schema.
 * Returns an error string on failure, null if valid or no schema exists for the tool.
 */
export function validateRpc(
  tool: string,
  nodeIds?: string[],
  params?: Record<string, unknown>,
): string | null {
  if (!(tool in toolInputSchemas)) return null;

  const name = tool as ToolName;
  const result = toolInputSchemas[name].safeParse(
    rpcToArgs[name](nodeIds, params),
  );
  return result.success ? null : result.error.issues[0].message;
}
