package main

import (
	"encoding/json"
	"fmt"
	"strings"
)

// cmdQuizSolve 用 LLM 自动答题，结果写进 state/answers.json
//
//	hsc quiz solve              全部待答题目
//	hsc quiz solve --only=3     只做第 3 份
//	hsc quiz solve --types=choice,judge   限定题型
func cmdQuizSolve(args []string) error {
	var only = -1
	noCache := false
	typeFilter := map[string]bool{}

	cfg, created, err := loadConfig()
	if err != nil {
		return err
	}
	if created {
		fmt.Printf("已生成默认配置 %s\n", configPath())
	}

	for _, a := range args {
		switch {
		case a == "--no-cache":
			noCache = true
		case strings.HasPrefix(a, "--only="):
			only = atoiOr(strings.TrimPrefix(a, "--only="), -1)
		case strings.HasPrefix(a, "--types="):
			for _, t := range strings.Split(strings.TrimPrefix(a, "--types="), ",") {
				if t = strings.TrimSpace(t); t != "" {
					typeFilter[t] = true
				}
			}
		}
	}

	if !cfg.LLM.Enabled {
		return fmt.Errorf("[llm] enabled = false，改 %s 后重试", configPath())
	}
	if cfg.LLM.APIKey == "" {
		return fmt.Errorf("[llm] api_key 为空，填在 %s 里", configPath())
	}

	var quizzes []Quiz
	if err := readJSON(statePath("quizzes.json"), &quizzes); err != nil {
		return fmt.Errorf("缺少 state/quizzes.json，先执行 hsc quiz dump")
	}

	// 已有答案就合并，而不是覆盖
	answers := map[string]map[string]Answer{}
	_ = readJSON(statePath("answers.json"), &answers)

	bank := loadBank()

	allowed := func(kind string) bool {
		if len(typeFilter) > 0 {
			return typeFilter[kind]
		}
		for _, t := range cfg.Quiz.Types {
			if t == kind {
				return true
			}
		}
		return false
	}

	total, ok, failed, hits := 0, 0, 0, 0
	for _, q := range quizzes {
		if only >= 0 && q.Index != only {
			continue
		}
		key := fmt.Sprint(q.Index)
		if answers[key] == nil {
			answers[key] = map[string]Answer{}
		}
		logf("[%d] %s", q.Index, truncate(q.Title, 24))

		for _, qq := range q.Questions {
			kind := questionKind(qq)
			if !allowed(kind) {
				continue
			}
			total++

			if !noCache {
				if cached, hit := answerFromBank(bank, qq, kind); hit {
					hits++
					raw, _ := jsonMarshal(cached)
					answers[key][qq.QID] = Answer(raw)
					ok++
					logf("  %s %s -> %s（题库）", qq.QID, kind, fmtAns(cached))
					continue
				}
			}

			ans, err := solveOne(cfg, qq, kind)
			if err != nil {
				failed++
				logf("  %s %v", qq.QID, err)
				continue
			}
			storeAnswer(bank, qq, kind, ans)
			raw, _ := jsonMarshal(ans)
			answers[key][qq.QID] = Answer(raw)
			ok++
			logf("  %s %s -> %v", qq.QID, kind, ans)
			sleepSec(float64(cfg.Quiz.DelayMs) / 1000.0)
		}
	}

	if err := writeJSON(statePath("answers.json"), answers); err != nil {
		return err
	}
	if err := saveBank(bank); err != nil {
		return err
	}
	logf("作答 %d 题，成功 %d（题库命中 %d），失败 %d，已写 state/answers.json", total, ok, hits, failed)

	if cfg.Quiz.AutoSubmit && only < 0 {
		logf("开始交卷…")
		return cmdQuizSubmit(-1)
	}
	if ok > 0 {
		fmt.Println("下一步：hsc quiz submit  （检查一下 answers.json 再交）")
	}
	return nil
}

// solveOne 单题作答，带重试
func solveOne(cfg *Config, q Question, kind string) (any, error) {
	prompt := buildPrompt(q, kind)
	attempts := cfg.Quiz.Retries + 1
	if attempts < 1 {
		attempts = 1
	}
	var lastErr error
	for i := 0; i < attempts; i++ {
		out, err := callLLM(&cfg.LLM, solveSystemPrompt, prompt)
		if err != nil {
			lastErr = err
			// 输出被 max_tokens 截断时自动放宽，后续题目也沿用这个上限
			if strings.Contains(err.Error(), "finish_reason=length") && cfg.LLM.MaxTokens < 8192 {
				cfg.LLM.MaxTokens *= 2
				logf("  输出被截断，max_tokens 调到 %d 重试", cfg.LLM.MaxTokens)
			}
			sleepSec(1)
			continue
		}
		ans, perr := parseAnswer(out, kind)
		if perr != nil {
			lastErr = perr
			continue
		}
		return ans, nil
	}
	return nil, lastErr
}

// fmtAns 把答案格式化成一行便于看日志
func fmtAns(ans any) string {
	if arr, ok := ans.([]string); ok {
		return "[" + strings.Join(arr, ", ") + "]"
	}
	return fmt.Sprint(ans)
}

func jsonMarshal(v any) ([]byte, error) {
	return json.Marshal(v)
}
