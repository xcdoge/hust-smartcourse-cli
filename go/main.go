package main

import (
	"bufio"
	"fmt"
	"os"
	"strings"
)

const version = "1.4.0"

func usage() {
	fmt.Print(`用法: hsc <命令> [参数]

登录
  login-qr              扫码登录，二维码写入 state/login-qr.png
  login-pw [--manual]   账密登录，自动识别验证码
  login-pw --code=NNNN  手动指定验证码，配合 --manual
  check                 检查当前会话是否有效
  logout [--all]        清除登录态；--all 同时删除已存凭据
  cred <save|show|status|forget>
  config [show|init]    查看/生成 state/config.toml

课程
  init [序号|课程链接]   列出账号下的课程，按序号选课
  course                抓取课程结构：章节、视频、文档、测验
  scan                  扫描每章全部 tab，包含练习题

任务点
  play [--all] [--id=N] [--speed=N] [--tick=N] [--limit=N] [--objectid=X] [--dry] [--debug]
  doc  [--all]
  quiz <dump|solve|submit|peek|bank> [--id=N] [--only=N]

其他
  captcha-test          用标注样本测试验证码识别准确率
  version
  q                     退出

每个命令都支持 --help，例如 hsc play --help
`)
}

// runCommand 执行一条命令；返回错误，由调用方决定怎么处理
func runCommand(args []string) error {
	if len(args) == 0 {
		usage()
		return nil
	}
	cmd, rest := args[0], args[1:]

	// 任何命令加 -h/--help 都打印该命令的帮助，不进业务逻辑
	if wantsHelp(rest) {
		if !printCommandHelp(cmd) {
			return fmt.Errorf("unknown command %q, run hsc help", cmd)
		}
		return nil
	}

	switch cmd {
	case "login-qr":
		return cmdLoginQR(rest)
	case "login-pw":
		return cmdLoginPw(rest)
	case "check":
		return cmdCheck()
	case "logout":
		return cmdLogout(rest)
	case "cred":
		return cmdCred(rest)
	case "config":
		return cmdConfig(rest)
	case "init":
		return cmdInit(rest)
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
	case "help":
		// hsc help <命令> 显示单条；不带参数显示总览
		if len(rest) > 0 && printCommandHelp(rest[0]) {
			return nil
		}
		usage()
		fmt.Println()
		fmt.Print(helpTopics())
		return nil
	case "-h", "--help":
		usage()
		return nil
	default:
		return fmt.Errorf("unknown command %q, run hsc help", cmd)
	}
}

// interactiveLoop 双击 exe 时的交互模式：敲命令、回车执行，q 退出
func interactiveLoop() {
	fmt.Printf("hsc %s\n\n", version)
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
		if err := runCommand(parseArgs(line)); err != nil {
			fmt.Fprintln(os.Stderr, "hsc:", err)
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
		fmt.Fprintln(os.Stderr, "hsc:", err)
		pauseIfInteractive()
		os.Exit(1)
	}
}
