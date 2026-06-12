/** Figma node IDs use colon format, e.g. "4029:12345". URLs carry "4029-12345". */
const NODE_ID_PATTERN = /^\d+:\d+$/;

export function parseFigmaNodeId(input: { nodeId?: string; figmaUrl?: string }): string {
  if (input.nodeId) {
    if (!NODE_ID_PATTERN.test(input.nodeId)) {
      throw new Error(`nodeId must use colon format, e.g. '4029:12345' (got '${input.nodeId}')`);
    }
    return input.nodeId;
  }

  if (input.figmaUrl) {
    const url = new URL(input.figmaUrl);
    const raw = url.searchParams.get("node-id");
    if (!raw) throw new Error("figmaUrl has no node-id query parameter");
    const id = raw.replace("-", ":");
    if (!NODE_ID_PATTERN.test(id)) throw new Error(`Unrecognized node-id value in figmaUrl: '${raw}'`);
    return id;
  }

  throw new Error("Provide nodeId or figmaUrl");
}

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
      .replace(/[^A-Za-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "design";
  const hyphenId = nodeId.replace(":", "-");
  return `https://www.figma.com/design/${fileKey}/${slug}?node-id=${hyphenId}`;
}
