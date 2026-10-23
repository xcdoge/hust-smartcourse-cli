# hsc —— Go 版单文件 CLI

`hust-smartcourse-cli` 的 Go 实现。**好处就一个：编译出来是 8~12 MB 的单文件 exe，不依赖 Node。**

功能与 Node 版一致：

| 命令 | 说明 |
| --- | --- |
| `hsc login-qr` | 扫码登录（生成 `state/login-qr.png`） |
| `hsc login-pw` | 账密登录（内置验证码识别，失败自动换图重试） |
| `hsc cred save/show/status/forget` | 凭据加密管理（与 Node 版互相兼容） |
| `hsc check` | 会话体检 |
| `hsc logout [--all]` | 退出登录（清 cookie；`--all` 连凭据一起清）|
| `hsc init [序号\|课程链接]` | 列出账号下的课程并按序号选课 |
| `hsc course` | 抓课程结构 |
| `hsc scan` | 逐 tab 全量扫描（含练习题） |
| `hsc doc` | 文档/图片任务点 |
| `hsc play [--speed=10] [--tick=10] [--limit=N]` | 视频进度上报 |
| `hsc quiz dump/solve/submit/peek` | 抓题 / 自动答题 / 交卷 / 看批阅 |
| `hsc config [show\|init]` | 查看或生成 `state/config.toml` |
| `hsc captcha-test` | 用标注样本验证验证码识别准确率 |

## 编译

需要 Go ≥ 1.21（用到 `os.ReadFile` 等）。

```bash
cd go
go build -o hsc.exe .
```

产物约 **11 MB**（含 Go 运行时）。

## 与 Node 版的关系

- `state/` 目录格式完全一致，两个版本可以混用
- `state/cred.enc.json` 互相兼容（同样的 scrypt 派生 + AES-256-GCM），换版本不用重新登录
- `data/captcha-model.json` 与仓库根目录那份是同一份，Go 用 `//go:embed` 打进二进制

## 实现要点

几个 Go 特有的坑：

1. **512 位 RSA 被拒**：Go 1.24+ 对 <1024 位的密钥直接报错，而 HUST CAS 发的就是 512 位。
   见 `rsa512.go`，手写 PKCS#1 v1.5 填充（`EM = 0x00 || 0x02 || PS || 0x00 || M`）再做模幂。

2. **`mArg` 先被赋成空串**：页面里先有 `mArg = "";`，后面才在 `try` 里赋真值。
   必须按 `mArg\s*=\s*\{` 定位，不能只找第一个 `mArg` 再找下一个 `{`。

3. **`http.Client` 必须挂 Jar**：否则 `CASTGC` 这类 Set-Cookie 不落罐，换票永远拿不到会话。

4. **`userid` 用的是 cookie 里的 `_uid`**，不是 URL 里的 `cpi`；签名里也用它，用错会被服务端静默忽略。

5. **`reportUrl` 优先取 `mArg.defaults.reportUrl`**：`/ananas/status` 不保证返回这个字段。

## 验证情况

在真实环境跑通：扫码/账密登录、抓课程结构（154 视频 + 12 作业）、全量扫描、视频上报（一次通过）、
测验抓题（12 份 109 题）、验证码识别留一验证（单字 97.5% / 整图 90.0%）。

未实测：`doc`（当前课程没有文档任务点）、`quiz submit`（当前课程测验已全部提交）。
