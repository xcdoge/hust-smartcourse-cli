package main

import (
	"bufio"
	"fmt"
	"os"
)

// isInteractive 判断是不是在真实终端里跑（双击 exe / 开 cmd 窗口 = 是；管道/重定向 = 否）
func isInteractive() bool {
	if os.Getenv("HSC_FORCE_TTY") != "" {
		return true // 调试用：强制走交互路径
	}
	fi, err := os.Stdin.Stat()
	if err != nil {
		return false
	}
	return fi.Mode()&os.ModeCharDevice != 0
}

// pauseIfInteractive 双击运行时窗口不会一闪而过
func pauseIfInteractive() {
	if !isInteractive() {
		return
	}
	fmt.Print("\n按回车键退出…")
	_, _ = bufio.NewReader(os.Stdin).ReadString('\n')
}
