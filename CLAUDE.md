# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 常用命令

```bash
# 开发
pnpm dev                        # 启动所有包的开发服务器
pnpm generate                   # 所有包的生产构建

# Lint 和类型检查
pnpm lint                       # Lint 所有包
pnpm lintfix                    # 自动修复 lint 问题
pnpm typecheck                  # 类型检查所有包
pnpm pre-commit                 # lint + typecheck（husky 提交前钩子执行的命令）

# 测试
pnpm test                       # 运行所有测试

# 单个包的命令
pnpm --filter @hoppscotch/cli test
pnpm --filter @hoppscotch/cli do-typecheck
pnpm --filter @hoppscotch/common test
pnpm --filter hoppscotch-backend test
pnpm --filter hoppscotch-backend test:e2e
pnpm --filter hoppscotch-backend test:watch
pnpm --filter hoppscotch-backend start:dev     # 后端 watch 模式启动

# 后端运行单个 Jest 测试
pnpm --filter hoppscotch-backend test -- --testPathPattern=<测试名>

# 生成 GraphQL schema SDL（从后端输出到 gql-gen/ 目录）
pnpm gen-gql

# 启动一体化自部署环境（需要 Docker）
docker compose --profile default up
```

**环境要求：** Node.js 22、pnpm 10（推荐使用 `corepack enable`）。

## 仓库结构

pnpm workspace 的 monorepo，`packages/` 下有 12 个包。每个包都实现了 `do-*` 生命周期脚本（`do-dev`、`do-build-prod`、`do-lint`、`do-typecheck`、`do-test`、`do-lintfix`），根 `package.json` 通过 `pnpm -r` 统一调度这些脚本。

### 各包说明（自底向上的依赖顺序）

| 包 | 作用 |
|---|---|
| `hoppscotch-data` | 带版本号的数据类型（REST/GQL 请求、集合、环境变量、cookie），使用 `verzod` 管理数据迁移 |
| `hoppscotch-kernel` | 跨平台抽象层：IO、Relay（HTTP）、Store（键值存储）、Log，提供 `web` 和 `desktop` 两套实现，通过 `window.__KERNEL__` 注入 |
| `hoppscotch-js-sandbox` | 沙箱化 JS 执行环境（前置请求脚本 & 测试脚本），基于 `faraday-cage`（QuickJS）或 `isolated-vm`（V8），暴露 `pm.*`、`pw.*`、`hopp.*` 兼容命名空间 |
| `codemirror-lang-graphql` | CodeMirror 6 的 GraphQL 语法高亮（基于 Lezer 语法解析器） |
| `hoppscotch-common` | **核心前端。** Vue 3 + Vite，平台无关设计，通过 `setPlatformDef()` 在运行时注入平台实现 |
| `hoppscotch-backend` | NestJS 11 GraphQL API 服务器（Apollo 驱动），Prisma 7 + PostgreSQL，Redis pub/sub 实现订阅。端口 3170 |
| `hoppscotch-cli` | `hopp test` CLI 工具，用于 CI 环境中运行集合测试。以 `@hoppscotch/cli` 发布 |
| `hoppscotch-relay` | Rust 库，封装 `libcurl` 实现原生 HTTP 请求（绕过浏览器 CORS）。通过 FFI 供桌面端调用 |
| `hoppscotch-desktop` | Tauri v2 桌面应用。集成 `hoppscotch-common` + kernel 桌面实现 + Rust relay |
| `hoppscotch-selfhost-web` | 自部署 Web 应用。在 `hoppscotch-common` 基础上注入后端集成的认证/平台实现 |
| `hoppscotch-sh-admin` | 独立的管理后台（Vue 3 + urql）。管理用户、团队、认证配置、SMTP、频率限制等自部署实例配置 |
| `hoppscotch-agent` | 基于 Tauri 的 AI Agent 桌面应用 |

## 架构要点

### 平台抽象层（`hoppscotch-common/src/platform/`）

