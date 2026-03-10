# Figma-To-Unity — Standalone Tool + MCP with AI Bonus

> Công cụ chuyển đổi thiết kế Figma sang Unity UI một cách tự động, tích hợp MCP (Model Context Protocol) và hỗ trợ AI.

## 🎯 Mục Tiêu Dự Án

Xây dựng một công cụ **standalone** có khả năng:
- **Import trực tiếp** từ Figma vào Unity Editor
- **Tự động tạo UI hierarchy** (Canvas, Panel, Text, Image, Button...) dựa trên cấu trúc Figma
- **Tích hợp MCP** để AI agent có thể điều khiển quy trình chuyển đổi
- **AI Bonus**: Sử dụng AI để tối ưu hóa và gợi ý cải thiện UI

## 🏗️ Kiến Trúc

```
figma-to-unity/
├── src/                    # Source code chính
│   ├── figma-api/          # Figma REST API client
│   ├── parser/             # Figma node parser & transformer
│   ├── unity-generator/    # Unity UI code generator
│   └── mcp-server/         # MCP server integration
├── unity-plugin/           # Unity Editor Plugin
│   ├── Editor/             # Editor scripts
│   └── Runtime/            # Runtime utilities
├── docs/                   # Tài liệu
├── tests/                  # Unit & integration tests
└── examples/               # Ví dụ mẫu
```

## ✨ Tính Năng Chính

### Standalone Tool
- [ ] Kết nối Figma API (Personal Access Token)
- [ ] Parse Figma document tree
- [ ] Chuyển đổi Figma nodes → Unity UI elements
- [ ] Hỗ trợ Auto Layout → Unity Layout Groups
- [ ] Export assets (images, icons) tự động
- [ ] Mapping fonts & styles

### MCP Integration
- [ ] MCP Server cho Figma-to-Unity pipeline
- [ ] Tool: `figma_import` — Import từ Figma URL
- [ ] Tool: `figma_preview` — Xem trước cấu trúc UI
- [ ] Tool: `figma_sync` — Đồng bộ thay đổi từ Figma
- [ ] Resource: Design tokens & style guide

### AI Bonus
- [ ] AI-powered layout optimization
- [ ] Tự động đề xuất component reuse
- [ ] Smart naming cho GameObjects
- [ ] Responsive layout suggestions

## 🚀 Bắt Đầu

### Yêu cầu
- Node.js >= 18
- Unity 2022.3+ (LTS)
- Figma Personal Access Token

### Cài đặt

```bash
# Clone repository
git clone <repo-url>
cd figma-to-unity

# Cài đặt dependencies
npm install

# Cấu hình
cp .env.example .env
# Thêm FIGMA_TOKEN vào .env
```

## 📝 License

Private — All rights reserved.
