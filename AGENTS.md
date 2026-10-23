# AGENTS.md

给 AI 编码代理看的工程说明。改代码前先读这一份，能省掉大部分返工。

## 这是什么

智慧华中大课程平台（`smartcourse.hust.edu.cn`，超星泛雅内核）的任务点自动化 CLI。
纯 HTTP 实现，不驱动浏览器。

同一份能力有两个实现，**必须保持同步**：

| 版本 | 目录 | 说明 |
| --- | --- | --- |
| Go | `go/` | 主力。单文件 exe，零运行时依赖 |
| Node | `src/` | 参考实现，改起来快，便于验证协议 |

两个版本共用 `state/` 目录和 `state/config.toml` 的格式，加密凭据互相兼容。

## 目录

```
go/                    Go 版（module 名是 hsc）
  main.go              命令分发、用法文本、交互模式
  config.go            target.json 读取
  cas.go               CAS 账密登录
  login_cmd.go         登录 / 会话检查
  args.go              交互模式的引号分词
  course.go            抓课程结构
  scan_doc.go          全量扫描 + 文档任务点
  video.go             播放上报
  video_refresh.go     开播前刷新章节参数
  quiz.go              测验抓题 / 交卷
  quiz_llm.go          LLM 调用与答案解析
  quiz_solve.go        自动答题
  config_toml.go       state/config.toml 读写
  creds.go / cred_cmd.go 凭据加密
  data/captcha-model.json  验证码模型（go:embed）
src/                   Node 版
  lib/quiz-parse.mjs   题目解析
  lib/player.mjs       播放核心（可注入 base，便于 mock 测试）
  lib/const.mjs        路径与课程参数
  lib/config.mjs       config.toml 读写
  solve.mjs            自动答题
docs/PROTOCOL.md       协议逆向笔记（登录、播放签名、交卷字段）
test/mock-play.mjs     本地 mock 服务端，不需要真实账号
data/captcha-model.json  验证码模型（与 go/data 下是同一份）
```

## 构建与测试

```bash
# Go
cd go
go build -o hsc .          # 产物约 8 MB
go test ./...              # 目前有 playTime 单位换算的用例

# Node
npm install
npm test                   # 起 mock 服务端跑播放逻辑，不需要账号
node --check src/xxx.mjs   # 改完先过一遍语法
```

如果 `GOPATH` / `GOCACHE` 所在位置不可写，把它们指到可写目录：

```bash
export GOPATH=/some/writable/path
export GOCACHE=$GOPATH/cache
export GOTMPDIR=$GOPATH/tmp
```

## 文案约定

命令行输出必须**朴素**，这条是硬要求：

- 不使用 `✔ ✘ ▶ ⚠` 等符号，不用 emoji
- 不用「下一步：」「两种填法：」「① ② ③」这类说教句式
- 报错要能直接指导下一步动作，例如
  `未登录，先执行 hsc login-qr 或 hsc login-pw`，
  而不是抛裸路径 `open D:\...\cookies.json: The system cannot find the file specified`
- 日志前缀是 `[HH:MM:SS]`，条目之间不要加装饰性分隔符

改文案时两个版本一起改，否则会出现"exe 是新的、Node 还是老文案"。

## 状态文件

`state/` 全部不入库（`.gitignore` 已排除），里面是登录态和运行数据：

| 文件 | 内容 |
| --- | --- |
| `target.json` | 课程参数，`hsc init` 生成 |
| `cookies.json` | 登录态 |
| `cred.enc.json` | 加密凭据（AES-256-GCM + scrypt，密钥绑机器） |
| `config.toml` | LLM 配置，程序自动生成 |
| `course.json` / `scan.json` | 结构与扫描快照 |
| `quizzes.json` / `answers.json` | 题目与答案 |

**任何情况下都不要把这些文件提交进仓库，也不要打进发布包。**
打 `dist/*.zip` 时排除 `state/`、`dist/`、`.git/`、`*.exe`、`*.log`。

## 改动的常见姿势

