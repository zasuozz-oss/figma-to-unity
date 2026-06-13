// FigExportForUnity/server/src/ui-contract.ts
// =============================================================================
// zod schema cho UI Contract — mirror của plugin src/contract.ts.
// Validate TRƯỚC khi gửi qua bridge: contract sai chết ở server, không đụng Figma.
// =============================================================================
import { z } from "zod";

const channel = z.number().min(0).max(1);
export const rgba = z.tuple([channel, channel, channel, channel]);

export const contractRect = z.object({
  x: z.number(), y: z.number(),
  w: z.number().positive(), h: z.number().positive(),
});
export const contractSize = z.object({
  w: z.number().positive(), h: z.number().positive(),
});

export const contractPaint = z.discriminatedUnion("type", [
  z.object({ type: z.literal("solid"), color: rgba }),
  z.object({
    type: z.literal("gradient"),
    gradientType: z.enum(["linear", "radial"]),
    stops: z.array(z.object({ position: z.number().min(0).max(1), color: rgba })).min(2),
  }),
  z.object({ type: z.literal("none") }),
]);

export const contractStroke = z.object({
  color: rgba,
  weight: z.number().positive(),
  align: z.enum(["inside", "center", "outside"]).optional(),
});

export const contractEffect = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("drop-shadow"), color: rgba,
    offset: z.object({ x: z.number(), y: z.number() }),
    blur: z.number().min(0), spread: z.number().optional(),
  }),
  z.object({
    type: z.literal("inner-shadow"), color: rgba,
    offset: z.object({ x: z.number(), y: z.number() }),
    blur: z.number().min(0), spread: z.number().optional(),
  }),
  z.object({ type: z.literal("layer-blur"), blur: z.number().min(0) }),
]);

export const contractAutoLayout = z.object({
  mode: z.enum(["horizontal", "vertical", "none"]),
  gap: z.number().min(0).optional(),
  padding: z.object({ t: z.number(), r: z.number(), b: z.number(), l: z.number() }).optional(),
  primaryAlign: z.enum(["min", "center", "max", "space-between"]).optional(),
  counterAlign: z.enum(["min", "center", "max"]).optional(),
});

export const contractTextProps = z.object({
  content: z.string(),
  fontFamily: z.string().optional(),
  fontStyle: z.string().optional(),
  fontSize: z.number().positive(),
  color: rgba,
  align: z.enum(["left", "center", "right"]).optional(),
  lineHeight: z.number().positive().optional(),
  letterSpacing: z.number().optional(),
});

const byteValue = z.number().int().min(0).max(255);
export const assetSource = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("custom"), data: z.array(byteValue).min(1) }),
  z.object({ kind: z.literal("iconify"), icon: z.string().min(1), color: rgba.optional() }),
]);

const baseFields = {
  name: z.string().min(1),
  rect: contractRect.optional(),
  size: contractSize.optional(),
  opacity: z.number().min(0).max(1).optional(),
  visible: z.boolean().optional(),
  effects: z.array(contractEffect).optional(),
};

// Recursive: frame.children tham chiếu contractNode qua z.lazy
export const contractNode: z.ZodTypeAny = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({
      ...baseFields, type: z.literal("frame"),
      fill: contractPaint.optional(), stroke: contractStroke.optional(),
      cornerRadius: z.number().min(0).optional(),
      clipsContent: z.boolean().optional(),
      layout: contractAutoLayout.optional(),
      children: z.array(contractNode).optional(),
    }),
    z.object({ ...baseFields, type: z.literal("text"), text: contractTextProps }),
    z.object({
      ...baseFields, type: z.literal("rect"),
      fill: contractPaint.optional(), stroke: contractStroke.optional(),
      cornerRadius: z.number().min(0).optional(),
    }),
    z.object({
      ...baseFields, type: z.literal("ellipse"),
      fill: contractPaint.optional(), stroke: contractStroke.optional(),
    }),
    z.object({ ...baseFields, type: z.literal("line"), stroke: contractStroke }),
    z.object({
      ...baseFields, type: z.literal("polygon"),
      pointCount: z.number().int().min(3).optional(),
      fill: contractPaint.optional(), stroke: contractStroke.optional(),
    }),
    z.object({
      ...baseFields, type: z.literal("vector"),
      svg: z.string().min(1), fill: contractPaint.optional(),
    }),
    z.object({ ...baseFields, type: z.literal("asset"), source: assetSource.optional() }),
  ])
);

export const uiContract = z.object({
  version: z.literal("1.0"),
  root: contractNode,
});
