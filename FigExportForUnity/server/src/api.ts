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
  if (metaResp.error) throw new Error(metaResp.error);
  const fileKey =
    (metaResp.data as { fileKey?: string | null } | undefined)?.fileKey ?? null;

  const nodeId = first.id;
  const name = first.name ?? "";
  return { nodeId, name, fileKey, url: buildFigmaUrl(fileKey, nodeId, name) };
}
