package main

import (
	"fmt"
	"strings"
)

// cmdQuiz 子命令分发
func cmdQuiz(args []string) error {
	sub := "dump"
	only := -1
	courseID := 0
	for _, a := range args {
		switch {
		case a == "dump" || a == "submit" || a == "peek" || a == "solve" || a == "bank":
			sub = a
		case strings.HasPrefix(a, "--id="):
			courseID = atoiOr(strings.TrimPrefix(a, "--id="), 0)
		case strings.HasPrefix(a, "--only="):
			only = atoiOr(strings.TrimPrefix(a, "--only="), -1)
		}
	}
	// --id 先切课程，后续子命令自然用新的 target
	if courseID > 0 {
		c := newClient(NewJar())
		if err := loadSession(c); err != nil {
			return err
		}
		if _, err := switchCourse(c, courseID); err != nil {
			return err
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
	case "bank":
		return cmdQuizBank(args)
	}
	return fmt.Errorf("未知 quiz 子命令: %s", sub)
}
