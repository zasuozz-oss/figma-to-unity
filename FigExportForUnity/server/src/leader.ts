import http from "node:http";
import type { Duplex } from "node:stream";
import { buildSelectionInfo } from "./api.js";
import { Bridge } from "./bridge.js";
import { validateRpc } from "./schema.js";
import { executeSaveScreenshots, exportElementToDisk } from "./tools.js";
import type { ExportFormat } from "./tools.js";
import type { RPCRequest, RPCResponse } from "./types.js";
import { VERSION } from "./version.js";

/**
 * Leader owns the WebSocket bridge to Figma and exposes HTTP endpoints for followers.
 * Endpoints:
 *   /ws   — WebSocket upgrade for the Figma plugin
 *   /ping — Health check
 *   /rpc  — JSON RPC for follower tool calls
 */
export class Leader {
  private bridge: Bridge;
  private server: http.Server | null = null;

  constructor(private port: number) {
    this.bridge = new Bridge();
  }

  getBridge(): Bridge {
    return this.bridge;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        if (req.url === "/ping" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ok", version: VERSION }));
          return;
        }

        if (req.url === "/rpc" && req.method === "POST") {
          this.handleRPC(req, res);
          return;
        }

        if (req.url === "/api/health" && req.method === "GET") {
          this.sendJSON(res, 200, {
            data: {
              ok: true,
              version: VERSION,
              pluginConnected: this.bridge.isPluginConnected(),
            },
          });
          return;
        }

        if (req.url === "/api/selection" && req.method === "GET") {
          this.handleSelection(res);
          return;
        }

        if (req.url === "/api/export_element" && req.method === "POST") {
          this.handleExportElement(req, res);
          return;
        }

        if (req.url === "/api/command" && req.method === "POST") {
          this.handleCommand(req, res);
          return;
        }

        res.writeHead(404);
        res.end("Not found");
      });

      server.on(
        "upgrade",
        (req: http.IncomingMessage, socket: Duplex, head: Buffer) => {
          if (req.url === "/ws") {
            this.bridge.handleUpgrade(req, socket, head);
          } else {
            socket.destroy();
          }
        }
      );

      // Fail fast if port is already in use
      server.once("error", (err: NodeJS.ErrnoException) => {
        reject(
          err.code === "EADDRINUSE"
            ? new Error(`Port ${this.port} already in use`)
            : err
        );
      });

      // Bind loopback only: the bridge runs Figma tools + REST with no auth, so it
      // must never be reachable from the LAN — all clients (plugin, followers, Unity)
      // connect over localhost.
      server.listen(this.port, "127.0.0.1", () => {
        this.server = server;
        console.error(`Leader listening on 127.0.0.1:${this.port}`);
        resolve();
      });
    });
  }

  private handleRPC(req: http.IncomingMessage, res: http.ServerResponse): void {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on("end", async () => {
      try {
        const rpcReq: RPCRequest = JSON.parse(body);

        const validationError = validateRpc(
          rpcReq.tool,
          rpcReq.nodeIds,
          rpcReq.params
        );
        if (validationError) {
          this.sendJSON(res, 400, { error: validationError });
          return;
        }

        // Currently the tool that is not forwarded to the plugin is save_screenshots
        // If more are added we need to refactor to a better abstraction.
        if (rpcReq.tool === "save_screenshots") {
          const params = rpcReq.params ?? {};
          const result = await executeSaveScreenshots(
            this.bridge,
            params.items as Parameters<typeof executeSaveScreenshots>[1],
            params.format as ExportFormat | undefined,
            params.scale as number | undefined
          );
          this.sendJSON(res, 200, { data: result });
          return;
        }

        const resp = await this.bridge.sendWithParams(
          rpcReq.tool,
          rpcReq.nodeIds,
          rpcReq.params,
          rpcReq.timeoutMs
        );

        this.sendJSON(
          res,
          200,
          resp.error ? { error: resp.error } : { data: resp.data }
        );
      } catch (err) {
        this.sendJSON(res, 200, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }

  private async handleSelection(res: http.ServerResponse): Promise<void> {
    try {
      const info = await buildSelectionInfo(this.bridge);
      this.sendJSON(res, 200, { data: info });
    } catch (err) {
      this.sendJSON(res, 200, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private handleExportElement(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): void {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on("end", async () => {
      try {
        const input = JSON.parse(body || "{}") as {
          nodeId?: string;
          figmaUrl?: string;
          outputDir?: string;
          scale?: number;
          includePreview?: boolean;
        };
        const result = await exportElementToDisk(this.bridge, input);
        this.sendJSON(res, 200, { data: result });
      } catch (err) {
        this.sendJSON(res, 200, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }

  /**
   * Generic node-mutation passthrough for the Unity sync window.
   * Body: { type: string, nodeIds?: string[], params?: object }
   * Forwards to the plugin via the bridge and returns { data } or { error }.
   */
  private handleCommand(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): void {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on("end", async () => {
      try {
        const input = JSON.parse(body || "{}") as {
          type?: string;
          nodeIds?: string[];
          params?: Record<string, unknown>;
        };
        if (!input.type) {
          this.sendJSON(res, 400, { error: "Missing command type" });
          return;
        }
        const resp = await this.bridge.sendWithParams(
          input.type,
          input.nodeIds,
          input.params
        );
        this.sendJSON(
          res,
          200,
          resp.error ? { error: resp.error } : { data: resp.data }
        );
      } catch (err) {
        this.sendJSON(res, 200, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }

  private sendJSON(
    res: http.ServerResponse,
    status: number,
    body: RPCResponse
  ): void {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  }

  stop(): void {
    this.bridge.close();
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}
