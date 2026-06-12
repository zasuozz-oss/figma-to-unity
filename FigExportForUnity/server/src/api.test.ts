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

  test("throws when metadata request fails", async () => {
    const s = {
      sendWithParams: async (type: string): Promise<BridgeResponse> => ({
        type: "response",
        requestId: "x",
        data: type === "get_selection" ? [{ id: "1:2", name: "X" }] : undefined,
        error: type === "get_metadata" ? "metadata failed" : undefined,
      }),
    };
    await expect(buildSelectionInfo(s)).rejects.toThrow(/metadata failed/);
  });
});
