#!/usr/bin/env node

import { Election } from "./election.js";
import { Node } from "./node.js";

const PORT = Number(process.env.FIGMA_BRIDGE_PORT ?? 1994);

async function main(): Promise<void> {
  const node = new Node(PORT);
  const election = new Election(PORT, node);
  await election.start();

  const shutdown = () => {
    election.stop();
    node.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.error(`Standalone Figma bridge running (role: ${node.roleName})`);
  // Keep process alive; the HTTP/WS server (Leader) is bound by Election.
  setInterval(() => {}, 1 << 30);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
