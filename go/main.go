package main

import (
	"fmt"
	"os"
)

func usage() {
	fmt.Print(`hsc —— 智慧华中大课程平台 任务点自动化 CLI

用法: hsc <命令> [参数]

登录
  login-qr              扫码登录（生成 state/login-qr.png，企业微信扫）
  login-pw [--manual]   账密登录（内置验证码识别，失败自动换图重试）
  login-pw --code=1234  配合 --manual：带验证码提交
  check                 会话体检
  cred <save|show|status|forget>

课程
  course                抓课程结构（章节/视频/文档/测验）
  scan                  逐 tab 全量扫描（含练习题）

任务点
  play [--all] [--speed=10] [--tick=10] [--limit=N] [--objectid=X] [--dry]
  doc  [--all]
  quiz <dump|submit|peek> [--only=N]

其他
  captcha-test          用标注样本验证验证码识别准确率
  version
`)
}

func main() {
	if err := initPaths(); err != nil {
		fmt.Fprintln(os.Stderr, "初始化失败:", err)
		os.Exit(1)
	}
	args := os.Args[1:]
	if len(args) == 0 {
		usage()
		return
	}
	cmd := args[0]

	var err error
	switch cmd {
	case "login-qr":
		err = cmdLoginQR(args[1:])
	case "login-pw":
		err = cmdLoginPw(args[1:])
	case "check":
		err = cmdCheck()
	case "cred":
		err = cmdCred(args[1:])
	case "course":
		err = cmdCourse()
	case "scan":
		err = cmdScan()
	case "doc":
		err = cmdDoc(args[1:])
	case "play":
		err = cmdPlay(args[1:])
	case "quiz":
		err = cmdQuiz(args[1:])
	case "captcha-test":
		err = cmdCaptchaTest()
	case "version", "-v", "--version":
		fmt.Println("hsc 1.0.0")
	case "help", "-h", "--help":
		usage()
	default:
		fmt.Fprintf(os.Stderr, "未知命令: %s\n\n", cmd)
		usage()
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "✘", err)
		os.Exit(1)
	}
}