**加一个命令**：`go/main.go` 的 `switch` 里加分支 + 写实现文件 + 在 `src/` 里补对应用法 + 更新 README 命令表。

**帮助文本**：每个命令都必须支持 `-h`/`--help`。Go 侧文本集中在 `go/help.go` 的
`commandHelp`，`hsc help <命令>` 复用同一份；Node 侧在 `src/lib/help.mjs`，
各脚本开头调 `maybeHelp('<名字>')`。加命令时两处都要补，否则 `--help` 会落到业务逻辑里。

**选课与 `--id`**：`go/courses.go` 负责课程列表（POST `/mooc-ans/visit/courselistdata?courseType=1`，
`courseType=0` 返回空）、缓存到 `state/courses.json`、按序号写 `target.json` 并重抓结构。
`play`/`quiz` 的 `--id=N` 走 `switchCourse`。Node 侧因为 `const.mjs` 在 import 阶段就读 target，
`--id` 用「切换后 respawn 自身」的方式实现，不要在 import 之前改文件。

**改播放逻辑**：`go/video.go` 的 `playOne`。注意三个不变量：
判过点在 `duration - 2`；`playTime` 是毫秒；同一 dtoken 连续大跳会被限流，需要换 token 重报。

**改抓题**：`go/quiz.go` 的 `parseQuiz` 和 `src/lib/quiz-parse.mjs` 要同步，
两边都按 `id="question<qid>"` 切块。

**改自动答题**：`go/quiz_llm.go` 的提示词和 `parseAnswer`，Node 侧在 `src/solve.mjs`，
两边的题型归一（choice/multi/judge/fill/essay）必须一致。

## 已知约束（踩过的坑，别再踩）

1. **`playTime` 是毫秒，`attDuration` 是秒**。混用会让部分观看的视频从 349000 起报，
   服务端判定为非法跳转，所有上报静默失败（返回 200 但 `isPassed=false`）。
2. **上报的 `userid` 用 cookie 里的 `_uid`**，不是 URL 里的 `cpi`。用错同样静默失败。
3. **章节卡片接口的 `num` 是 tab 序号**（0 学习材料、1 练习题），不是分页。只抓 0 会漏练习题。
4. **`mArg` 前面有一句 `mArg = "";`**，解析时要按 `mArg\s*=\s*\{` 定位。
5. **`http.Client` 必须挂 Jar**，否则 `CASTGC` 这类 Set-Cookie 不落罐，换票拿不到会话。
6. **Go 1.24+ 拒绝 512 位 RSA**，CAS 发的正是 512 位，见 `go/rsa512.go` 的手写填充。
7. **填空的 `answertype` 沿用页面隐藏域**（2），不要用自己推断的题型码覆盖。
8. **`type Answer` 必须是别名 `= json.RawMessage`**，定义类型会被编码成 base64。
9. **上报循环必须按 tick 间隔 sleep**。一口气把进度推到底，服务端看到「1 秒内前进几百秒」
   会全部拒绝，表现为所有 `isPassed=false`。步长是 `speed*tick`，间隔是 `tick` 秒。

## 提交与发布

提交信息用中文，一行说清改了什么。发版流程：

```bash
# 1. 改 go/main.go 里 const version 和 package.json 的 version
# 2. 交叉编译四个平台到 dist/
cd go
GOOS=windows GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o ../dist/hsc-windows-amd64.exe .
GOOS=linux   GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o ../dist/hsc-linux-amd64 .
GOOS=darwin  GOARCH=arm64 go build -trimpath -ldflags="-s -w" -o ../dist/hsc-darwin-arm64 .
GOOS=darwin  GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o ../dist/hsc-darwin-amd64 .
# 3. 打源码包（排除 state/ dist/ .git/ *.exe）
# 4. git tag -a vX.Y.Z
```

Windows 版用自签名证书签一下，证书是 `CN=xcdoge`，公钥放在 `dist/hsc-codesign.cer`。

## 边界

这个项目的用途是协议学习和个人课程自动化。改动时不要加：
绕过平台风控的新手段、批量账号操作、把答案分享出去的功能。
