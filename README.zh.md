<p align="center">
  <h1 align="center">Figma → Unity</h1>
  <p align="center">
    自动将 Figma 设计转换为 Unity UI，集成 AI 驱动的 MCP Bridge
    <br />
    <strong>🌐 <a href="README.md">English</a> · <a href="README.vi.md">Tiếng Việt</a></strong>
    <br />
    <br />
    <a href="#-快速开始">快速开始</a>
    ·
    <a href="#-功能特性">功能特性</a>
    ·
    <a href="https://github.com/zasuozz-oss/figma-to-unity/issues">报告问题</a>
    ·
    <a href="https://github.com/zasuozz-oss/figma-to-unity/issues">功能请求</a>
  </p>
</p>

<p align="center">
  <a href="https://github.com/zasuozz-oss/figma-to-unity/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License" /></a>
  <a href="https://unity.com/"><img src="https://img.shields.io/badge/Unity-2022.3%2B-black?logo=unity" alt="Unity" /></a>
  <a href="https://www.figma.com/"><img src="https://img.shields.io/badge/Figma-Plugin-F24E1E?logo=figma&logoColor=white" alt="Figma" /></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-%3E%3D20-339933?logo=node.js&logoColor=white" alt="Node.js" /></a>
  <a href="https://modelcontextprotocol.io/"><img src="https://img.shields.io/badge/MCP-Compatible-8B5CF6" alt="MCP" /></a>
</p>

> **📖 Figma 插件完整使用文档 → [`docs/figma-plugin-guide.md`](docs/figma-plugin-guide.md)**

---

## 📖 目录

