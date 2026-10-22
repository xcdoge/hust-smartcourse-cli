# hust-smartcourse-cli

[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/xcdoge/hust-smartcourse-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/xcdoge/hust-smartcourse-cli/actions/workflows/ci.yml)

**[智慧华中大课程平台](https://smartcourse.hust.edu.cn) 任务点自动化 CLI**，纯 HTTP 实现，不启动浏览器。

支持视频进度上报、文档/图片任务点、章节测验与练习题，内置企业微信扫码登录与验证码自动识别。

> ⚠️ 本项目仅供学习 HTTP 协议与前端逆向（混淆还原、签名算法、验证码识别）。
> 使用它违反平台用户协议，**可能被判定为学习行为异常并取消成绩**，请自行承担后果。
> 建议只在自己的课程、且了解风险的前提下使用。

> 如果这个项目帮到你，点个 star ⭐

## 功能特性

- **三类任务点全覆盖**：视频（`insertvideo`）、文档/图片（`insertdoc`）、测验与练习题（`work`）
- **两种登录全自动**：企业微信扫码登录、账号密码登录（内置验证码 OCR，整图约 90%）
- **纯 HTTP，无浏览器**：不依赖 Playwright / Puppeteer，可在服务器、树莓派、CI 上挂着跑
- **断点续跑**：会话过期后重新登录即可，已完成的自动跳过，进度不丢
- **限速感知**：自动读取课程的 `rt_d` / `rt_1` 策略，决定能用 10 倍速还是只能 1 倍速
- **全量扫描**：`scan` 逐 tab 扫描章节，**不会漏掉藏在第二个 tab 里的练习题**
- **验证码识别**：手写 GIF 解码 + 多帧交集去噪 + 1-NN 模板匹配，零外部依赖
- **离线可测**：内置 mock 服务端，`npm test` 不需要真实账号就能验证上报逻辑

## 技术栈

| 分类 | 选型 |
| --- | --- |
| 运行时 | Node.js ≥ 18（内置 `fetch` / `AbortSignal.timeout`） |
| 依赖 | 仅 `qrcode`（生成登录二维码），其余全手写 |
| HTTP | 原生 `fetch` + 自维护 CookieJar（手动跟随重定向） |
| 加密 | `node:crypto`（RSA PKCS#1 v1.5）、手写 MD5 参与签名 |
| 图像 | 手写 GIF 解码（LZW + 多帧合成 + 透明 / disposal） |
| 测试 | 本地 mock 服务端 + 逐次重算签名校验 |
| CI | GitHub Actions（`npm test`） |

## 安装

### 前置要求

- **Node.js 18 或更高**（推荐 20 / 22）

> 为什么卡 18：项目用到内置 `fetch` 和 `AbortSignal.timeout()`，低于 18 会直接报错。

### 安装 Node.js

**Windows**

```powershell
# 方式一：winget（Win10 1809+ / Win11 自带）
winget install OpenJS.NodeJS.LTS

# 方式二：官网下载 LTS 安装包（.msi，一路下一步）
# https://nodejs.org/zh-cn/download
```

> 装完**重开一个终端**，让 `node` 进入 PATH。如果 `node -v` 还找不到，注销重新登录一次。

**macOS**

```bash
# Homebrew
brew install node

# 或官网下载 .pkg
# https://nodejs.org/zh-cn/download
```

**Linux（Debian / Ubuntu）**

```bash
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install -y nodejs
```

**推荐：用 nvm 管理多版本**（以后切版本不用重装）

```bash
# macOS / Linux
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
nvm install --lts
nvm use --lts
```

```powershell
# Windows: nvm-windows
winget install CoreyButler.NVMforWindows
nvm install lts
nvm use lts
```

**国内网络慢**的话，给 npm 换个源：

```bash
npm config set registry https://registry.npmmirror.com
```

### 验证

```bash
node -v    # 应输出 v18.x / v20.x / v22.x
npm -v
```

### 克隆并安装依赖

```bash
git clone https://github.com/xcdoge/hust-smartcourse-cli.git
cd hust-smartcourse-cli
npm install
```

## 快速开始

### 1. 登录

**方式 A：扫码登录（推荐，全自动）**

```bash
node src/login-qr.mjs
```

会生成 `state/login-qr.png`，用**企业微信**或**华中大微校园**扫码，脚本自动轮询、换票、进站。

**方式 B：账号密码登录（全自动）**

先把账号密码**加密**存到本地（一次性）：

```bash
node src/cred.mjs save <你的学号> <你的密码>
```

> 凭据用 **AES-256-GCM** 加密，密钥由「主机名 + 系统用户名」经 scrypt 派生——
> **换台机器或换个用户就解不开**。想再叠一层口令，设环境变量 `HUST_CLI_KEY=<任意一段话>` 即可。
> 这不是防得住有权限的攻击者，而是防止文件被顺手拷走、同步到网盘后被人直接打开。

然后运行：

```bash
node src/login-pw.mjs          # 自动读加密凭据 + 自动识别验证码
node src/login-pw.mjs --save   # 凭据是临时手输的，登录成功后自动加密保存
```

凭据管理：

```bash
node src/cred.mjs status   # 看存了没有、本机能不能解开
node src/cred.mjs show     # 解密查看（确认存对了）
node src/cred.mjs forget   # 清除本地凭据
```

也兼容旧版明文 `state/cred.txt`（两行：学号 / 密码），跑一次 `node src/cred.mjs save` 就会自动迁移成加密文件并删掉明文。

自动取验证码 → 识别 → 提交；识别不准或服务端判错会**自动换图重试**（最多 4 次），低置信度的图不会被浪费成失败尝试。

**方式 C：导入浏览器 cookie（保底）**

```bash
# 浏览器 F12 → 网络 → 过滤 smartcourse → 任意请求右键「复制为 cURL」→ 粘进 state/cookies.txt
node src/import-cookies.mjs
node src/probe-session.mjs
```

### 2. 配置课程

```bash
cp config/target.example.json state/target.json
```

把课程链接里的参数填进去：

```
https://smartcourse.hust.edu.cn/.../mycourse/stu
    ?courseid=17310000000001&clazzid=17310000000002&cpi=17310000000003
```

### 3. 抓课程结构

```bash
node src/course.mjs
```

输出章节、视频、文档、测验清单和完成度，并写入 `state/course.json`。

### 4. 全量扫描（重要）

```bash
node src/scan.mjs
```

平台一个章节有多个 tab（`num=0` 学习材料、`num=1` 练习题），**只抓第一个 tab 会漏掉全部练习题**。这一步会逐 tab 扫一遍，把漏的任务点找出来。

### 5. 刷任务点

```bash
# 文档 / 图片任务点（秒完成）
node src/doc.mjs

# 视频：不限速课用 10 倍速
node src/play.mjs --all --speed=10 --tick=10

# 视频：限速课（rt_1）只能 1 倍速 + 真实节奏
node src/play.mjs --all --speed=1 --tick=10

# 只跑单个视频 / 限制数量
node src/play.mjs --objectid <objectId>
node src/play.mjs --all --limit 5
```

### 6. 章节测验与练习题

```bash
# 抓题 -> state/quizzes.json + state/quiz-readable.txt
node src/quiz.mjs dump

# 查看某一份的批阅页
node src/quiz.mjs peek --only=0

# 交卷（答案写到 state/answers.json）
node src/quiz.mjs submit
```

答案格式：

```json
{
  "0": { "100001": "C", "100002": "C" },
  "1": { "100003": "D", "100004": ["extrovert"] }
}
```

> 单选填字母，多选**连写**（`"ABD"` 不是 `"A,B,D"`），判断填 `"true"` / `"false"`，
> 填空填**字符串数组**（每个空一项）。

## 命令一览

| 命令 | 说明 |
| --- | --- |
| `src/login-qr.mjs` | 扫码登录（全自动） |
| `src/login-pw.mjs` | 账密登录（含验证码 OCR；`--manual` / `--code=` 为退路） |
| `src/import-cookies.mjs` | 从 cURL / Cookie 头 / TSV 导入 cookie（自动取最新文件） |
| `src/cred.mjs` | 凭据管理：`save` 加密保存 / `show` 解密查看 / `status` / `forget` |
| `src/probe-session.mjs` | 会话体检，报告缺失或过期的 cookie |
| `src/course.mjs` | 抓章节 / 视频 / 文档 / 测验 |
| `src/scan.mjs` | 逐 tab 全量扫描，找齐所有任务点 |
| `src/play.mjs` | 视频进度上报（`--all` `--speed` `--tick` `--limit` `--objectid` `--dry`） |
| `src/doc.mjs` | 文档 / 图片任务点（`--all` 强制重刷） |
| `src/quiz.mjs` | `dump` 抓题 / `submit` 交卷 / `peek` 看批阅 |
| `src/discover.mjs` | dump 页面并抽取接口，改版时排查用 |
| `src/replay-curl.mjs` | 原样重放一段 cURL，对比差异 |

## 配置

运行态数据都在 `state/` 目录（已被 `.gitignore` 排除，不会误提交）。

| 文件 | 说明 |
| --- | --- |
| `state/target.json` | 课程参数（`courseId` / `clazzId` / `cpi` / `enc`） |
| `state/cred.enc.json` | **加密凭据**（AES-256-GCM，机器绑定） |
| `state/cred.txt` | 旧版明文凭据，仍兼容；建议用 `cred save` 迁移 |
| `state/cookies.json` | 登录态（自动生成） |
| `state/cookies.txt` | 手动导入 cookie 的入口 |
| `state/course.json` | 课程结构快照 |
| `state/scan.json` | 全量扫描结果（含练习题） |
| `state/quizzes.json` | 抓到的题目 |
| `state/answers.json` | 你的答案 |
| `state/play.log` | 播放日志 |
| `state/login-qr.png` | 登录二维码 |
| `data/captcha-model.json` | 验证码样本模型（随仓库分发） |

## 工作原理

完整逆向笔记见 **[docs/PROTOCOL.md](docs/PROTOCOL.md)**，这里列最关键的几点。

### 播放上报签名

```http
GET /ananas/status/{objectid}?k={fid}&flag=normal&ro=0
→ { "duration": 1896, "dtoken": "...", "reportUrl": "..." }

GET {reportUrl}/{dtoken}?clazzId=…&playingTime=…&duration=…
    &enc=md5([clazzId][userid][jobid][objectId][playingTime×1000]
             [d_yHJ!$pdA~5][duration×1000][clipTime])
```

盐 `d_yHJ!$pdA~5` 硬编码在播放器里，不知道它就无法伪造进度。

### 两个致命坑

| 坑 | 说明 |
| --- | --- |
| 判过阈值 | 在 `duration - 2` 附近，**报满 100% 反而判无效** |
| 限速 | `otherInfo` 里的 `rt_` 前缀：`rt_d` 可 10 倍速；`rt_1` 服务端校验「上报进度 ≈ 真实流逝时间」，1.5 倍都会被拒 |

### CAS 登录：先拿会话，再换票

```
① 扫码 / 账密 → 只拿 pass.hust.edu.cn 的 CAS 会话（CASTGC）
② GET /cas/login?service=<超星 SSO>  → CAS 直接 302 带 ticket，免密
③ 跟随 ticket 进站，拿到业务 cookie
```

把「认证」和「换票」拆成两步，两种登录方式就都能用。扫码时必须注意：`service` 留空、轮询响应里的 `Set-Cookie` 必须保存。

### 验证码识别

```
GIF 多帧 → 取交集去噪（静止数字保留、移动噪点消失）
        → 列投影切 4 个数字块
        → 裁紧居中补到 24×24（不缩放，Python/Node 结果一致）
        → 与样本做 1-NN（允许 ±1 像素平移），top1/top2 距离差作置信度
```

## 实测数据

在三门正式课程上完整跑通：

| 课程 | 任务点规模 | 耗时 | 结果 |
| --- | --- | --- | --- |
| 课 A（`rt_d` 不限速） | 154 视频 + 12 章节测试 | 1 小时 44 分（16.5 小时视频量，10 倍速） | **154/154 通过，0 失败**，测验全部交卷 |
| 课 B（`rt_1` 限速） | 49 视频 + 49 文档 + 46 练习题 | 约 9 小时（只能 1 倍速） | 视频全过，文档秒完成，练习题 45 份中 43 份满分 |
| 课 C（`rt_d`） | 44 视频 + 44 章节测验 | 约 1 小时（10 倍速） | 视频全过，测验 44 份全部交卷 |

> 课 A 的日志里有个规律：每个视频第 1~3 次上报服务端仍判 `isPassed=false`，
> 到第 4 次、或补报到 95% 后**换一个 dtoken 重报**才翻真 —— 它在校验「进度推进」和「时间流逝」是否对得上。
> 课 B 是典型限速课：服务端校验「上报进度 ≈ 真实流逝时间」，1.5 倍速都会被拒，只能按真实节奏跑。

验证码识别（80 张标注样本 = 320 个数字，留一验证）：

| 匹配策略 | 单字 | 整图 |
| --- | --- | --- |
| 1-NN | 95.9% | 84.7% |
| 3-NN 投票 | 94.4% | 79.3% |
| **1-NN + ±1 平移容差** | **97.8%** | **91.5%** |

## 项目结构

```
src/
  login-qr.mjs        扫码登录（全自动）
  login-pw.mjs        账密登录（含验证码 OCR，全自动）
  login.mjs           CAS 登录的其他实验路径
  import-cookies.mjs  从浏览器导入 cookie
  probe-session.mjs   会话体检
  course.mjs          抓章节 / 视频 / 文档 / 测验
  scan.mjs            逐 tab 全量扫描（含练习题）
  play.mjs            视频进度上报
  doc.mjs             文档任务点
  quiz.mjs            测验抓题 / 交卷 / 查看批阅
  discover.mjs        dump 页面并抽取接口
  replay-curl.mjs     原样重放 cURL
  lib/
    const.mjs         课程配置与常量
    http.mjs          CookieJar + 超时 + 手动重定向
    cas.mjs           CAS 认证（RSA PKCS#1 v1.5）
    chaoxing.mjs      播放上报协议（md5 签名）
    player.mjs        播放核心（可注入 base，便于 mock 测试）
    quiz-parse.mjs    测验页面解析
    verify.mjs        会话校验
    gif.mjs           手写 GIF 解码
    captcha.mjs       验证码识别
data/
  captcha-model.json  验证码样本模型
test/
  mock-play.mjs       本地 mock 服务端（无需真实账号）
tools/
  deobf-generic.mjs   obfuscator.io 字符串表还原
  crack-url.mjs       定点爆破字符串表索引
  harvest-captcha.mjs 批量抓验证码
  build-model.py      抓图 → 标注 → 生成模型
  verify-ocr.mjs      验证码识别留一验证
  match-compare.py    匹配策略对比
docs/
  PROTOCOL.md         完整逆向笔记
```

## 测试

```bash
npm test
```

`test/mock-play.mjs` 会起一个本地假服务端，按浏览器端逻辑**逐次重算 md5 校验 `enc`**，
验证播放核心能否正确推进到 `isPassed` 并终止，不需要真实账号。

## 常见问题

**Q: 会话多久过期？**
约 12 小时。过期后重新登录即可，进度不会丢（服务端记着），重跑会自动跳过已完成的。

**Q: 视频能不能快进？**
取决于课程配置。`rt_d` 的课可以；`rt_1` 的课服务端校验真实流逝时间，只能按 1 倍速跑。

**Q: 为什么漏了练习题？**
一个章节有多个 tab，`num=0` 是学习材料、`num=1` 是练习题。跑一次 `node src/scan.mjs` 就能找齐。

**Q: 测验答案从哪来？**
程序不提供答案。`dump` 只抓题，`submit` 需要你自己填 `state/answers.json`。

**Q: 为什么不用 Playwright / Puppeteer？**
驱动真实浏览器需要子进程 + 命名管道，在受限环境和 CI 里会 `spawn EPERM`。纯 HTTP 更稳，也能挂在服务器上跑。

**Q: 登录提示「验证码错误」？**
验证码是强校验的。用 `login-pw` 自动识别（整图约 90%），或 `--manual` 取图后人工 `--code=1234`。

## 贡献

欢迎提 Issue / PR。改进方向：

- 扩充验证码样本（`tools/harvest-captcha.mjs` + 人工标注）继续提升准确率
- 适配平台 UI 改版（`scan.mjs` 的 tab 发现逻辑）
- 支持更多类型的任务点

## License

[MIT](LICENSE)
