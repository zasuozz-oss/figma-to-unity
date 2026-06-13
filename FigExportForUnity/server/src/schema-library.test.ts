// Schemas for the library-authoring tools: components + variables.
import { describe, expect, test } from "bun:test";
import { validateRpc } from "./schema.js";

describe("figma_create_component RPC validation", () => {
  test("single node componentize is valid", () => {
    expect(validateRpc("figma_create_component", ["12:34"], {})).toBeNull();
  });

  test("multiple nodes combined as variants is valid", () => {
    expect(
      validateRpc("figma_create_component", ["12:34", "12:35"], {
        combineAsVariants: true,
        name: "BtnPrimary",
      }),
    ).toBeNull();
  });

  test("empty nodeIds is rejected", () => {
    expect(validateRpc("figma_create_component", [], {})).not.toBeNull();
  });

  test("hyphenated node id is rejected", () => {
    expect(validateRpc("figma_create_component", ["12-34"], {})).not.toBeNull();
  });
});

describe("figma_create_variable_collection RPC validation", () => {
  const colorVar = {
    name: "color/primary",
    type: "color",
    valuesByMode: { Light: [0.2, 0.4, 1, 1], Dark: [0.5, 0.7, 1, 1] },
  };
  const numberVar = {
    name: "radius/md",
    type: "number",
    valuesByMode: { Light: 8, Dark: 8 },
  };

  test("collection with modes + color/number variables is valid", () => {
    expect(
      validateRpc("figma_create_variable_collection", undefined, {
        name: "Tokens",
        modes: ["Light", "Dark"],
        variables: [colorVar, numberVar],
      }),
    ).toBeNull();
  });

  test("collection with only a name is valid", () => {
    expect(
      validateRpc("figma_create_variable_collection", undefined, { name: "Tokens" }),
    ).toBeNull();
  });

  test("missing name is rejected", () => {
    expect(
      validateRpc("figma_create_variable_collection", undefined, { modes: ["Light"] }),
    ).not.toBeNull();
  });

  test("color value in 0-255 range is rejected", () => {
    expect(
      validateRpc("figma_create_variable_collection", undefined, {
        name: "Tokens",
        variables: [
          { name: "color/bad", type: "color", valuesByMode: { Mode: [255, 0, 0, 1] } },
        ],
      }),
    ).not.toBeNull();
  });
});

describe("figma_bind_variable RPC validation", () => {
  test("binding a fill is valid", () => {
    expect(
      validateRpc("figma_bind_variable", ["12:34"], {
        field: "fill",
        variableId: "VariableID:1:23",
      }),
    ).toBeNull();
  });

  test("unknown field is rejected", () => {
    expect(
      validateRpc("figma_bind_variable", ["12:34"], {
        field: "rotation",
        variableId: "VariableID:1:23",
      }),
    ).not.toBeNull();
  });

  test("missing variableId is rejected", () => {
    expect(validateRpc("figma_bind_variable", ["12:34"], { field: "fill" })).not.toBeNull();
  });
});
