#!/usr/bin/env bash
#
# setup.sh — Build + run the Figma plugin / MCP bridge server (git-bash on Windows).
#
# Commands:
#   ./setup.sh                build plugin + server, print guide, start server (background)
#   ./setup.sh build          build plugin + server only (no start)
#   ./setup.sh start          start the bridge server in background (no rebuild)
#   ./setup.sh stop           stop the running bridge server
#   ./setup.sh restart        restart the bridge server (no rebuild)
#   ./setup.sh status         show whether the server is running
#   ./setup.sh logs           follow the server log (Ctrl+C to detach)
#
set -euo pipefail

# --- Resolve paths (works regardless of where the script is called from) ------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$SCRIPT_DIR/FigExportForUnity"
SERVER_DIR="$PLUGIN_DIR/server"
MANIFEST="$PLUGIN_DIR/manifest.json"
MCP_ENTRY="$SERVER_DIR/dist/index.js"

PORT="${FIGMA_BRIDGE_PORT:-1994}"
PIDFILE="$SCRIPT_DIR/.figma-bridge.pid"
LOGFILE="$SCRIPT_DIR/.figma-bridge.log"

# --- Detect OS (for process management differences) ---------------------------
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) OS="windows" ;;  # git-bash on Windows
  Darwin)               OS="mac" ;;
  *)                    OS="linux" ;;
esac

# --- Pick a package manager / runtime -----------------------------------------
# Prefer bun (faster, already used by this repo); fall back to npm + node.
if command -v bun >/dev/null 2>&1; then
  PKG="bun"
else
  PKG="npm"
fi

# --- Process helpers (cross-platform) -----------------------------------------
# Print the PID that is LISTENING on $PORT (empty if none).
port_pid() {
  if [ "$OS" = "windows" ]; then
    netstat -ano 2>/dev/null \
      | awk -v p=":$PORT\$" '/LISTENING/ && $2 ~ p {print $NF; exit}'
  else
    # macOS / Linux: lsof is the portable way to find the listener.
    lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null | head -n1
  fi
}

kill_pid() {
  # $1 = PID. Windows uses taskkill; macOS/Linux use POSIX kill (TERM then KILL).
  local pid="$1"
  if [ "$OS" = "windows" ]; then
    taskkill //F //PID "$pid" >/dev/null 2>&1 || kill "$pid" 2>/dev/null || true
  else
    kill "$pid" 2>/dev/null || true
    # Escalate to SIGKILL if it is still alive after a moment.
    sleep 1
    kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
  fi
}

# --- Build steps --------------------------------------------------------------
run_install() {
  echo "==> Installing dependencies in $1"
  ( cd "$1" && { [ "$PKG" = "bun" ] && bun install || npm install; } )
}

build_all() {
  echo ""
  echo "######################################################################"
  echo "# Building Figma plugin (dist/main.js + dist/ui.html)"
  echo "######################################################################"
  run_install "$PLUGIN_DIR"
  ( cd "$PLUGIN_DIR" && { [ "$PKG" = "bun" ] && bun run build || npm run build; } )

  echo ""
  echo "######################################################################"
  echo "# Building MCP bridge server (dist/index.js)"
  echo "######################################################################"
  run_install "$SERVER_DIR"
  ( cd "$SERVER_DIR" && { [ "$PKG" = "bun" ] && bun run build || npm run build; } )

  echo ""
  echo "==> Verifying build artifacts..."
  local f
  for f in "$PLUGIN_DIR/dist/main.js" "$PLUGIN_DIR/dist/ui.html" "$MCP_ENTRY"; do
    if [ -f "$f" ]; then echo "    OK  $f"; else echo "    MISSING  $f" >&2; exit 1; fi
  done
}

# --- Server lifecycle ---------------------------------------------------------
start_server() {
  local existing
  existing="$(port_pid)"
  if [ -n "$existing" ]; then
    echo "==> Server already running (PID $existing on port $PORT). Nothing to do."
    return 0
  fi
  echo "==> Starting Figma bridge server in background on ws://localhost:$PORT"
  ( cd "$SERVER_DIR" && {
      if command -v bun >/dev/null 2>&1; then
        bun run src/standalone.ts
      else
        node dist/standalone.js
      fi
    } ) >"$LOGFILE" 2>&1 &
  echo $! > "$PIDFILE"

  # Give it a moment to bind the port, then confirm.
  local pid="" i
  for i in 1 2 3 4 5; do
    pid="$(port_pid)"
    [ -n "$pid" ] && break
    sleep 1
  done
  if [ -n "$pid" ]; then
    echo "==> Server started (listening PID $pid). Logs: $LOGFILE"
  else
    echo "==> Server did not bind port $PORT yet — check logs: $LOGFILE" >&2
  fi
}

