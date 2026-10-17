# 知音 / Zhiyin（Project Resonance）

> 专为言语障碍用户设计的智能语音训练系统

[![React](https://img.shields.io/badge/React-18.3.1-blue)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8.3-blue)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-5.4.19-purple)](https://vitejs.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3.4.17-38bdf8)](https://tailwindcss.com/)

## 🌟 项目简介

**知音（Zhiyin，Project Resonance）** 是一个专为言语障碍用户设计的智能语音训练系统。通过先进的语音识别和语音合成技术，帮助用户进行个性化语音训练，提升沟通能力。

## 📁 项目结构

```
project-resonance-src/
├── frontend/                 # 前端 React 应用
│   ├── src/
│   │   ├── components/      # React 组件
│   │   ├── hooks/           # 自定义 Hooks
│   │   ├── pages/           # 页面组件
│   │   ├── lib/             # 工具函数
│   │   └── types/           # TypeScript 类型定义
│   ├── public/              # 静态资源
│   └── package.json         # 前端依赖配置
├── worker/                   # Cloudflare Worker API 网关
│   ├── src/
│   │   ├── services/        # 核心服务模块
│   │   ├── storage/         # 存储管理模块
│   │   ├── types/           # 类型定义
│   │   └── utils/           # 工具函数
│   ├── wrangler.jsonc       # Cloudflare Worker 配置
│   └── package.json         # Worker 依赖配置
└── README.md                 # 项目说明文档
```


## 🤖 Android 端侧版编译

Android 版把识别模型直接打进安装包：首次启动在本地展开并校验权重，之后**完全离线**识别（CPU 推理，不依赖 NPU / 云端）。

### 环境要求

| 组件 | 版本 |
|---|---|
| Node.js | 20+ |
| JDK | 21 |
| Android SDK | compileSdk / targetSdk 36 |
| Android NDK | `28.2.13676358` |
| CMake | `3.22.1` |
| Python（可选，仅工具脚本） | 3.11 |

### 1. 取回 llama.cpp 子模块

仓库不包含 `llama.cpp` 源码，需按固定提交检出（导出/对齐都基于该版本）：

```bash
git submodule update --init --recursive
# 如未登记子模块，可手动放置：
# git clone https://github.com/ggml-org/llama.cpp.git frontend/android/third_party/llama.cpp
# git -C frontend/android/third_party/llama.cpp checkout ad6c66839af3c5646fba8c6c2e2087a1e4e38948
```

### 2. 准备模型

从 ModelScope 下载两个官方 GGUF，放到仓库根目录的 `models/`：

```bash
# https://www.modelscope.cn/models/Fuller001/R2T2_gguf
models/Confucius4-R2T2-Q4_K_M.gguf       # 1,107,404,736 B
models/mmproj-Confucius4-R2T2-Q8_0.gguf  # 348,336,544 B
```

SHA-256 必须匹配，否则构建会失败：

```text
fa3cb46c8c3a66a58812b9098ba6e96a0266d4e8c9b3cf5ba34432fd2f9f6466  Confucius4-R2T2-Q4_K_M.gguf
8dc2c67e6a0484114928142d098db7ad94ae9f34c78948ef9d37a9678418cb65  mmproj-Confucius4-R2T2-Q8_0.gguf
```

### 3. 构建前端并同步到 Android

```bash
cd frontend
npm ci
npm run typecheck
npm run test
npm run build
npx cap sync android
```

### 4. 打包 APK（含模型）

```bash
cd android
./gradlew :app:prepareBundledModels      # 校验并复制权重到 assets（哈希不符即失败）
./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
```

产物：

```text
frontend/android/app/build/outputs/apk/debug/app-debug.apk   # 约 1.37 GiB
```

- `prepareBundledModels` 只读取 `models/` 下这两个文件，模型以 ZIP **STORED** 方式入包，首启直接流式展开。
- 只想得到不含模型的小包（首启在应用内下载）时，跳过该任务即可。
- 安装后首次启动会校验并复制权重（实测约 6 秒），需要约 5 GB 可用空间。

### 5. 设备要求

- Android 7 / API 24 以上，`arm64-v8a`
- 运行时按 CPU 能力自动选择 ARMv8.0–v9.2 内核，设置里可强制「基础 CPU」兼容模式
- 官方 6.74 秒样音在 Snapdragon 8 Gen 1 上约 3.3–3.9 秒完成识别

### 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| `Missing or wrong-sized bundled model` | `models/` 路径不对或文件不完整 |
| `Bundled model SHA-256 mismatch` | 模型被改动或下载损坏，重新下载 |
| 首次启动提示存储不足 | 需 ≥5 GB 可用空间（安装包 + 私有模型） |
| 识别很慢 | 设置里确认未强制「基础 CPU」模式 |

## 🚀 快速开始

### 环境要求

- Node.js 18+ 
- pnpm 8+ (推荐) 或 npm 9+
- 现代浏览器 (Chrome 90+, Firefox 88+, Safari 14+)

### 安装与运行

#### 前端应用

```bash
# 进入前端目录
cd frontend

# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev

# 构建生产版本
pnpm build
```

访问 http://localhost:8080 查看应用。

#### Cloudflare Worker

```bash
# 进入worker目录
cd worker

# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev

# 部署到Cloudflare
pnpm deploy
```

## 🎯 核心功能

- 🎤 **智能语音识别** - Whisper + Gemini 多引擎 ASR，支持降级 fallback
- 🔊 **语音合成与克隆** - CosyVoice 高质量 TTS
- 📱 **跨平台支持** - Web + iOS/Android 原生应用
- ♿ **无障碍设计** - WCAG 2.1 AA 合规，键盘导航 + 屏幕阅读器优化
- 🎯 **个性化训练** - 基于用户录音数据优化识别准确率

## 🏗️ 技术架构

### 前端技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| React | 18.3.1 | 用户界面框架 |
| TypeScript | 5.8.3 | 类型安全开发 |
| Vite | 5.4.19 | 构建工具和开发服务器 |
| Tailwind CSS | 3.4.17 | 原子化CSS框架 |
| Radix UI | 1.2.x | 无障碍基础组件 |
| shadcn/ui | - | 基于 Radix UI 的 UI 组件 |

### AI 服务集成

| 服务 | 功能 | 说明 |
|------|------|------|
| Whisper | 语音识别 | 主要识别引擎，通过VPC绑定 |
| Gemini | 备用ASR | Google AI Studio API |
| CosyVoice | 语音合成 | 高质量语音克隆技术 |
| 浏览器Speech API | 最终备用 | 原生语音识别支持 |

### 部署架构

```
浏览器/移动端 (React + TS)
        │
        ▼
Cloudflare Worker (API网关 + 反向代理)
        │
        ├──► 私有GPU服务 (Whisper / CosyVoice)
        │         │
        │         ▼
        │    MinIO 存储
        │
        └──► Gemini API (备用识别引擎)
             │
             ▼
        localStorage (用户数据管理)
```

### Worker 服务功能

Cloudflare Worker 作为 API 网关，提供以下核心服务：

- **音频处理** - 音频上传、存储管理
- **语音识别 (ASR)** - Whisper 主引擎，Gemini 备用引擎
- **语音合成 (TTS)** - CosyVoice 语音合成与克隆
- **语料管理** - 语料收集、存储、查询
- **任务队列** - ASR/TTS 任务管理
- **日志收集** - 客户端日志上传与查询

Worker通过VPC服务连接到私有GPU服务，提供Whisper语音识别、CosyVoice语音合成和MinIO存储服务。

## 📊 性能优化

- **首包优化**：前端包体积减少 57%
- **路由懒加载**：基于路由的代码分割
- **缓存策略**：Service Worker + CDN 缓存
- **连接稳定性**：ASR 错误自动恢复机制
- **内存管理**：P0-P2 级别内存泄漏修复

## 🤝 贡献指南

我们欢迎社区贡献！请遵循以下步骤：

1. Fork 项目仓库
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request

### 开发规范

- 使用 TypeScript 进行类型安全开发
- 遵循无障碍设计原则 (WCAG 2.1 AA)
- 编写单元测试覆盖核心功能
- 更新相关文档

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 🙏 致谢

感谢以下开源项目和技术的支持：

- [OpenAI Whisper](https://github.com/openai/whisper) - 语音识别技术
- [Google Gemini](https://ai.google.dev/) - AI语言模型
- [CosyVoice](https://cosyvoice.org/) - 语音合成技术
- [Cloudflare Workers](https://workers.cloudflare.com/) - 边缘计算平台
- [Radix UI](https://www.radix-ui.com/) - 无障碍组件库

---

**Project Resonance** - 让每一个声音都被听见 🔊