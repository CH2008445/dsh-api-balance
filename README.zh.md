# dsh-api-balance

只读显示 **DeepSeek API 账户余额** 的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web GUI 插件。余额显示在侧边栏底部，并自动刷新。

它只为了一件事而写：**在显示余额的同时，不扩大 API Key 的暴露面**。整个插件就是两个小文件，几分钟就能读完。

[English](README.md) | 中文

## 为什么需要它

DSH 插件与你的 API Key 运行在**同一个进程**里，插件与凭据存储之间没有权限边界，因此任何插件都能拿到明文密钥。至于一个余额插件拿到密钥之后还会做什么，完全取决于它的代码——而没有任何机制能替你验证这一点。

已有的部分余额插件为了拿到那个数字，承担了本可避免的风险：

| 有风险的做法 | 问题所在 |
|---|---|
| 把密钥拼进 shell 命令 | 密钥进入子进程 argv，同机任何进程都能通过进程列表读到 |
| 起 `curl` 子进程并关掉沙箱让它跑 | 一个只读的 HTTP GET 完全不需要 `danger-full-access` |
| 把密钥发往配置里的任意 `baseURL` | 一次笔误或一个恶意镜像就能把密钥带走 |
| 本地 HTTP 端点不做来源校验 | 本机任何进程或网页都能读取你的账户数据 |

本插件不做以上任何一件事，并且发布校验会断言这些做法不会重新混进来。

## 它做什么

- 在宿主侧通过 DSH 凭据存储解析 `DEEPSEEK_API_KEY`
- 用进程内 `fetch` 请求 `GET https://api.deepseek.com/user/balance`
- 只向界面返回四个字段：`currency`、`total_balance`、`granted_balance`、`topped_up_balance`
- 在 `sidebar.footer.action` 渲染一行可点击的余额

## 安全设计

| 约束 | 落实方式 |
|---|---|
| 密钥不离开宿主进程 | 只用 `ctx.credentials.resolve()` 读取；不进响应体、不进日志、不进浏览器 |
| 密钥不进命令行 | 只用进程内 `fetch`，无子进程、无 shell。发布校验会断言 |
| 不绕过沙箱 | 插件完全不触碰沙箱策略。发布校验会断言 |
| 密钥只发往 DeepSeek | 端点 host 必须等于 `api.deepseek.com`，否则拒绝发送密钥。**该行为不可配置** |
| 端点不可被跨站读取 | 要求 `x-dsh-balance: 1` 自定义头（会强制 CORS 预检），并校验 `Origin` 为本机回环 |
| 失败不泄露任何信息 | 网络、解析、HTTP 错误一律返回固定文案，绝不回传底层错误 |
| 不放大请求 | 成功的结果缓存 60 秒；失败结果永不缓存 |

端点和凭据处理属于**安全不变量，刻意不开放为配置项**。可调的只有 `cacheMs` 和 `path`。

## 环境要求

- 带 Web 客户端的 DeepSeek Harness（`dsh-web-app` 组合包生效）
- 已配置 `DEEPSEEK_API_KEY` 凭据（设置 → 模型），或导出了同名环境变量
- 使用 `deepseek-official` 提供方路由。**余额接口仅支持官方端点**：若你的 `baseURL` 指向中转站或镜像，插件会拒绝发送密钥，而不是把它泄露出去。

## 安装

### 从本地目录安装

```sh
dsh plugin --profile desktop add /path/to/dsh-api-balance
```

本包声明了 `dsh.bundle`，因此 DSH CLI 会把包链接进 profile，并追加到 `dsh.profile.bundles`。

安装到 profile **不需要授权安装期执行代码**：本包交付预构建的 `lib/`，且没有 `prepare` 脚本，所以 pnpm 不会要求 `allowBuilds` 授权。

### 手动安装

在 `$DSH_HOME/profiles/<profile>/package.json` 中加入依赖与组合包行，然后在该 profile 目录内执行 `pnpm install`：

```json
{
  "dependencies": { "dsh-api-balance": "file:/path/to/dsh-api-balance" },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-api-balance"
      ]
    }
  }
}
```

重启 DSH 后，左侧边栏底部会出现余额行。

> 提示：若 `pnpm install` 报告 "Already up to date" 却没有把包落盘（锁文件 importer 陈旧会导致这种情况），可用目录链接把 profile 的 `node_modules/dsh-api-balance` 指向你的工作目录——Windows 下用 `mklink /J`——这样 profile 始终读取你的工作副本。

### 验证安装

在 GUI 里打开浏览器控制台运行：

```js
fetch('/api/dsh-api-balance', { headers: { 'x-dsh-balance': '1' } }).then(r => r.json()).then(console.log)
```

返回 `{ ok: true, currency: "CNY", totalBalance: "...", ... }` 说明宿主侧已工作。
返回 `404` 说明 Loader 行未激活；返回 `403` 说明请求缺少必需的头或来自其他来源。

## 配置

可选，写在 profile 的 `cordis.yml` / `cordis.patch.yml`：

```yaml
- id: api-balance
  name: dsh-api-balance
  config:
    cacheMs: 60000
    path: /api/dsh-api-balance
```

| 字段 | 默认值 | 取值范围 | 含义 |
|---|---|---|---|
| `cacheMs` | `60000` | 0 – 3600000 | 余额结果缓存时长（毫秒） |
| `path` | `/api/dsh-api-balance` | — | 提供余额 JSON 的精确 HTTP 路由 |

## 开发

没有构建步骤：`lib/index.js` 与 `lib/client.js` 就是交付产物。`lib/client.js` 是手写的 DSH `window.__ModuleLoader__` 格式 bundle，`lib/types/index.d.ts` 提供公开类型。

```sh
node scripts/verify.mjs           # 离线校验,不需要凭据
BALANCE_TEST_KEY=sk-... node scripts/verify.mjs --live   # 额外做一次真实查询
```

`scripts/verify.mjs` 会断言清单契约、Loader patch、宿主导出面、上述安全不变量、路由的拒绝行为，以及客户端 bundle 契约。它不需要安装 DSH；除 `--live` 外也不需要网络。

**客户端 bundle id 规则。** 传给 `window.__ModuleLoader__.load` 的模块 id **必须等于包名**。id 不一致会让浏览器模块系统拒绝该 factory，并以 `duplicate factory registration` 使整条 web boot entry 失败，进而导致应用无法启动。`scripts/verify.mjs` 对此有专门断言——请保留它。

## 回滚

从 profile 的 `package.json` 的 `dsh.profile.bundles` 中删除 `"dsh-api-balance"` 并重启。若应用无法启动，DSH 的错误对话框提供 **禁用第三方插件并重启**，会替你完成这次恢复。

## 已知限制

- 仅支持官方端点；网关与镜像的 `baseURL` 会被按设计拒绝
- 只显示 `balance_infos` 的第一项
- 侧边栏折叠时只显示金额、不显示标签
- 结果按 `cacheMs` 缓存；点击余额行可强制刷新

## 许可证

[Apache-2.0](LICENSE)
