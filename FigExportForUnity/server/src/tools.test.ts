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

const samplePayload = {
  manifest: { screen: { name: "Shop Popup" }, elements: [{}, {}, {}] },
  assets: [{ name: "icon.png", data: [137, 80, 78, 71] }],
};

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
const pluginScreenshotPayload = [
  {
    nodeId: "4029:12345",
    name: "Shop Popup",
    format: "PNG",
    data: [137, 80, 78, 71],
  },
];

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

  test("writes preview from plugin screenshot byte-array response", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "figexp-"));
    const sender = typedSender({
      export_element: samplePayload,
      get_screenshot: pluginScreenshotPayload,
    });
    const result = await exportElementToDisk(sender, {
      nodeId: "4029:12345",
      outputDir: dir,
      includePreview: true,
    });

    expect(result.previewFile).toBe("preview.png");
    const png = await readFile(path.join(result.outputDir, "preview.png"));
    expect([...png]).toEqual([137, 80, 78, 71]);
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
