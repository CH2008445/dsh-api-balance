# dsh-api-balance

显示 **DeepSeek API 账户余额与本次运行费用** 的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web GUI 插件。侧边栏底部一行同时给出余额和本次启动至今的花费。

它只为了一件事而写：**在显示花费的同时，不扩大 API Key 的暴露面**。整个插件就是四个小文件，几分钟就能读完。

[English](README.md) | 中文 | [Русский](README.ru.md) | [Deutsch](README.de.md)

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
- 按官方人民币价（含峰谷档）为**每一次模型调用**计费，数据来自 harness 的用量块
- 返回余额字段与 token／费用汇总，并在 `sidebar.footer.action` 渲染一行可点击的显示

这一行读作 `Balance ¥6.39  ·  Cost ¥0.12`：账户余额，以及本次进程启动至今的费用。两者各自带标签，含义不会混淆；而且**始终都在**——未知值保留 `--` 占位而不是消失，所以首次计费后这一行不会跳动。悬停可展开调用次数与 token 明细，点击强制刷新。

## 费用计算

费用来自 harness 为每次模型调用发出的用量块，因此反映的是**真实发出的请求**（含重试）。统计口径为**当前进程这一次运行**，并会持久化——重载插件不会丢数，重新启动则从零开始。

价格取自[官方定价页](https://api-docs.deepseek.com/quick_start/pricing)，单位人民币元 / 百万 tokens：

| 模型 | 档位 | 缓存命中 | 缓存未命中 | 输出 |
|---|---|---|---|---|
| `deepseek-flash` | 空闲 | 0.02 | 1 | 4 |
| `deepseek-flash` | 高峰 | 0.04 | 2 | 8 |
| `deepseek-v4-pro` | 空闲 | 0.15 | 4.5 | 13.5 |
| `deepseek-v4-pro` | 高峰 | 0.30 | 9.0 | 27.0 |

应用的计费规则：

- **高峰时段**为北京时间（UTC+8）周一至周五 09:00–12:00 与 14:00–18:00；其余时段（含周末）均为空闲
- **缓存写入按缓存命中价计费**，沿用官方历史规则
- **下线的模型名按其实际服务模型计费**：`deepseek-v4-flash` 与 `deepseek-v4-flash-vision-exp` 按 `deepseek-flash` 计价
- **未知模型计 0 费用**，而不是猜一个价格

有两件事无法自动推导，需要部署时提供：**中国法定节假日**（会让工作日变为空闲档）以及价格变动。两者都是配置项，见下文。

## 安全设计

| 约束 | 落实方式 |
|---|---|
| 密钥不离开宿主进程 | 只用 `ctx.credentials.resolve()` 读取；不进响应体、不进日志、不进浏览器 |
| 密钥不进命令行 | 只用进程内 `fetch`，无子进程、无 shell。发布校验会断言 |
| 不绕过沙箱 | 插件完全不读写沙箱策略。发布校验会断言 |
| 密钥只发往 DeepSeek | 端点 host 必须等于 `api.deepseek.com`，否则拒绝发送密钥。**该行为不可配置** |
| 端点不可被跨站读取 | 要求 `x-dsh-balance: 1` 自定义头（会强制 CORS 预检），并校验 `Origin` 为本机回环 |
| 失败不泄露任何信息 | 网络、解析、HTTP 错误一律返回固定文案，绝不回传底层错误 |
| 不放大请求 | 余额查询成功才缓存；失败结果永不缓存 |

端点和凭据处理属于**安全不变量，刻意不开放为配置项**。可调的只有「配置」一节列出的字段。

## 环境要求

- 带 Web 客户端的 DeepSeek Harness（`dsh-web-app` 组合包生效）
- 已配置 `DEEPSEEK_API_KEY` 凭据（设置 → 模型），或导出了同名环境变量
- 使用 `deepseek-official` 提供方路由。**余额接口仅支持官方端点**：若你的 `baseURL` 指向中转站或镜像，插件会拒绝发送密钥，而不是把它泄露出去。费用统计不受影响，因为它不需要网络。

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

重启 DSH 后，左侧边栏底部会出现该行。

> 提示：若 `pnpm install` 报告 "Already up to date" 却没有把包落盘（锁文件 importer 陈旧会导致这种情况），可用目录链接把 profile 的 `node_modules/dsh-api-balance` 指向你的工作目录——Windows 下用 `mklink /J`。

### 验证安装

在 GUI 里打开浏览器控制台运行：

```js
fetch('/api/dsh-api-balance', { headers: { 'x-dsh-balance': '1' } }).then(r => r.json()).then(console.log)
```

返回带 `usage.total.cost` 的对象说明宿主侧已工作。返回 `404` 说明 Loader 行未激活；返回 `403` 说明请求缺少必需的头或来自其他来源。

## 配置

可选，写在 profile 的 `cordis.yml` / `cordis.patch.yml`：

```yaml
- id: api-balance
  name: dsh-api-balance
  config:
    cacheMs: 60000
    path: /api/dsh-api-balance
    persistUsage: true
    holidays:
      - '2026-10-01'
      - '2026-10-02'
    prices:
      deepseek-flash:
        cacheHit: 0.02
        cacheMiss: 1
        output: 4
        peak:
          cacheHit: 0.04
          cacheMiss: 2
          output: 8
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `cacheMs` | `60000` | 余额结果缓存时长（毫秒，0 – 3600000） |
| `path` | `/api/dsh-api-balance` | 提供数据的精确 HTTP 路由 |
| `persistUsage` | `true` | 持久化用量汇总，使插件重载后不丢本次费用 |
| `holidays` | `[]` | 按空闲档计费的北京日期（`YYYY-MM-DD`） |
| `prices` | 内置价表 | 覆盖或扩展价格表，单位人民币元 / 百万 tokens |

用量数据存放在 `$DSH_HOME/storages/api-balance/usage.json`。

## 开发

没有构建步骤：`lib/` 下的文件就是交付产物。`lib/client.js` 是手写的 DSH `window.__ModuleLoader__` 格式 bundle，`lib/types/index.d.ts` 提供公开类型。

```sh
node scripts/verify.mjs           # 离线校验,不需要凭据
BALANCE_TEST_KEY=sk-... node scripts/verify.mjs --live   # 额外做一次真实查询
```

`scripts/verify.mjs` 会断言清单契约、Loader patch、宿主导出面、上述安全不变量、计价与峰谷时段、账本持久化、路由拒绝行为、用量采集，以及客户端 bundle 契约。它不需要安装 DSH；除 `--live` 外也不需要网络。

**客户端 bundle id 规则。** 传给 `window.__ModuleLoader__.load` 的模块 id **必须等于包名**。id 不一致会让浏览器模块系统拒绝该 factory，并以 `duplicate factory registration` 使整条 web boot entry 失败，进而导致应用无法启动。`scripts/verify.mjs` 对此有专门断言——请保留它。

## 回滚

从 profile 的 `package.json` 的 `dsh.profile.bundles` 中删除 `"dsh-api-balance"` 并重启。若应用无法启动，DSH 的错误对话框提供 **禁用第三方插件并重启**，会替你完成这次恢复。

## 已知限制

- 余额接口仅支持官方端点；网关与镜像的 `baseURL` 会被按设计拒绝
- 费用只覆盖当前这次进程运行，不含更早历史
- 中国法定节假日只有写进 `holidays` 才按空闲档计费；官方日历无法提前得知
- 价格内置，DeepSeek 调价后需要更新
- 只显示 `balance_infos` 的第一项
- 侧边栏折叠时显示精简标签

## 许可证

[Apache-2.0](LICENSE)
