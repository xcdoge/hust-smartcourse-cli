package main

import (
	"fmt"
	"strings"
)

// cmdQuiz 子命令分发
func cmdQuiz(args []string) error {
	sub := "dump"
	only := -1
	for _, a := range args {
		switch {
		case a == "dump" || a == "submit" || a == "peek" || a == "solve":
			sub = a
		case strings.HasPrefix(a, "--only="):
			only = atoiOr(strings.TrimPrefix(a, "--only="), -1)
		}
	}
	switch sub {
	case "dump":
		return cmdQuizDump()
	case "submit":
		return cmdQuizSubmit(only)
	case "peek":
		return cmdQuizPeek(only)
	case "solve":
		return cmdQuizSolve(args)
	}
	return fmt.Errorf("未知 quiz 子命令: %s", sub)
}