- [项目概述](#-项目概述)
- [功能特性](#-功能特性)
- [项目架构](#-项目架构)
- [环境要求](#-环境要求)
- [快速开始](#-快速开始)
- [使用说明](#-使用说明)
- [元素级控制](#-元素级控制)
- [约束与锚点映射](#-约束与锚点映射)
- [安全性](#-安全性)
- [开发](#-开发)
- [致谢](#-致谢)
- [许可证](#-许可证)

---

## 🔍 项目概述

**Figma → Unity** 是一套端到端的流水线，可将 Figma 设计自动转换为 Unity UI，最大程度减少手动操作。包含三个组件：

| 组件 | 说明 |
|:---|:---|
| **Figma 插件** | 运行于 Figma Desktop。遍历设计树，将 manifest JSON + PNG 资源导出为 ZIP 文件。 |
| **MCP Bridge 服务器** | 基于 stdio 的 [Model Context Protocol](https://modelcontextprotocol.io/) 服务器。允许 AI 工具（Cursor、Claude、Antigravity）通过 WebSocket 实时读取 Figma 设计数据。 |
| **Unity 导入器** | Editor Window，自动解析 manifest、导入贴图并构建完整的 UI 层级。 |

---

## ✨ 功能特性

| 类别 | 功能 |
|:---|:---|
| **导出** | 一键从 Figma 导出 ZIP（manifest.json + PNG） |
| **导入** | 从 manifest 自动在 Unity 中创建完整 UI 层级 |
| **AI 集成** | MCP Bridge 让 AI 工具实时读取 Figma 设计数据 |
| **布局** | Figma Auto Layout → Unity HorizontalLayoutGroup / VerticalLayoutGroup |
| **文本** | TextMeshPro 自动映射字体族、字体样式、大小、颜色和对齐方式 |
| **字体映射** | 自动识别 Figma 字体族与样式，并映射到 TextMeshPro Font Asset |
| **去重** | 基于 FNV-1a 哈希的 PNG 去重——跳过相同资源以减小 ZIP 体积 |
| **Sprite Atlas** | 从导入的 Sprite 自动创建 SpriteAtlas，支持高级 padding 与旋转设置 |
| **渲染管线** | 支持 UGUI（Canvas + Image）和 2D Object（SpriteRenderer）两种模式 |
| **缩放选项** | 0.5x、0.75x、1x、1.5x、2x、3x、4x 或固定宽高（512w、1024h 等） |
| **元素控制** | 每个节点可独立设置 Merge、Exclude、PNG 栅格化 |
| **批量重命名** | 批量将图层重命名为 `snake_case`，支持自定义前缀和撤销 |
| **右键菜单** | 右键图层可快速重命名、切换显隐、切换合并或单独导出子树 |
| **配置同步** | 通过 `settings.json` 导入导出配置，跨会话恢复设置 |
| **窗口尺寸** | 响应式插件 UI，支持 S、M、L 三种窗口预设 |
| **最小化模式** | 将插件收起为紧凑的 MCP 状态栏 |
| **Canvas 选项** | Canvas 缩放预设、新建或复用已有 Canvas、宽高匹配设置 |
| **贴图导入器** | 高级贴图设置（压缩格式、过滤模式、Max Size 自动检测、自定义输出目录） |

---

## 🏗️ 项目架构

```
figma-to-unity/
├── FigExportForUnity/                # Figma 插件 + MCP 服务器
│   ├── src/                          # 插件源码（TypeScript）
│   │   ├── main.ts                   # 插件入口（Figma 沙箱）
│   │   ├── ui.ts / ui.html           # 插件 UI（图层树、设置）
│   │   ├── traverser.ts              # DFS 节点遍历
│   │   ├── mapper.ts                 # 约束 → Unity 锚点
│   │   ├── exporter.ts               # PNG 导出 + manifest + 哈希去重
│   │   ├── naming.ts                 # 文件命名规则
│   │   └── types.ts                  # 类型定义
│   │
│   ├── server/                       # MCP Bridge 服务器
│   │   └── src/
│   │       ├── index.ts              # Stdio 传输入口
│   │       ├── leader.ts             # HTTP + WebSocket 桥接
│   │       ├── follower.ts           # 代理到 leader
│   │       ├── election.ts           # Leader/Follower 选举
│   │       ├── bridge.ts             # WebSocket ↔ Figma 插件
│   │       ├── tools.ts              # MCP 工具定义
│   │       ├── schema.ts             # Zod 验证
│   │       └── types.ts              # 共享类型
│   │
│   ├── dist/                         # 构建输出
│   └── manifest.json                 # Figma 插件 manifest
│
└── UnityFigImporter/                 # Unity Editor 包（C#）
    └── Editor/
        ├── FigmaImporterWindow.cs    # 主 EditorWindow
        ├── ManifestParser.cs         # JSON → C# 数据
        ├── TextureImportHelper.cs    # PNG → Sprite 导入
        ├── HierarchyBuilder.cs       # UI 层级构建器
        ├── SpriteAtlasHelper.cs      # 自动 SpriteAtlas
        └── Data/
            └── ManifestData.cs       # 数据模型
```

---

## 📋 环境要求

### Figma 插件 & MCP 服务器

| 依赖 | 版本 | 说明 |
|:---|:---|:---|
| **Node.js** | `>= 20.0.0` | 构建和运行 MCP 服务器所必需 |
| **npm** | `>= 9` | 随 Node.js 一起安装 |
| **Bun** *（可选）* | `>= 1.0` | 服务器构建的更快替代方案 |
| **Figma Desktop** | 最新版 | 插件不支持 Figma 网页版 |

### Unity 导入器

| 依赖 | 版本 | 说明 |
|:---|:---|:---|
| **Unity** | `2022.3+` LTS | 已在 2022.3 和 6000.x 上测试 |
| **TextMeshPro** | `3.0.6+` | 通过 Package Manager 安装 `com.unity.textmeshpro` |
| **Newtonsoft JSON** | `3.2.1+` | 通过 Package Manager 安装 `com.unity.nuget.newtonsoft-json` |
| **SpriteAtlas** *（可选）* | 内置 | 用于自动 Atlas 生成 |

### MCP 客户端（AI 工具）

任何支持 [Model Context Protocol](https://modelcontextprotocol.io/) stdio 传输的 AI 工具：
- **Cursor** — 通过 `.cursor/mcp.json`
- **Claude Desktop** — 通过 `claude_desktop_config.json`
- **Antigravity** — 通过 `mcp_config.json`

---

## 🚀 快速开始

### 1. 构建并启动全部（一条命令）

支持 **macOS、Linux 和 Windows（git-bash）**：

```bash
./setup.sh
```

该命令会安装依赖、构建 Figma 插件**和** MCP bridge 服务器、打印安装指南，然后在 `ws://localhost:1994` 上启动 bridge 服务器。

随时管理服务器：

```bash
./setup.sh start      # 后台启动 bridge 服务器
./setup.sh stop       # 停止
./setup.sh restart    # 重启
./setup.sh status     # 检查是否在运行
./setup.sh logs       # 实时查看服务器日志
./setup.sh build      # 仅重新构建插件 + 服务器（不启动）
```

<details>
<summary>手动构建（不使用 setup.sh）</summary>

```bash
# Figma 插件
cd FigExportForUnity && npm install && npm run build

# MCP bridge 服务器
cd FigExportForUnity/server && npm install && npx tsc   # 或：bun run build
```
</details>

然后在 Figma Desktop 中加载插件：
1. **插件** → **开发** → **从 manifest 导入插件...**
2. 选择 `FigExportForUnity/manifest.json`

### 2. 配置 MCP 客户端

在 AI 工具的 MCP 配置文件中添加：

```json
{
  "mcpServers": {
    "figma-bridge": {
      "command": "node",
      "args": ["<绝对路径>/FigExportForUnity/server/dist/index.js"]
    }
  }
}
```

> 将 `<绝对路径>` 替换为本机上该仓库的完整路径。
>
> **Claude Code：** 在仓库根目录注册一次该服务，然后用 `claude mcp list` 确认：
> ```bash
> claude mcp add figma-bridge --scope project -- node <绝对路径>/FigExportForUnity/server/dist/index.js
> ```

### 3. 安装 Unity 导入器

**方式 A — Git URL（推荐）：**
```
https://github.com/zasuozz-oss/figma-to-unity.git?path=UnityFigImporter
```

**方式 B — 本地包：**
1. **Window** → **Package Manager** → **"+"** → **从磁盘添加包...**
2. 选择 `UnityFigImporter/package.json`

**方式 C — 手动：**
将 `UnityFigImporter/` 文件夹复制到 Unity 项目的 `Assets/` 目录中。

---

## 📖 使用说明

### 从 Figma 导出

1. 选择要导出的 **Frame**
2. 运行 **插件** → **Figma to Unity**
3. *（可选）* 使用 **重命名** 工具批量重命名图层并添加前缀
4. 在图层树中配置元素级设置（Merge / PNG / Exclude）
5. 选择 **导出缩放比例**（0.5x – 4x 或固定尺寸）
6. 点击 **▶ Export for Unity** → 下载 ZIP 文件

### 导入到 Unity

1. 解压下载的 ZIP 文件
2. 打开 **Window** → **Figma Importer**
3. 选择包含 `manifest.json` 的文件夹
4. 在窗口中配置高级导入选项：

| 设置分组 | 选项 | 说明 | 可选值 / 范围 | 默认值 |
|:---|:---|:---|:---|:---|
| **输出设置** | **Render Pipeline** | 选择 Canvas UI 或 2D 世界空间 Sprite | UGUI / Object2D | UGUI |
| | **输出模式** | 在当前 Scene 构建、保存为 Prefab 或两者同时 | Scene / Prefab / Both | Scene |
| **Canvas** | **Canvas Target** | 新建 Canvas 或附加到 Scene 中已有的 Canvas | 新建 / 使用已有 | 新建 |
| | **Canvas Scale** | UI 元素相对于 Figma 设计的缩放系数 | Auto / 1x / 1.5x / 2x / 3x / 4x / Custom | Auto |
| **Sprite 输出** | **输出目录** | Assets 中存储导入 Sprite 的路径 | 浏览选择任意资源目录 | `Assets/Sprites/`（自动检测） |
| **字体映射** | **Font Mapping** | 将每个唯一 Figma 字体（Family + Style）映射到项目中的 TMP_FontAsset | 对象选择框 | 按名称自动匹配 |
| **构建选项** | **禁用 Raycast** | 关闭所有非交互 UI 元素上的 Raycast Target | 开 / 关 | 关 |
| | **缩放到 Unity** | 自动缩放 UI 元素以适配目标 Canvas 分辨率 | 开 / 关 | 开 |
| **贴图** | **自动检测 Max Size** | 根据 PNG 实际尺寸自动设置贴图 Max Size | 开 / 关 | 开 |
| | **过滤与压缩** | 配置 Sprite 的过滤模式和压缩格式 | Bilinear/Trilinear/Point & Compressed/HQ/... | Bilinear & Compressed |
| **Sprite Atlas** | **创建 Atlas** | 将所有导入的 UI Sprite 打包到单个 SpriteAtlas | 开 / 关 | 关 |
| | **Atlas Padding** | Atlas 内 Sprite 之间的间距 | 0 – 8 像素 | 2 px |

5. 点击 **Build UI**

### MCP Bridge（AI 工具）

Figma 插件打开时，MCP Bridge 通过 `ws://localhost:1994/ws` 连接。AI 工具可调用以下 MCP 工具：

| 工具 | 说明 |
|:---|:---|
| `get_document` | 当前 Figma 页面的完整文档树 |
| `get_selection` | 当前选中的节点 |
| `get_node` | 按 ID 获取指定节点 |
| `get_styles` | 所有本地颜色和文本样式 |
| `get_metadata` | 文档名称、页面列表、当前页面信息 |
| `get_design_context` | 当前选中内容的摘要树（针对 AI 优化） |
| `get_variable_defs` | 所有变量集合、模式和值（设计 Token） |
| `get_screenshot` | 导出节点的 PNG 截图——返回 base64 |
| `save_screenshots` | 导出多个节点并将 PNG 直接写入本地文件系统 |
| `export_element` | 通过完整 Unity 管线导出单个 frame/component——将 `manifest.json` + PNG 资源写入磁盘 |

### Agent 工作流——通过 utk 无头导入

AI agent（Claude Code、Cursor 等）可以端到端运行整条管线——无需下载 ZIP、无需打开 Editor 窗口——只需将 MCP Bridge 与 [utk (Unity CLI AgentKit)](https://github.com/zasuozz-oss/unity-cli-agentkit) 结合使用。utk 是一个从终端控制 Unity Editor 的单二进制 CLI：

1. **导出**——调用 MCP 工具 `export_element` 并传入 `figmaUrl`（或 `nodeId`）。它会将 `manifest.json` + PNG 资源写入 `~/Desktop/FigmaImports/<元素名>`（或 `$FIGMA_EXPORT_ROOT`），位于 Unity 项目之外——导入器会自行将所需内容复制到 `Assets/`。
2. **导入**——通过 utk 在打开的 Unity Editor 中运行无头导入器：

   ```bash
   utk exec 'return FigmaImporter.FigmaHeadlessImporter.Import("<export-folder>", "Both");'
   ```

   `Import(exportFolder, outputMode, prefabSavePath, spriteFolder)`——`outputMode` 可为 `Scene`、`Prefab` 或 `Both`；Prefab 默认保存到 `Assets/Prefabs/UI/`。返回 JSON：`{ success, rootName, textureCount, outputMode, log[] }`。

要求：Figma Desktop 已打开插件（第 1 步），且 Unity Editor 正在运行并已连接 utk——安装 utk，在 Unity 项目中运行 `utk init`，然后用 `utk status` 验证（第 2 步）。

---

## 🔧 元素级控制

### 图层树内联按钮

| 按钮 | 功能 |
|:---|:---|
| **M** — 合并 | 将该元素及其所有子元素合并为单张 PNG |
| **P** — PNG | 将文本节点栅格化为 PNG，而非生成 TextMeshPro 组件 |
| **×** — 排除 | 从导出中完全移除该元素及其子树 |
| **👁** — 显隐 | 切换该元素在 Figma 画布中的可见性 |

### 右键菜单

| 菜单项 | 功能 |
|:---|:---|
| ✏️ **重命名** | 直接在图层树中重命名该元素 |
| 👁 **切换显隐** | 同内联 👁 按钮 |
| 🔗 **切换合并** | 同内联 M 按钮 |
| 📦 **导出此元素** | 将该元素子树单独导出为 ZIP |

---

## 📐 约束与锚点映射

| Figma 约束 | Unity 锚点 |
|:---|:---|
| `LEFT` | `anchorMin.x = 0, anchorMax.x = 0` |
| `RIGHT` | `anchorMin.x = 1, anchorMax.x = 1` |
| `CENTER` | `anchorMin.x = 0.5, anchorMax.x = 0.5` |
| `LEFT_RIGHT` | `anchorMin.x = 0, anchorMax.x = 1` |
| `TOP` | `anchorMin.y = 1, anchorMax.y = 1` |
| `BOTTOM` | `anchorMin.y = 0, anchorMax.y = 0` |
| `TOP_BOTTOM` | `anchorMin.y = 0, anchorMax.y = 1` |

---

## 🔒 安全性

- 服务器仅绑定 `localhost:1994`——不对外网暴露
- 文件操作采用路径遍历防护和独占写标志
- 通过 [Zod](https://zod.dev/) 对所有 MCP 工具调用进行输入验证
- 不含 `eval()`、`exec()` 或硬编码密钥

---

## 📝 开发

```bash
# 构建全部 + 启动 bridge 服务器（macOS / Linux / git-bash）
./setup.sh

# Figma 插件——监听模式（保存时自动重建）
cd FigExportForUnity
npm run watch

# 仅重新构建插件 + 服务器，不启动（任意平台）
./setup.sh build
```

---

## 🙏 致谢

- MCP Bridge Server 基于 **gethopp** 的 [figma-mcp-bridge](https://github.com/gethopp/figma-mcp-bridge)

---

## 📝 许可证

本项目基于 [MIT 许可证](LICENSE) 发布。