stop_server() {
  local pid
  pid="$(port_pid)"
  if [ -z "$pid" ]; then
    echo "==> Server not running (nothing listening on port $PORT)."
    rm -f "$PIDFILE"
    return 0
  fi
  echo "==> Stopping server (PID $pid on port $PORT)..."
  kill_pid "$pid"
  sleep 1
  if [ -n "$(port_pid)" ]; then
    echo "==> Warning: port $PORT still in use." >&2
  else
    echo "==> Stopped."
  fi
  rm -f "$PIDFILE"
}

status_server() {
  local pid
  pid="$(port_pid)"
  if [ -n "$pid" ]; then
    echo "==> RUNNING — PID $pid listening on ws://localhost:$PORT"
  else
    echo "==> STOPPED — nothing listening on port $PORT"
  fi
}

logs_server() {
  if [ ! -f "$LOGFILE" ]; then
    echo "No log file yet: $LOGFILE" >&2
    exit 1
  fi
  echo "==> Following $LOGFILE (Ctrl+C to detach)"
  tail -f "$LOGFILE"
}

# --- Install guide ------------------------------------------------------------
print_guide() {
  local node_bin
  node_bin="$(command -v node || echo node)"
  cat <<EOF

######################################################################
# BUILD COMPLETE — Installation guide
######################################################################

------------------------------------------------------------------
A) Install the Figma plugin (desktop app, development mode)
------------------------------------------------------------------
  1. Open the Figma DESKTOP app (browser version cannot load local plugins).
  2. Menu: Plugins -> Development -> Import plugin from manifest...
  3. Select this manifest file:
       $MANIFEST
  4. The plugin "Figma to Unity" now appears under
     Plugins -> Development. Run it from there.

  After future code changes: re-run './setup.sh build', then right-click
  the plugin in Figma and choose "Reload plugin".

------------------------------------------------------------------
B) Register the MCP server in your AI tool
------------------------------------------------------------------
  The MCP server uses stdio transport — your AI client spawns it.
  Add this to the client's MCP config:

    {
      "mcpServers": {
        "figma-bridge": {
          "command": "$node_bin",
          "args": ["$MCP_ENTRY"]
        }
      }
    }

  * Claude Code (project scope) — run once from the repo root:
      claude mcp add figma-bridge --scope project -- "$node_bin" "$MCP_ENTRY"
    (This repo already ships a .mcp.json with this entry.)

  * Claude Desktop — add the block above to claude_desktop_config.json,
    then fully restart Claude Desktop.

------------------------------------------------------------------
C) How it connects
------------------------------------------------------------------
  - The bridge server listens on ws://localhost:$PORT.
  - The Figma plugin connects to it over WebSocket.
  - The MCP server process (spawned by your AI tool) joins the same
    port via leader/follower election and proxies tool calls to the
    plugin — so the AI reads live Figma data without hitting the
    Figma REST API rate limits.

  Manage the server: ./setup.sh [status|stop|restart|logs]

######################################################################
EOF
}

# --- Command dispatch ---------------------------------------------------------
CMD="${1:-default}"
case "$CMD" in
  build)
    build_all
    echo ""
    echo "==> Build only. Start the server with: ./setup.sh start"
    ;;
  start)
    start_server
    ;;
  stop)
    stop_server
    ;;
  restart)
    stop_server
    start_server
    ;;
  status)
    status_server
    ;;
  logs)
    logs_server
    ;;
  default|--no-start)
    echo "==> Using package manager: $PKG"
    build_all
    print_guide
    if [ "$CMD" = "--no-start" ]; then
      echo "==> --no-start given; not starting the server."
      echo "    Start it later with: ./setup.sh start"
    else
      start_server
    fi
    ;;
  *)
    echo "Unknown command: $CMD" >&2
    echo "Usage: ./setup.sh [build|start|stop|restart|status|logs]" >&2
    exit 1
    ;;
esac
