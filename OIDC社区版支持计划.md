# 为 Hoppscotch 社区版添加 OIDC 支持 — 实施记录

## 状态：✅ 已完成

所有改动共 19 个文件（含 2 个新建文件），已通过全部 738 个后端测试。

---

## 实施概览

### 阶段 1：后端核心（10 个文件）

| # | 文件 | 操作 | 说明 |
|---|------|------|------|
| 1 | `packages/hoppscotch-backend/package.json` | 修改 | 添加 `passport-openidconnect@0.1.2` 及类型定义依赖 |
| 2 | `packages/hoppscotch-backend/src/types/InfraConfig.ts` | 修改 | `InfraConfigEnum` 添加 9 个 OIDC 配置键 |
| 3 | `packages/hoppscotch-backend/src/auth/helper.ts` | 修改 | `AuthProvider` 枚举添加 `OIDC = 'OIDC'` |
| 4 | `packages/hoppscotch-backend/src/auth/strategies/oidc.strategy.ts` | **新建** | OIDC Passport 策略（基于 `passport-openidconnect`） |
| 5 | `packages/hoppscotch-backend/src/auth/guards/oidc-sso.guard.ts` | **新建** | OIDC SSO 守卫 |
| 6 | `packages/hoppscotch-backend/src/infra-config/helper.ts` | 修改 | `getAuthProviderRequiredKeys` / `getDefaultInfraConfigs` / `buildDerivedEnv` 添加 OIDC |
| 7 | `packages/hoppscotch-backend/src/infra-config/infra-config.service.ts` | 修改 | `isServiceConfigured` / `validateEnvValues` / `validateOnboardingConfig` 添加 OIDC |
| 8 | `packages/hoppscotch-backend/src/infra-config/dto/onboarding.dto.ts` | 修改 | `SaveOnboardingConfigRequest` / `GetOnboardingConfigResponse` 添加 OIDC 字段 |
| 9 | `packages/hoppscotch-backend/src/auth/auth.controller.ts` | 修改 | 添加 `GET /auth/oidc` 和 `/auth/oidc/callback` 路由 |
| 10 | `packages/hoppscotch-backend/src/auth/auth.service.ts` | 修改 | `getAuthProviders()` 将 OIDC 转换为 `OIDC:<name>` 格式 |
| 11 | `packages/hoppscotch-backend/src/auth/auth.module.ts` | 修改 | 在 `register()` 工厂函数中条件注册 `OidcStrategy` |

### 阶段 2：GraphQL Schema

| # | 说明 |
|---|------|
| 12 | 运行 `pnpm gen-gql` 重新生成 GraphQL schema（含 `InfraConfigEnum.Oidc*` 和 `AuthProvider.Oidc`） |

### 阶段 3：管理后台（6 个文件）

| # | 文件 | 操作 | 说明 |
|---|------|------|------|
| 13 | `packages/hoppscotch-sh-admin/src/helpers/configs.ts` | 修改 | `SsoAuthProviders` 添加 `'oidc'`，新增 `OIDC_CONFIGS`，更新 `PROVIDER_CONFIGS` / `ALL_CONFIGS`，`ServerConfigs.providers` 添加 oidc 结构（含 `provider_name` 等 9 个字段） |
| 14 | `packages/hoppscotch-sh-admin/src/composables/useConfigHandler.ts` | 修改 | 添加 oidc provider 的初始化/转换/启用禁用逻辑 |
| 15 | `packages/hoppscotch-sh-admin/src/composables/useOnboardingConfigHandler.ts` | 修改 | `OAuthProvider` 类型添加 `'OIDC'`，初始化/回调URL/切换逻辑添加 OIDC |
| 16 | `packages/hoppscotch-sh-admin/src/components/settings/OAuthProviderConfigurations.vue` | 修改 | 添加 OIDC 特有字段（issuer/authorization_url/token_url/user_info_url/provider_name），更新 `maskState` |
| 17 | `packages/hoppscotch-sh-admin/src/helpers/auth.ts` | 修改 | 添加 `signInUserWithOidc()` 函数 |
| 18 | `packages/hoppscotch-sh-admin/src/components/app/Login.vue` | 修改 | 添加 OIDC 动态登录按钮（解析 `OIDC:name` 格式显示名称）及 `signInWithOidc` 处理函数 |
| 19 | `packages/hoppscotch-sh-admin/locales/en.json` | 修改 | 添加 OIDC 相关翻译键 |

### 阶段 4：自部署前端（1 个文件）

| # | 文件 | 操作 | 说明 |
|---|------|------|------|
| 20 | `packages/hoppscotch-selfhost-web/src/platform/auth/web/index.ts` | 修改 | 在 `def` 中添加 `additionalLoginItems`，包含 OIDC 登录项，导入 `IconOpenId` |

