package main

import (
	"fmt"
)

// cmdQuizPeek 查看某一份作业的批阅页
func cmdQuizPeek(only int) error {
	var quizzes []Quiz
	if err := readJSON(statePath("quizzes.json"), &quizzes); err != nil {
		return fmt.Errorf("先跑 hsc quiz dump: %w", err)
	}
	for _, q := range quizzes {
		if only >= 0 && q.Index != only {
			continue
		}
		_, finalURL, body, err := c0Follow(q.PageURL, "")
		if err != nil {
			return err
		}
		title := ""
		if m := reTitlePage.FindStringSubmatch(string(body)); m != nil {
			title = m[1]
		}
		fmt.Printf("[%d] %s | %s | %d 字节\n", q.Index, q.Title, title, len(body))
		_ = finalURL
	}
	return nil
}