`hoppscotch-common` 定义了 `PlatformDef` 接口，涵盖 auth、analytics、UI、IO、kernel、sync、experiments 等。消费方应用（`selfhost-web`、`desktop`）调用 `setPlatformDef()` 注入具体实现，使得同一套前端代码支持 Web、桌面、自部署三种形态。

### 模块系统（`hoppscotch-common/src/modules/`）

`HoppModule` 是生命周期插件系统。模块可挂载到以下钩子：`onVueAppInit`、`onRouterInit`、`onRootSetup`、`onBeforeRouteChange`、`onAfterRouteChange`。主题、国际化、路由、DIoC、PWA、Toast 等均以模块方式注册。

### 状态管理（非 Pinia）

- **DispatchingStore**（`src/newstore/`）：基于 RxJS 的自定义状态管理器，类似 Redux。每个 store 有初始值、dispatch 函数，通过 `BehaviorSubject` 提供可观察流。
- **DIoC**（`src/modules/dioc.ts`）：依赖注入容器。服务继承 `Service<Events>`，注册在全局容器中。组件内通过 `useService()` 获取服务实例。

### 后端：两级数据归属

所有请求/集合/环境数据都归属到两个层级之一：
- **个人工作区**（`UserCollection`、`UserRequest`、`UserEnvironment`）
- **团队工作区**（`TeamCollection`、`TeamRequest`、`TeamEnvironments`）

两者结构完全对称，但使用独立的 Prisma 模型和 GraphQL 解析器。团队有角色划分：`OWNER`、`EDITOR`、`VIEWER`。

### 认证流程（后端）

基于 JWT + 刷新令牌。支持 Google、GitHub、Microsoft SSO（通过 `InfraConfig` 按需启用）和魔法链接邮件认证。Auth 模块使用异步 `register()` 工厂函数，根据基础设施配置选择性实例化 SSO 策略。

### GraphQL 客户端（前端）

使用 urql，配有三个核心 exchange：`authExchange`（注入认证头、刷新令牌）、`subscriptionExchange`（WebSocket 订阅）、`errorExchange`。查询使用 `fp-ts` 的 `Either<GQLError, Data>` 进行错误处理。通过 GraphQL Codegen 从 `gql-gen/` 目录下的 `.graphql` 文件生成类型化操作代码，输出到 `src/helpers/backend/graphql.ts`。

### 请求执行流水线

1. 用户在 UI 中创建请求 → 存储为 `HoppRESTRequest` / `HoppGQLRequest`（来自 `hoppscotch-data`）
2. 前置请求脚本在 `hoppscotch-js-sandbox` 中运行
3. 通过 Kernel Relay 发送请求（Web 端：fetch API，桌面端：Rust/libcurl 通过 Tauri FFI）
4. Kernel 拦截器可在传输过程中修改请求/响应
5. 后置请求/测试脚本在沙箱中运行，收集断言结果

### 编辑器组件

大多数编辑器使用 **CodeMirror 6**（JSON、XML、GraphQL、JavaScript），脚本编辑器使用 **Monaco Editor**（`MonacoScriptEditor.vue`）。`codemirror-lang-graphql` 包通过 Lezer 语法解析器提供 GraphQL 语法高亮。

## 关键环境变量

开发前将 `.env.example` 复制为 `.env`。关键变量：
- `DATABASE_URL` — PostgreSQL 连接字符串（后端使用）
- `DATA_ENCRYPTION_KEY` — 32 位密钥，用于加密数据库中的敏感字段
- `VITE_BACKEND_GQL_URL` — 前端连接后端的 GraphQL 端点（默认 `http://localhost:3170/graphql`）
- `VITE_BACKEND_API_URL` — REST API 端点（默认 `http://localhost:3170/v1`）
- `WHITELISTED_ORIGINS` — 后端 CORS 白名单

## CI

GitHub Actions 在 Node.js 22 上对 `main`、`next`、`patch` 分支执行 `pnpm install && pnpm test`。提交前钩子（husky + lint-staged）执行 `pnpm pre-commit`（lint + typecheck）。