### 阶段 5：资源 & 文档

| # | 文件 | 操作 | 说明 |
|---|------|------|------|
| 21 | `packages/hoppscotch-common/assets/icons/auth/openid.svg` | **新建** | OpenID 图标（Common 包） |
| 22 | `packages/hoppscotch-sh-admin/assets/icons/auth/openid.svg` | **新建** | OpenID 图标（Admin 包） |
| 23 | `.env.example` | 修改 | 添加 OIDC 环境变量文档 |

---

## 关键设计决策

1. **单个 OIDC Provider**：当前实现只支持一个 OIDC 提供商
2. **Provider Name 来自配置**：`OIDC_PROVIDER_NAME` 决定显示名称，不填默认 `'openid'`，管理员可配置任意名称（如 "Keycloak"、"Okta" 等）
3. **Scope 逗号分隔**：与其他 provider 一致，存储和读回均为逗号分隔字符串
4. **`passReqToCallback: true`**：支持 `StatelessStateStore` 的 Cookie 操作
5. **`skipUserProfile: false`**：强制从 UserInfo 端点获取完整用户资料
6. **环境变量命名**：使用 `OIDC_AUTH_URL`（与 Helm Chart 一致）

### NestJS 与 passport-openidconnect 的兼容性

NestJS 的 `PassportStrategy` 包装了 `validate()` 方法，将其封装为 `async (...params) => {}`（rest 参数形式），导致 `Function.length` 为 0。`passport-openidconnect` 库依据 `verify.length` 来判断回调函数的参数数量，从而决定是否获取 UserInfo 资料。

因此，`validate()` 的实际调用签名为（与 Google/GitHub/Microsoft 策略不同）：

```
validate(req, issuer, profile, verified)
```

而非通常的 `(req, accessToken, refreshToken, profile, done)`。代码中已添加详细注释说明此行为。

同时，由于 `profile.provider` 并非 `passport-openidconnect` 自动设置，需要在策略中手动补充 `profile.provider = 'oidc'`。

---

## InfraConfigEnum 新增键

| InfraConfigEnum | 环境变量 | 加密 | 说明 |
|---|---|---|---|
| `OIDC_PROVIDER_NAME` | `OIDC_PROVIDER_NAME` | 否 | OIDC 显示名称，如 "Keycloak" |
| `OIDC_ISSUER` | `OIDC_ISSUER` | 否 | OIDC Issuer URL |
| `OIDC_AUTH_URL` | `OIDC_AUTH_URL` | 否 | Authorization URL |
| `OIDC_TOKEN_URL` | `OIDC_TOKEN_URL` | 否 | Token URL |
| `OIDC_USER_INFO_URL` | `OIDC_USER_INFO_URL` | 否 | UserInfo URL |
| `OIDC_CLIENT_ID` | `OIDC_CLIENT_ID` | 是 | Client ID |
| `OIDC_CLIENT_SECRET` | `OIDC_CLIENT_SECRET` | 是 | Client Secret |
| `OIDC_CALLBACK_URL` | `OIDC_CALLBACK_URL` | 否 | 回调 URL |
| `OIDC_SCOPE` | `OIDC_SCOPE` | 否 | 逗号分隔的 scope 列表 |

---

## OIDC 名称显示机制

1. 管理员在后台配置 OIDC 时填写 **Provider Name**（如 "Keycloak"）
2. 后端存储为 `INFRA.OIDC_PROVIDER_NAME`
3. `/auth/providers` 端点返回 `["OIDC:keycloak", ...]`（`OIDC:` 前缀 + 管理员配置的名称）
4. Admin 登录页（`Login.vue`）检测到 `OIDC:` 前缀，取冒号后名称，动态渲染 "Continue with Keycloak"
5. Selfhost-web 主应用通过 `additionalLoginItems` 提供 OIDC 登录入口，使用 `auth.continue_with_auth_provider` 翻译键

---

## Helm 部署方案

Helm Chart（`hoppscotch/helm-charts`）已完整支持 OIDC 部署，无需修改 Chart 代码。

### Chart 中的 OIDC 配置

```yaml
hoppscotch:
  backend:
    auth:
      allowedProviders:
        - email
        - oidc          # 添加 oidc 到允许列表

      oidc:
        providerName: "Keycloak"         # 登录页显示名称
        issuer: "https://keycloak.example.com/realms/myrealm"
        authorizationUrl: "https://keycloak.example.com/realms/myrealm/protocol/openid-connect/auth"
        tokenUrl: "https://keycloak.example.com/realms/myrealm/protocol/openid-connect/token"
        userInfoUrl: "https://keycloak.example.com/realms/myrealm/protocol/openid-connect/userinfo"
        clientId: "hoppscotch"
        clientSecret: "your-client-secret"
        # callbackUrl 若留空则自动生成为: {backendBaseUrl}/v1/auth/oidc/callback
        callbackUrl: ""
        scope:
          - openid
          - profile
          - email
```

