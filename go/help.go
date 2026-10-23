package main

import (
	"fmt"
	"strings"
)

// 每个命令的详细帮助。hsc <命令> --help 打印对应文本。
// hsc help <命令> 走同一份数据，避免两处内容不一致。
var commandHelp = map[string]string{
	"login-qr": `用法: hsc login-qr

扫码登录。二维码写到 state/login-qr.png，用企业微信扫。
登录成功后 cookie 存到 state/cookies.json。

选项:
  -h, --help   显示本帮助

示例:
  hsc login-qr`,

	"login-pw": `用法: hsc login-pw [--manual] [--code=NNNN]

账号密码登录。需要先用 hsc cred save 存过凭据，或在 state/cred.txt 写两行。
验证码由内置模型识别，失败会自动换图重试。

选项:
  --manual        不自动识别，只取验证码图，自己看
  --code=NNNN     配合 --manual，指定验证码后提交
  -h, --help      显示本帮助

示例:
  hsc cred save 2026xxxxxx 你的密码
  hsc login-pw
  hsc login-pw --manual --code=5x9r`,

	"check": `用法: hsc check

检查当前会话是否有效，打印课程页大小和章节数。

选项:
  -h, --help   显示本帮助

示例:
  hsc check`,

	"logout": `用法: hsc logout [--all]

清除登录态，并通知 CAS 注销。

默认只删 state/cookies.json，保留加密凭据。
加 --all 连凭据一起删。

选项:
  --all, -a    同时删除 state/cred.enc.json 和 cred.txt
  -h, --help   显示本帮助

示例:
  hsc logout
  hsc logout --all`,

	"cred": `用法: hsc cred <子命令>

账号密码加密管理。加密用 AES-256-GCM，密钥由 scrypt 从机器信息派生，
换机器或换用户就解不开。

子命令:
  save <学号> <密码>   加密保存到 state/cred.enc.json
  show                显示已保存的账号（密码打码）
  status              查看凭据文件状态、能否解密
  forget              删除已保存的凭据

选项:
  -h, --help   显示本帮助

示例:
  hsc cred save 2026xxxxxx 你的密码
  hsc cred status`,

	"config": `用法: hsc config [show|init]

查看或生成 state/config.toml。自动答题（quiz solve）的接口配置在这里。

子命令:
  show   显示当前配置，api_key 打码（默认）
  init   重新生成默认配置，覆盖现有文件

配置项:
  [llm]
  enabled          是否启用自动答题
  base_url         接口地址，兼容 OpenAI 格式
  api_key          密钥
  model            模型名
  temperature      采样温度
  max_tokens       单次最大输出
  timeout_seconds  请求超时

  [quiz]
  auto_submit      solve 完是否直接交卷
  types            参与作答的题型 choice/multi/judge/fill/essay
  delay_ms         每题间隔
  retries          单题重试次数

选项:
  -h, --help   显示本帮助

示例:
  hsc config
  hsc config init`,

	"init": `用法: hsc init [序号|课程链接] [--refresh]

选课。不带参数时列出账号下的所有课程。

参数:
  序号          选第 N 门课，自动抓取课程结构并扫描练习题
  课程链接      从 URL 里解析 courseid / clazzid / cpi，同样会抓取并扫描

选项:
  --no-scan       只抓结构，不扫描练习题（大课程能省一分钟）
  --refresh, -r   强制重新拉课程列表（列表本来每次都会刷新）
  -h, --help      显示本帮助

示例:
  hsc init
  hsc init 3
  hsc init "https://smartcourse.hust.edu.cn/...?courseid=...&clazzid=..."`,

	"course": `用法: hsc course

抓取当前课程的章节、视频、文档、测验，写入 state/course.json。
课程改了或者换课后需要重跑。

选项:
  -h, --help   显示本帮助

示例:
  hsc course`,

	"scan": `用法: hsc scan

扫描每个章节的全部 tab（学习材料 + 练习题），把结果写到 state/scan.json。
比 course 更全，能看到练习题这类非视频任务点。

选项:
  -h, --help   显示本帮助

示例:
  hsc scan`,

	"play": `用法: hsc play [--all] [--id=N] [--speed=N] [--tick=N] [--limit=N] [--objectid=X] [--dry] [--debug]

刷视频任务点。每次上报推进 speed*tick 秒，两次上报间隔 tick 秒。
服务端判过点在 duration-2，别把速度调太高，会被判刷量。

选项:
  --all           处理全部未通过的视频（默认只处理一个）
  --id=N          临时切换到第 N 门课，再开始播放
  --speed=N       倍速，默认 1
  --tick=N        上报间隔秒数，默认 10
  --limit=N       最多处理 N 个视频
  --objectid=X    只处理指定视频
  --dry           只打印计划，不实际上报
  --debug         打印 uid、rt、进度和服务端原始返回
  -h, --help      显示本帮助

示例:
  hsc play --all --speed=10 --tick=10
  hsc play --id=3 --all --speed=10
  hsc play --limit=1 --debug`,

	"doc": `用法: hsc doc [--all] [--limit=N] [--id=N]

完成文档和图片任务点（打开即算完成）。

选项:
  --all         处理全部未完成的文档
  --limit=N     最多处理 N 个
  --id=N        临时切换到第 N 门课
  -h, --help    显示本帮助

示例:
  hsc doc --all`,

	"quiz": `用法: hsc quiz <dump|solve|submit|peek> [--id=N] [--only=N]

测验与练习题。

子命令:
  dump      抓题，写 state/quizzes.json 和 state/quiz-readable.txt
  solve     调 [llm] 配置的接口自动作答，写 state/answers.json
  submit    按 answers.json 交卷（只交未完成的）
  peek      查看已有批阅结果
  bank      查看或清空题库缓存

选项:
  --id=N      临时切换到第 N 门课
  --only=N    只处理第 N 份测验（dump/solve/submit/peek 都支持）
  -h, --help  显示本帮助

题库缓存:
  solve 会把答过的题存到 state/qbank.json，重刷同一门课直接命中，不再调接口。
  选项类题存的是选项文本，题库复用时会按文本反查当前字母，选项乱序也不会错。

示例:
  hsc quiz dump
  hsc quiz solve --only=0
  hsc quiz solve --no-cache
  hsc quiz bank
  hsc quiz submit`,

	"captcha-test": `用法: hsc captcha-test

用 data/captcha-model.json 里的标注样本测验证码识别准确率。
改识别算法后用它确认没退化。

选项:
  -h, --help   显示本帮助

示例:
  hsc captcha-test`,

	"version": `用法: hsc version

打印版本号。

选项:
  -h, --help   显示本帮助

示例:
  hsc version`,
}

// wantsHelp 判断参数里有没有 -h / --help
func wantsHelp(args []string) bool {
	for _, a := range args {
		if a == "-h" || a == "--help" {
			return true
		}
	}
	return false
}

// printCommandHelp 打印某个命令的帮助，命令不存在时返回 false
func printCommandHelp(cmd string) bool {
	text, ok := commandHelp[cmd]
	if !ok {
		return false
	}
	fmt.Println(strings.TrimRight(text, "\n"))
	return true
}

// helpTopics 给 hsc help 用
func helpTopics() string {
	var b strings.Builder
	b.WriteString("可用命令:\n")
	for _, k := range []string{
		"login-qr", "login-pw", "check", "logout", "cred", "config",
		"init", "course", "scan", "play", "doc", "quiz",
		"captcha-test", "version",
	} {
		b.WriteString("  " + k + "\n")
	}
	b.WriteString("\n查看某个命令的详细用法: hsc help <命令>  或  hsc <命令> --help\n")
	return b.String()
}
