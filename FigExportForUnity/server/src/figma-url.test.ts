import { describe, expect, test } from "bun:test";
import { parseFigmaNodeId } from "./figma-url.js";

describe("parseFigmaNodeId", () => {
  test("returns nodeId verbatim when valid colon format", () => {
    expect(parseFigmaNodeId({ nodeId: "4029:12345" })).toBe("4029:12345");
  });

  test("rejects nodeId with hyphen format", () => {
    expect(() => parseFigmaNodeId({ nodeId: "4029-12345" })).toThrow(/colon format/);
  });

  test("parses node-id from figma design URL", () => {
    const url = "https://www.figma.com/design/AbCdEf123/My-File?node-id=4029-12345&t=xyz";
    expect(parseFigmaNodeId({ figmaUrl: url })).toBe("4029:12345");
  });

  test("prefers nodeId over figmaUrl when both given", () => {
    expect(parseFigmaNodeId({ nodeId: "1:2", figmaUrl: "https://www.figma.com/design/X/Y?node-id=3-4" })).toBe("1:2");
  });

  test("throws when figmaUrl has no node-id param", () => {
    expect(() => parseFigmaNodeId({ figmaUrl: "https://www.figma.com/design/AbC/File" })).toThrow(/node-id/);
  });

  test("throws when neither nodeId nor figmaUrl given", () => {
    expect(() => parseFigmaNodeId({})).toThrow(/nodeId or figmaUrl/);
  });

  test("throws on unparsable URL", () => {
    expect(() => parseFigmaNodeId({ figmaUrl: "not a url" })).toThrow();
  });
});