### Helm 值 → 环境变量映射

| Helm Value | 环境变量 | 存储位置 | 说明 |
|---|---|---|---|
| `auth.oidc.providerName` | `OIDC_PROVIDER_NAME` | ConfigMap | 显示名称 |
| `auth.oidc.issuer` | `OIDC_ISSUER` | ConfigMap | Issuer URL |
| `auth.oidc.authorizationUrl` | `OIDC_AUTH_URL` | ConfigMap | Authorization URL |
| `auth.oidc.tokenUrl` | `OIDC_TOKEN_URL` | ConfigMap | Token URL |
| `auth.oidc.userInfoUrl` | `OIDC_USER_INFO_URL` | ConfigMap | UserInfo URL |
| `auth.oidc.clientId` | `OIDC_CLIENT_ID` | Secret（base64） | Client ID |
| `auth.oidc.clientSecret` | `OIDC_CLIENT_SECRET` | Secret（base64） | Client Secret |
| `auth.oidc.callbackUrl` | `OIDC_CALLBACK_URL` | ConfigMap | 回调 URL（可自动生成） |
| `auth.oidc.scope` | `OIDC_SCOPE` | ConfigMap | 逗号拼接 scope 列表 |
| `auth.allowedProviders` | `VITE_ALLOWED_AUTH_PROVIDERS` | ConfigMap | 允许的 provider 列表（逗号分隔大写） |

### 已有 Chart 模板支持

Chart 中以下模板已预置 OIDC 配置映射：

- **`templates/config/configmap.yaml`**：已映射 `OIDC_PROVIDER_NAME`、`OIDC_ISSUER`、`OIDC_AUTH_URL`、`OIDC_TOKEN_URL`、`OIDC_USER_INFO_URL`、`OIDC_SCOPE`、`OIDC_CALLBACK_URL`
- **`templates/config/secret.yaml`**：已映射 `OIDC_CLIENT_ID`、`OIDC_CLIENT_SECRET`（base64 编码存储）
- **`templates/_backend.tpl`**：已有 `oidcCallbackUrl` 自动生成模板（`{backendBaseUrl}/v1/auth/oidc/callback`）

### 部署流程

1. 在 `values.yaml` 中配置 `hoppscotch.backend.auth.oidc.*` 各项参数
2. 将 `oidc` 添加到 `hoppscotch.backend.auth.allowedProviders` 列表中
3. 在 OIDC Provider（如 Keycloak）中创建客户端，设置：
   - **有效的重定向 URI**：`https://<your-domain>/v1/auth/oidc/callback`
   - **Web Origins**：`https://<your-domain>`
4. `helm install` 或 `helm upgrade` 时，Chart 自动：
   - 将非敏感值写入 ConfigMap → 注入为容器环境变量
   - 将敏感值（clientId、clientSecret）base64 编码写入 Secret → 注入为容器环境变量
   - 自动生成 callback URL（若未显式设置）
5. 后端启动时从环境变量加载 OIDC 配置，`VITE_ALLOWED_AUTH_PROVIDERS` 包含 `OIDC` 时启用
6. 登录页自动显示 "Continue with <ProviderName>"

### 完整部署示例 (values.yaml)

```yaml
hoppscotch:
  backend:
    auth:
      allowedProviders:
        - email
        - oidc

      oidc:
        providerName: "Keycloak"
        issuer: "https://keycloak.example.com/realms/myrealm"
        authorizationUrl: "https://keycloak.example.com/realms/myrealm/protocol/openid-connect/auth"
        tokenUrl: "https://keycloak.example.com/realms/myrealm/protocol/openid-connect/token"
        userInfoUrl: "https://keycloak.example.com/realms/myrealm/protocol/openid-connect/userinfo"
        clientId: "hoppscotch"
        clientSecret: "your-client-secret"
        callbackUrl: ""  # 留空自动生成
        scope:
          - openid
          - profile
          - email
```

---

## 验证清单

部署后验证：
1. 后端 `/v1/auth/providers` 返回 `["OIDC:Keycloak", ...]`（冒号分隔格式）
2. Admin 登录页面出现 OIDC 登录按钮（显示配置的 Provider Name）
3. 主应用登录页出现 "Continue with Keycloak"
4. 通过 OIDC 登录成功后，用户自动创建并可正常使用
5. 后端测试通过：`pnpm --filter hoppscotch-backend test`（738 tests）
