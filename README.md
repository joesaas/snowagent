# snowagent

用户侧 OKX.AI Agent 任务工具链：**登录钱包 → 创建任务 → XMTP 收发消息 → 验收任务结果**。

参考 [okx/onchainos-skills](https://github.com/okx/onchainos-skills) 的 okx.ai
user 端逻辑重新实现，与官方实现**完全独立**：新的工程名、二进制名、进程名、
数据目录（`~/.snowagent/`）、环境变量前缀（`SNOWAGENT_`），不与
`onchainos` / `okx-a2a` 共用任何状态。

## 三部分

| 部分 | 目录 | 说明 |
|---|---|---|
| skills 提示词（仅 user 端） | `skills/user-agent/` | `SKILL.md` + 登录/建单/监听/验收/排障 references |
| 最小 CLI | `packages/cli/` | 二进制 `snowagent`：登录、签名、任务操作、XMTP 身份 |
| a2a 通信节点 | `packages/a2a/` | 二进制 `snowagent-a2a`：XMTP daemon、收发消息、watch |

## 一键安装

```bash
./install.sh
```

或远程一键：

```bash
curl -fsSL https://raw.githubusercontent.com/<user>/snowagent/main/install.sh | bash
```

安装内容：Node ≥ 22 检查 → `npm install` → `tsc` 构建 →
链接 `snowagent` / `snowagent-a2a` 到 `~/.local/bin` →
拷贝 skill 到 `~/.snowagent/skills/` → `doctor` 自检。

## 快速上手

```bash
snowagent wallet login        # 浏览器完成社交登录
snowagent xmtp init           # 生成 XMTP 身份密钥 + 钱包签名授权
snowagent-a2a daemon start    # 启动 XMTP 常驻进程

snowagent agent create-task --title "…" --description "…" \
  --provider-agent-id <id> --service-id <id> \
  --token-symbol USDT --token-amount 0.2 --json

snowagent-a2a user watch --json --job-id <jobId>   # 长轮询收消息（破坏性读）
snowagent agent accept --job-id <jobId> --json      # 验收任务结果
```

## 设计

见 [DESIGN.md](DESIGN.md)：命名独立性、工程结构、priapi 端点契约、
XMTP 身份的签名授权机制、daemon CLI 契约。

## 注意事项

- priapi 字段级细节从参考实现抽取，联调时以真实返回为准微调
  （见 `packages/cli/src/lib/priapi.ts` 注释）。
- `snowagent wallet sign` 的私钥不出 TEE，签名由后端完成。
- XMTP 身份是独立本地密钥（agentic 钱包密钥不可导出），通过钱包签名做授权绑定。
