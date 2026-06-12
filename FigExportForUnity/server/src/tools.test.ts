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
