package main

import (
	"bufio"
	"fmt"
	"os"
	"strings"
)

const version = "1.1.0"

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
  q                     退出交互模式
`)
}

// runCommand 执行一条命令；返回错误，由调用方决定怎么处理
func runCommand(args []string) error {
	if len(args) == 0 {
		usage()
		return nil
	}
	cmd, rest := args[0], args[1:]
	switch cmd {
	case "login-qr":
		return cmdLoginQR(rest)
	case "login-pw":
		return cmdLoginPw(rest)
	case "check":
		return cmdCheck()
	case "cred":
		return cmdCred(rest)
	case "course":
		return cmdCourse()
	case "scan":
		return cmdScan()
	case "doc":
		return cmdDoc(rest)
	case "play":
		return cmdPlay(rest)
	case "quiz":
		return cmdQuiz(rest)
	case "captcha-test":
		return cmdCaptchaTest()
	case "version", "-v", "--version":
		fmt.Printf("hsc %s\n", version)
		return nil
	case "help", "-h", "--help":
		usage()
		return nil
	default:
		return fmt.Errorf("未知命令: %s（输入 help 看用法）", cmd)
	}
}

// interactiveLoop 双击 exe 时的交互模式：敲命令、回车执行，q 退出
func interactiveLoop() {
	fmt.Printf("hsc %s —— 交互模式（输入 help 看命令，输入 q 退出）\n\n", version)
	usage()
	reader := bufio.NewReader(os.Stdin)
	for {
		fmt.Print("\nhsc> ")
		line, err := reader.ReadString('\n')
		if err != nil {
			return
		}
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if line == "q" || line == "quit" || line == "exit" {
			return
		}
		if err := runCommand(strings.Fields(line)); err != nil {
			fmt.Fprintln(os.Stderr, "✘", err)
		}
	}
}

func main() {
	if err := initPaths(); err != nil {
		fmt.Fprintln(os.Stderr, "初始化失败:", err)
		os.Exit(1)
	}
	args := os.Args[1:]

	// 双击 exe（无参数 + 真终端）→ 进交互模式，窗口不会一闪而过
	if len(args) == 0 {
		if isInteractive() {
			interactiveLoop()
			return
		}
		usage()
		return
	}

	if err := runCommand(args); err != nil {
		fmt.Fprintln(os.Stderr, "✘", err)
		pauseIfInteractive()
		os.Exit(1)
	}
}
