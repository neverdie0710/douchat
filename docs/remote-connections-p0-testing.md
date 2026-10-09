# P0 验收测试方案：按成员绑定工作区

对应 `remote-connections.md` 第 4 节和第 10 节的 P0。P0 只改桌面端，不依赖 douchat-tanstack，也不涉及守护进程。

## 1. 自动化测试

```sh
npm run typecheck
npx vitest run src
```

和 P0 相关的测试文件：

| 文件 | 覆盖内容 |
| --- | --- |
| `src/shared/conversationWorkspace.test.ts` | 只在保存时的目标和版本一致时才使用目录；旧 `workspacePath` 只回退给本机成员；共享房间里只能设置自己的 agent |
| `src/main/remoteScript.test.ts` | 在 sh/bash/zsh/dash/ksh 里真实执行：在自选目录原地运行；目录被换成符号链接或被删除时拒绝启动；含 `$(...)`、引号、反引号的目录名只当数据；目录浏览只列一层、跳过隐藏目录和符号链接 |
| `src/main/remoteWorkspace.test.ts` | 拒绝 `/`、系统目录、`$HOME`、`~/.ssh`、`~/.douchat-remote`、`~/.douchat-host` 及其祖先；以服务器返回的真实路径为准并再校验一次；与 `pwd -P` 解析后的 HOME 比较（`/home` 链接到 `/var/home` 时仍可选项目、仍拒绝 `~/.ssh`）；macOS 服务器忽略大小写（`~/.SSH` 同样拒绝）；界面只传"父路径 + 子目录名"；终端命令里的路径只出现在 base64 载荷中 |
| `src/main/localWorkspaces.test.ts` | 本机 agent 的 fingerprint 与旧公式逐字节一致；远程 agent 换目录、换服务器、改服务器配置都会开新 thread；修改过服务器的 agent 使用新的托管目录，未修改的沿用升级前的托管目录 |
| `src/main/localAgents.test.ts` | 默认端口归一化；修改 host/port/user/key 时目标版本加一，改回原值也继续加 |
| `src/main/runtimeWorkspace.test.ts` | 各成员拿到各自目标上的目录；远程成员拿不到本机目录；版本失效后按未设置处理并在提示词中说明；共享房间任务用主人设置的目录；同一服务器同一目录串行、不同目标并行；成员移出或删除时清掉对应条目 |
| `src/main/localAgentRemoteWorkspace.test.ts` | 发给服务器的脚本里，目录只在目标一致时出现；本机路径永远不会发到服务器；prewarm 和正式执行用同一目录 |
| `ConversationWorkspaceSetting.test.tsx` | 远程成员不显示本机文件夹选择器；浏览服务器时只回传"父路径 + 子目录名"；失效和未使用的旧目录有提示 |

注意：完整跑 `vitest run src` 时，`tieredMemory.test.ts` 和 `diagnostics.test.ts` 偶尔会超时。未改动的 `dev` 分支上同样会出现，单独运行能通过，与本次改动无关。

## 2. 手动验收

准备：
- 一台能免密 SSH 登录的服务器，装有 `codex` 或 `claude`，并已登录。
- 在服务器上建好 `~/proj-a`、`~/proj-b` 两个目录，各放一个可区分的文件，例如 `echo A > ~/proj-a/marker.txt`。
- 运行 `npm run dev`；如果要验证旧数据兼容，用一份有旧数据的 userData。

### 2.1 本机成员（回归）

1. 打开和本机 Codex 的单聊，详情 → 工作区，选择本机文件夹 X。让它执行"列出当前目录"，应列出 X 的内容。
2. 点「恢复默认」，再问一次，应回到托管目录。
3. 旧数据：拿一个升级前设置过工作区的单聊，升级后不做任何操作，直接继续对话。预期：仍在原目录，并能接着之前的 thread 继续（Codex 记得上文）。
   这一条验证本机 fingerprint 没有变。
3a. 同一个旧会话，点「恢复默认」，应清除旧的会话级目录，回到托管目录。

### 2.2 远程成员

4a. 升级兼容：用一个升级前就在用、没改过服务器配置的远程 agent，在服务器上看 `~/.douchat-remote/w/` 下它原来的目录。升级后对话，预期仍在这个目录运行（`pwd` 不变，之前生成的文件还在）。
    远程 agent 的 thread 会重新开始，这是预期的：它的 fingerprint 现在包含服务器身份。

4. 和远程 agent 单聊，详情 → 工作区。预期：显示"运行于 user@host"，按钮是「选择服务器目录」，不会弹出本机文件夹选择框。
5. 浏览进入 `proj-a`，点「使用此文件夹」。让它执行 `cat marker.txt` 和 `pwd`，预期输出 `A` 和 `/home/<user>/proj-a`。
6. 点「复制路径」，粘贴出来应是完整的服务器路径。点「在终端打开」，应打开终端并 SSH 进入该目录：macOS 上用 Terminal.app，Windows 上会直接打开 ssh.exe 窗口。
7. 改选 `proj-b`，再问"上一轮你看到的文件内容是什么"。预期：开了新 thread，读到的是 `B`。

### 2.3 安全与失效

8. 浏览时尝试选择服务器的 `~`、`~/.ssh`、`/etc`，都应被拒绝并给出原因。如果服务器是 macOS，再试一次大写的 `~/.SSH`，同样应被拒绝。
9. 在服务器上执行 `mv ~/proj-a ~/proj-a.bak && ln -s /tmp ~/proj-a`，然后在已选 `proj-a` 的会话里发消息。预期：报错"目录已被替换"，agent 不启动，`/tmp` 不受影响。测完把目录还原。
10. 编辑该远程 agent，把 host 改成同一台服务器的另一个别名（或改端口、用户），保存。回到会话详情，预期显示"此前选择的目录属于另一台电脑或服务器"；再发消息，在默认托管目录运行，提示词里会说明这一点。改回原 host 后，旧目录仍然失效，需要重新选择。
11. 有旧 `workspacePath`、但成员只有远程 agent 的会话：详情里应提示"本机文件夹对这里的智能体都不生效"，并提供「清除」。

### 2.4 群聊和共享房间

12. 建一个群，成员是本机 Codex 和远程 agent，分别给两者选目录（本机 X、服务器 `proj-a`）。各 @ 一次，都应在各自目录运行。
13. 在共享群（有好友）里给自己的远程 agent 选目录。让好友 @ 它，预期在你选的服务器目录运行；好友的 agent 那一行不会出现在你的工作区设置里。
14. 把远程 agent 移出群再加回来，它的目录设置应已被清掉。

## 3. 本期不包含

以下内容属于 P1/P2，本期不验收：
- 连接页、连接注册表、按连接复用配置、迁移。
- 守护进程及服务端改动。
- 不同连接或不同桌面之间的分布式目录锁。目录串行只保证在同一桌面进程、同一服务器内。
