# snowagent — 设计说明

> 参考 [okx/onchainos-skills](https://github.com/okx/onchainos-skills) 的 okx.ai
> user 端逻辑，重新实现的一套**用户侧** Agent 任务工具链：登录钱包 → 创建任务 →
> 收发消息 → 验收任务结果。
>
> 与官方实现的**完全独立**：新的工程名、新的二进制名、新的进程名、新的数据
> 目录、新的环境变量前缀，不与 `onchainos` / `okx-a2a` 共用任何状态。

## 命名（独立性）

| 项目 | 本工程 | 官方对照 |
|---|---|---|
| 工程/仓库名 | `snowagent`（可改，见下） | `onchainos-skills` |
| CLI 二进制 | `snowagent` | `onchainos` |
| A2A 守护进程 | `snowagent-a2a` | `okx-a2a` |
| 数据目录 | `~/.snowagent/` | `~/.onchainos/` / `~/.okx-agent-task` |
| 环境变量前缀 | `SNOWAGENT_` | `XMTP_` / `OKX_AGENT_` |
| 日志前缀 | `[snowagent]` | `[doctor]` / `[onchainos:...]` |

> 仓库名目前用 `snowagent` 占位，push 到 GitHub 前由用户最终确认，
> 改名只涉及 `package.json` 的 `name`、`install.sh` 和 README。

## 工程结构

```
snowagent/
├── DESIGN.md                    # 本文件
├── README.md                    # 使用文档
├── package.json                 # npm workspaces，一键安装入口
├── install.sh                   # 一键安装：node 检查 → 依赖 → 构建 → 链接二进制 → 装 skill
├── skills/
│   └── user-agent/              # ★ 第一部分：skills 提示词（仅 user 端）
│       ├── SKILL.md
│       └── references/
│           ├── login.md         # 钱包登录流程
│           ├── create-task.md   # 创建任务流程
│           ├── watch.md         # 任务进度监听（destructive read）
│           ├── review-accept.md # 验收任务结果
│           └── troubleshooting.md
├── packages/
│   ├── cli/                     # ★ 第二部分：最小 CLI（登录、签名、任务）
│   │   ├── package.json         # bin: snowagent
│   │   └── src/
│   │       ├── index.ts         # 命令入口（commander）
│   │       └── lib/
│   │           ├── home.ts      # ~/.snowagent 路径
│   │           ├── session.ts   # JWT 会话存取
│   │           ├── priapi.ts    # priapi HTTP 客户端（最小端点集）
│   │           ├── login.ts     # social login device flow
│   │           ├── sign.ts      # TEE 签名
│   │           └── xmtp-key.ts  # XMTP 身份密钥生成/存储
│   └── a2a/                     # ★ 第三部分：基于 XMTP 的 a2a 通信节点
│       ├── package.json         # bin: snowagent-a2a；依赖 @xmtp/node-sdk
│       └── src/
│           ├── index.ts         # 命令入口：daemon / xmtp-send / user / doctor
│           ├── daemon.ts        # 常驻 XMTP client，收件箱事件落盘
│           ├── store.ts         # 本地事件存储（destructive-read 语义）
│           └── xmtp.ts          # XMTP client 启动（签名授权）
└── scripts/
    └── smoke.sh                 # 冒烟测试
```

## 调用契约（从参考实现抽取）

### 登录（social login device flow）

1. 本地生成 `authSessionId`（uuid）+ x25519 临时密钥对；`tempPubKey` =
   base64(**裸 32 字节公钥**，不是 SPKI DER——传 DER 会报 `tempPk must be 32 bytes`)。
2. 拼登录 URL：`<base>/account/sociallogin?authSessionId=..&tempPubKey=..&clientType=agent-cli`，
   打印给用户在浏览器完成登录。
3. 轮询 `POST /priapi/v5/wallet/agentic/auth/session/result`（body
   `{"authSessionId"}`，2s 间隔，5min 超时；后端 code `10018` = 未完成；
   返回 `data` 是数组，取 `data[0]` 即 VerifyResponse）。
4. 用 x25519 私钥 HPKE 解密 `encryptedSessionSk`
  （suite = DHKEM(X25519,HKDF-SHA256)+HKDF-SHA256+AES-256-GCM，
   info = `okx-tee-sign`，wire = enc(32B)||ciphertext；已用参考实现的
   known-vector 验证）得到 Ed25519 会话签名种子。
5. 存 `~/.snowagent/session.json`（accessToken/refreshToken/sessionCert/
   sessionSeedB64/saTeeId，600 权限）+ `~/.snowagent/wallets.json`
  （accounts + address_list，`wallet addresses` 从本地读并按链分组）。

### 签名（TEE 托管钱包）

- 私钥不出 TEE。签名走后端：`POST /priapi/v5/wallet/agentic/pre-transaction/sign-msg`，
  body 形如 `{chainIndex, from, sessionCert,
  payload:[{signType:"personalSign", message:{value}, sessionSignature}]}`，
  其中 `sessionSignature = base64(Ed25519_sign(seed,
  keccak256("\x19Ethereum Signed Message:\n"+len+message)))`。
- `snowagent wallet sign --message <text>` → personalSign，返回签名 hex。
- `message.value` 编码：EVM 直接原文，Solana（chain 501）用 base58。

### 创建任务（one-time）

1. `POST /priapi/v1/aieco/task/createAndFundConfirmStatus`
   `{providerAgentId, tokenSymbol, amount, chainId, serviceId}`
   → 返回 `jobId`、`taskSalt`、`uopData{receiver, evaluator, currency, recipient, amount, submitWindow, disputeWindow, evaluateWindow, completedWindow, hook, hookData, salt, expiredAt}`。
2. 用钱包对托管参数签名（sign-msg）。
3. `POST /priapi/v1/aieco/task/createAndFund`
   `{visibility, jobId, taskSalt, signature, validAfter, validBefore, title, description, paymentTokenSymbol, paymentTokenAmount, chainId, providerAgentId, serviceId, serviceParams, serviceTokenAddress, serviceTokenAmount}`。
4. 返回 `jobId` 即创建成功 → 进入 watch。

### XMTP 身份（“通过签名启动本地 XMTP client”）

1. `snowagent xmtp init`：本地生成 secp256k1 身份密钥 → 存
   `~/.snowagent/xmtp/identity.key`（600 权限）。
2. 用钱包对授权声明签名：
   `SnowAgent XMTP identity authorization\naddress: <xmtp地址>\nnonce: <随机>`，
   签名存 `~/.snowagent/xmtp/authorization.json`（绑定用户 EVM 地址 ↔ XMTP 身份）。
3. `snowagent-a2a daemon start`：读取身份密钥 → `Client.create(signer)`（@xmtp/node-sdk，
   env=production）→ 常驻监听，回执写入 `~/.snowagent/a2a/inbox.jsonl`。

> 说明：agentic 钱包私钥在 TEE 内不可导出，因此 XMTP 身份是独立的本地密钥，
> 通过钱包签名做**授权绑定**——这与官方 `okx-a2a` 用 `XMTP_WALLET_KEY`
> 环境变量承载独立密钥的设计是一致的。

### 守护进程 CLI 契约（供 skills 调用，稳定）

| 命令 | 作用 |
|---|---|
| `snowagent-a2a daemon start\|stop\|status` | 守护进程生命周期 |
| `snowagent-a2a xmtp-send --to <addr> --text <msg>` | 发送 XMTP 消息 |
| `snowagent-a2a user watch --json [--job-id <id>]` | 长轮询：先吐未读积压（destructive read），再等新事件 |
| `snowagent-a2a user outdated-list --json` | 未处理事项快照（不长轮询） |
| `snowagent-a2a user check --todo-ids <ids> --json` | 标记事项已处理 |
| `snowagent-a2a doctor --json` | 就绪检查 |

`user watch` 返回的 item 信封与官方对齐：
`{kind: "notification"|"decision_request", jobId, userContent, llmContent?, id?}`，
其中 `notification` 来自 XMTP 收件箱，`decision_request` 来自 priapi 任务事件。

## 一键安装

```bash
curl -fsSL https://raw.githubusercontent.com/<user>/snowagent/main/install.sh | bash
# 或克隆后：
./install.sh
```

安装内容：Node ≥ 22 检查 → `npm ci` → `tsc` 构建 → 链接 `snowagent` /
`snowagent-a2a` 到 `~/.local/bin` → 拷贝 skills 到 `~/.snowagent/skills/` →
`doctor` 自检。

## 非目标

- 不实现 ASP（服务方）端逻辑、不实现订阅/跟单、不实现 A2MCP。
- 不复用 `~/.onchainos`、`~/.okx-agent-task` 的任何状态；`upgrade` 等官方
  命令不受影响。
- priapi 字段级细节以参考实现为准，联调时以真实返回为准微调
  （见 `packages/cli/src/lib/priapi.ts` 注释）。
