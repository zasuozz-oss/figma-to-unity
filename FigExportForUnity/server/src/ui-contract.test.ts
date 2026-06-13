// FigExportForUnity/server/src/ui-contract.test.ts
import { describe, expect, test } from "bun:test";
import { uiContract, contractNode } from "./ui-contract.js";
import { validateRpc } from "./schema.js";

const validRoot = {
  name: "GameOverPopup",
  type: "frame",
  rect: { x: 0, y: 0, w: 375, h: 812 },
  fill: { type: "solid", color: [0.2, 0.1, 0.5, 1] },
  layout: { mode: "vertical", gap: 16, padding: { t: 24, r: 16, b: 24, l: 16 } },
  children: [
    {
      name: "TxtTitle", type: "text", size: { w: 200, h: 40 },
      text: { content: "Game Over", fontSize: 32, color: [1, 1, 1, 1], align: "center" },
    },
    {
      name: "BtnRestart", type: "rect", size: { w: 200, h: 56 },
      cornerRadius: 28,
      fill: {
        type: "gradient", gradientType: "linear",
        stops: [
          { position: 0, color: [0.3, 0.7, 1, 1] },
          { position: 1, color: [0.1, 0.4, 0.9, 1] },
        ],
      },
      effects: [{ type: "drop-shadow", color: [0, 0, 0, 0.3], offset: { x: 0, y: 4 }, blur: 8 }],
    },
    { name: "IconHome", type: "asset", size: { w: 32, h: 32 },
      source: { kind: "iconify", icon: "mdi:home", color: [1, 1, 1, 1] } },
    { name: "Divider", type: "line", size: { w: 200, h: 1 },
      stroke: { color: [1, 1, 1, 0.4], weight: 1 } },
    { name: "Gem", type: "polygon", pointCount: 6, size: { w: 24, h: 24 },
      fill: { type: "solid", color: [0, 1, 0.5, 1] } },
    { name: "Wave", type: "vector", size: { w: 375, h: 60 },
      svg: "<path d='M0 0 C100 60 275 0 375 60'/>" },
  ],
};

describe("uiContract schema", () => {
  test("contract hợp lệ parse OK (đủ 8 node type qua frame lồng)", () => {
    const result = uiContract.safeParse({ version: "1.0", root: validRoot });
    expect(result.success).toBe(true);
  });

  test("thiếu name → fail", () => {
    const result = contractNode.safeParse({ type: "rect", rect: { x: 0, y: 0, w: 1, h: 1 } });
    expect(result.success).toBe(false);
  });

  test("type lạ → fail", () => {
    const result = contractNode.safeParse({ name: "X", type: "star" });
    expect(result.success).toBe(false);
  });

  test("text thiếu content → fail", () => {
    const result = contractNode.safeParse({
      name: "T", type: "text", text: { fontSize: 12, color: [0, 0, 0, 1] },
    });
    expect(result.success).toBe(false);
  });

  test("RGBA ngoài 0..1 → fail", () => {
    const result = contractNode.safeParse({
      name: "R", type: "rect", fill: { type: "solid", color: [255, 0, 0, 1] },
    });
    expect(result.success).toBe(false);
  });

  test("asset custom: bytes ngoài 0..255 → fail", () => {
    const result = contractNode.safeParse({
      name: "A", type: "asset", source: { kind: "custom", data: [300] },
    });
    expect(result.success).toBe(false);
  });

  test("children lồng sâu 3 cấp parse OK", () => {
    const result = contractNode.safeParse({
      name: "L1", type: "frame",
      children: [{
        name: "L2", type: "frame",
        children: [{ name: "L3", type: "ellipse", rect: { x: 0, y: 0, w: 10, h: 10 } }],
      }],
    });
    expect(result.success).toBe(true);
  });
});

describe("validateRpc — write tools", () => {
  const minimalContract = {
    version: "1.0",
    root: { name: "Root", type: "frame", rect: { x: 0, y: 0, w: 100, h: 100 } },
  };

  test("figma_build hợp lệ → null", () => {
    expect(validateRpc("figma_build", undefined, { contract: minimalContract })).toBeNull();
  });

  test("figma_build thiếu contract → lỗi", () => {
    expect(validateRpc("figma_build", undefined, {})).not.toBeNull();
  });

  test("figma_set_fill: nodeId từ nodeIds[0] + paint từ params → null", () => {
    expect(validateRpc("figma_set_fill", ["1:23"], {
      paint: { type: "solid", color: [1, 0, 0, 1] },
    })).toBeNull();
  });

  test("figma_set_fill: nodeId sai format → lỗi", () => {
    expect(validateRpc("figma_set_fill", ["1-23"], {
      paint: { type: "solid", color: [1, 0, 0, 1] },
    })).not.toBeNull();
  });

  test("figma_move_resize hợp lệ → null", () => {
    expect(validateRpc("figma_move_resize", ["1:23"], {
      rect: { x: 10, y: 10, w: 50, h: 50 },
    })).toBeNull();
  });

  test("figma_create_node hợp lệ → null", () => {
    expect(validateRpc("figma_create_node", undefined, {
      parentId: "1:23",
      node: { name: "New", type: "rect", rect: { x: 0, y: 0, w: 10, h: 10 } },
    })).toBeNull();
  });

  test("figma_rename_node thiếu name → lỗi", () => {
    expect(validateRpc("figma_rename_node", ["1:23"], {})).not.toBeNull();
  });

  test("figma_delete_node hợp lệ → null", () => {
    expect(validateRpc("figma_delete_node", ["1:23"], {})).toBeNull();
  });
});
