# hust-smartcourse-cli

[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![Go](https://img.shields.io/badge/go-%3E%3D1.21-00ADD8.svg)](https://go.dev/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**[智慧华中大课程平台](https://smartcourse.hust.edu.cn) 任务点自动化工具**，纯 HTTP 实现，不启动浏览器。
支持视频进度、文档/图片任务点、章节测验与练习题，登录支持企业微信扫码与账号密码（含验证码自动识别）。

> ⚠️ 仅供学习 HTTP 协议与前端逆向。使用它违反平台用户协议，**可能被判定为学习行为异常并取消成绩**，后果自负。

---

## 两个版本

| 版本 | 目录 | 依赖 | 说明 |
| --- | --- | --- | --- |
| **Go 版**（推荐） | `go/` | 无 | 编译出 ~8 MB 单文件，下载即用 |
| Node 版 | `src/` | Node ≥ 18 | 功能最全，改起来方便 |

两者共用同一个 `state/` 目录，**加密凭据互相兼容**，换版本不用重新登录。

## 安装

**Go 版**（不用自己编译）：去 [Releases](https://github.com/xcdoge/hust-smartcourse-cli/releases) 下载对应平台的 `hsc-*`。

**双击 exe 会进交互模式**：打印用法后停在 `hsc>` 提示符，直接敲命令回车执行，`q` 退出（所以窗口不会一闪而过）。
在终端里带参数跑就是普通 CLI：`hsc.exe play --speed=10`。

自己编译：

```bash
cd go && go build -trimpath -ldflags="-s -w" -o hsc.exe .
```

**Node 版**：

```bash
git clone https://github.com/xcdoge/hust-smartcourse-cli.git
cd hust-smartcourse-cli && npm install
```

> Node 低于 18 会报错（用到内置 `fetch` 和 `AbortSignal.timeout`）。

## 快速开始

### 1. 登录

```bash
hsc login-qr          # 扫码：生成 state/login-qr.png，企业微信扫一下
hsc login-pw          # 账密：自动识别验证码，失败换图重试
hsc cred save <学号> <密码>   # 先把凭据加密存本地，再跑 login-pw
```

凭据用 AES-256-GCM 加密、密钥由「主机名 + 用户名」派生，**换机器就解不开**。
Node 版对应命令是 `node src/login-qr.mjs` / `node src/login-pw.mjs`，其余命令一一对应（`src/xxx.mjs` ↔ `hsc xxx`）。

### 2. 配置课程

```bash
cp config/target.example.json state/target.json
```

填课程链接里的参数：`?courseid=…&clazzid=…&cpi=…`

### 3. 抓结构 → 刷任务点

```bash
hsc course                          # 抓章节 / 视频 / 文档 / 测验
hsc scan                            # 逐 tab 全量扫描（重要，见下）
hsc doc                             # 文档任务点
hsc play --speed=10 --tick=10       # 视频（不限速课）
hsc play --speed=1  --tick=10       # 视频（限速课）
```

### 4. 测验

```bash
hsc quiz dump                                  # 抓题 -> state/quizzes.json
hsc quiz submit                                # 交卷（答案在 state/answers.json）
hsc quiz peek --only=0                         # 看批阅页
```

答案格式：

```json
{
  "0": { "100001": "C", "100002": "ABD" },
  "1": { "100003": "true", "100004": ["extrovert"] }
}
```

> 多选**连写**（`"ABD"`），判断填 `"true"/"false"`，填空填**字符串数组**（每空一项）。

## 命令一览

| 命令 | 说明 |
| --- | --- |
| `login-qr` / `login-pw` | 扫码登录 / 账密登录 |
| `cred save\|show\|status\|forget` | 凭据加密管理 |
| `check` | 会话体检 |
| `course` | 抓课程结构 |
| `scan` | 逐 tab 扫描，找齐所有任务点 |
| `doc` | 文档 / 图片任务点 |
| `play [--speed] [--tick] [--limit] [--objectid] [--dry]` | 视频进度上报 |
| `quiz dump\|submit\|peek` | 测验抓题 / 交卷 / 看批阅 |
| `captcha-test` | 用标注样本验证验证码识别准确率 |

## 状态文件

都在 `state/`（已被 `.gitignore` 排除）：

| 文件 | 内容 |
| --- | --- |
| `target.json` | 课程参数 |
| `cred.enc.json` | 加密凭据（或旧版明文 `cred.txt`）|
| `cookies.json` | 登录态 |
| `course.json` / `scan.json` | 课程结构 / 扫描结果 |
| `quizzes.json` / `answers.json` | 题目 / 你的答案 |

## 三个关键实现点

1. **播放上报要签名**：`enc = md5([clazzId][userid][jobid][objectId][playingTime×1000][d_yHJ!$pdA~5][duration×1000][clipTime])`，
   其中 `userid` 是 cookie 里的 `_uid`，**不是 URL 里的 cpi**——用错会被服务端静默忽略。
2. **判过点在 `duration - 2`**，报满 100% 反而无效；限速看 `otherInfo` 的 `rt_` 前缀（`rt_d` 可 10 倍速，`rt_1` 只能真实时长）。
3. **章节 cards 的 `num` 是 tab 序号**：`num=0` 学习材料、`num=1` 练习题。只抓 `num=0` 会漏掉全部练习题，所以要跑 `scan`。

完整逆向笔记（CAS 登录、验证码、协议细节、交卷字段）见 **[docs/PROTOCOL.md](docs/PROTOCOL.md)**。

## 实测

| 课程 | 任务点 | 结果 |
| --- | --- | --- |
| `rt_d` 不限速 | 154 视频 + 12 章节测试 | 10 倍速 1 小时 44 分，**154/154 通过** |
| `rt_1` 限速 | 49 视频 + 49 文档 + 46 练习题 | 视频 1 倍速约 9 小时，练习题 43/45 满分 |
| `rt_d` | 44 视频 + 44 章节测验 | 全部交卷 |

验证码识别（80 张标注、留一验证）：**单字 97.8%，整图 91.5%**。

## FAQ

**会话多久过期？** 约 12 小时。重新登录即可，进度不丢，重跑自动跳过已完成。

**能不能快进？** 看课程配置。`rt_1` 的课服务端校验真实流逝时间，只能按 1 倍速。

**为什么漏了练习题？** 章节有两个 tab，`num=1` 那页才是练习题。跑 `hsc scan`。

**测验答案从哪来？** 程序不提供答案，`dump` 只负责抓题，`submit` 需要你填 `state/answers.json`。

**为什么不用 Playwright？** 驱动真实浏览器需要子进程 + 命名管道，受限环境和 CI 里会 `spawn EPERM`。纯 HTTP 更稳，也能挂服务器上跑。

## License

[MIT](LICENSE)
