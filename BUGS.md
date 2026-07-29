# 已知 Bug 及修复方案

> 分支: `feat/oidc-community-support`
> 基准版本: `2026.6.1`

---

## 1. `updateMockServer` 关闭/更新 Mock 服务报错

**文件**: `packages/hoppscotch-backend/src/mock-server/mock-server.resolver.ts:173-176`

**现象**: 调用 `updateMockServer` 时报错 `property input should not exist`，导致无法关闭或修改 Mock 服务。

**根因**: 全局 `ValidationPipe` 开启了 `forbidNonWhitelisted: true`（`main.ts:80`）。`updateMockServer` 的 resolver 写法：

```typescript
@Args() args: MockServerMutationArgs,       // ← 拿到的是 {id, input}
@Args('input') input: UpdateMockServerInput, // ← 单独拿 input
```

`@Args()` 会捕获**所有**参数 `{id, input}`，而 `MockServerMutationArgs` 只声明了 `id`：

```typescript
@ArgsType()
export class MockServerMutationArgs {
  @Field(() => ID)
  @IsString()
  @IsNotEmpty()
  id: string;
  // ❌ 没有声明 input
}
```

`forbidNonWhitelisted` 看到多余的 `input` 就直接拒了。

**修复**:

```diff
 async updateMockServer(
   @GqlUser() user: AuthUser,
-  @Args() args: MockServerMutationArgs,
+  @Args('id', { type: () => ID }) id: string,
   @Args('input') input: UpdateMockServerInput,
 ): Promise<MockServer> {
-  const result = await this.mockServerService.updateMockServer(args.id, user.uid, input);
+  const result = await this.mockServerService.updateMockServer(id, user.uid, input);
```

修复后也可同步删除 `MockServerMutationArgs`（如果其他 mutation 也没用到的话）。

**临时绕过**: 直接删掉 Mock 服务重建，或通过 GraphQL 手动调 `deleteMockServer`。

---

## 2. Docker 构建 `fe_builder` 阶段 Vite 打包报错

**文件**: `prod.Dockerfile:168` / `prod-china.Dockerfile`（fe_builder 阶段）

**现象**:
```
Could not load virtual:vite-plugin-pages/generated-pages
Cannot read properties of undefined (reading 'endsWith')
```

**根因**: `vite.config.ts:21` 中 `loadEnv("development", ...)` 需要 `.env` 文件存在来加载 `VITE_BASE_URL` 等变量。官方 CI（`.github/workflows/release-push-docker.yml:25`）在 Docker 构建前执行了 `cp .env.example .env`，但 Dockerfile 内部没有这一步。`.env` 不在 git 仓库中不存在，导致 `VITE_BASE_URL` = `undefined`，`vite-plugin-pages-sitemap` 调用 `.endsWith()` 时崩溃。

**修复**（已应用到 `prod-china.Dockerfile`）:

在 `base_builder` 阶段 `COPY . .` 之后、`pnpm install` 之前加一行：

```dockerfile
RUN cp .env.example .env
```

---

## 3. `x-mock-response-name` 跨请求可能返回错误响应

**文件**: `packages/hoppscotch-backend/src/mock-server/mock-server.service.ts:850-885`

**现象**: 当 `x-mock-response-name` 指定的名称在集合内多个请求中都存在时，可能返回非预期请求的响应。

**根因**: `findExampleByIdOrName()` 在快速路径中遍历**集合里所有请求**的所有 example，未限定在当前 method+path 匹配的请求范围内：

```typescript
private findExampleByIdOrName(
  requests: Array<{ id: string; mockExamples: any }>,  // ← 所有请求
  exampleId?: string,
  exampleName?: string,
  method?: string,
) {
  for (const request of requests) {
    // 遍历所有请求的所有 example
    // ❌ 没有过滤 path，只过滤了 method
  }
}
```

**修复**: 在 `findExampleByIdOrName` 中加入 path 过滤，确保只在匹配当前请求路径的请求范围内搜索 example。或者接入 `handleMockRequest` 中先走 `fetchCandidateExamples` 过滤后再按 name/id 精确匹配。

**临时绕过**: 给 example 起名时带区分度（如 `pet-success`、`user-success`），或用 `x-mock-response-code` 代替。

---

## 4. Example ID 在 UI 中不可见

**文件**: 前端 `packages/hoppscotch-common/src/components/collections/`

**现象**: `x-mock-response-id` header 功能已在后端实现（`mock-server.service.ts:739`），但 UI 中没有展示 example ID 的地方，用户无法获取。

**影响**: `x-mock-response-id` 形同虚设，用户只能用 `x-mock-response-name` 或 `x-mock-response-code`。

**改进方向**: 在 `EditResponse` 或 `ExampleResponse` 组件中展示 example 的 key/id，或在 Mock Dashboard 的响应列表里显示可复制的 ID。

---

## 5. pnpm `fetch` 在 CentOS 7 + Docker 26.x 环境报 EPERM

**环境**: CentOS 7, kernel 5.4, Docker 26.1.4, overlay2 存储

**现象**: `pnpm fetch` 完成后报 `EPERM: operation not permitted, write`。

**根因**: Docker build 容器的 seccomp 配置拦截了 pnpm 的某个系统调用。`docker run --security-opt seccomp=unconfined` 可正常执行，但 build 容器无法传该参数。

**影响范围**: 仅特定环境（老内核 + 老 Docker），Ubuntu 22.04 / Docker Desktop 不受影响。

**临时方案**: 在非 CentOS 7 的机器上构建镜像。

---

## 6. Body 参数（urlencoded / form-data）缺少 Description 列

**Issue**: [#6547](https://github.com/hoppscotch/hoppscotch/issues/6547) | **讨论**: [Discussion #1971](https://github.com/hoppscotch/hoppscotch/discussions/1971)

**现象**: Postman 在 `application/x-www-form-urlencoded` 和 `multipart/form-data` 模式下都提供了 Description 列，方便给每个参数添加备注说明。Hoppscotch 在 v2024.8.0 已为 URL Query Parameters 增加了 Description 列，但 Body 参数（urlencoded、form-data）至今没有。

**对比**:

| 参数位置 | Postman | Hoppscotch |
|---|---|---|
| Query Parameters | ✅ Description 列 | ✅ v2024.8.0 已支持 |
| Headers | ✅ Description 列 | ✅ 一直支持 |
| Body — urlencoded | ✅ Description 列 | ❌ 缺失 |
| Body — form-data | ✅ Description 列 | ❌ 缺失 |

**官方状态**: 维护者在 Discussion #1971 中已标记"Description field on parameters are now available"并关闭讨论，但 Body 参数的缺失未被回应。已于 2026-07-29 提交独立 feature request #6547。
