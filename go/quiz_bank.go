package main

import (
	"crypto/md5"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"
)

// 题库缓存：按 qid 记住答过的题，重刷同一门课不用再调接口。
//
// 选项类题目存的是「选中选项的文本」，复用时会按文本在当前选项里反查字母，
// 这样即使老师在后台开了选项乱序也不会答错。题干指纹用于防止 qid 被复用到别的题。
type BankEntry struct {
	Kind   string   `json:"kind"`
	Stem   string   `json:"stem"`
	Texts  []string `json:"texts,omitempty"`
	Answer string   `json:"answer,omitempty"`
}

type Bank map[string]BankEntry

func bankPath() string { return statePath("qbank.json") }

func loadBank() Bank {
	b := Bank{}
	_ = readJSON(bankPath(), &b)
	if b == nil {
		b = Bank{}
	}
	return b
}

func saveBank(b Bank) error { return writeJSON(bankPath(), b) }

// stemFingerprint 题干指纹：去空白、转小写后取 md5
func stemFingerprint(stem string) string {
	norm := strings.ToLower(strings.Join(strings.Fields(stem), ""))
	sum := md5.Sum([]byte(norm))
	return hex.EncodeToString(sum[:])
}

// normOption 选项文本归一，用于比较（容忍大小写与空白差异）
func normOption(s string) string {
	return strings.ToLower(strings.Join(strings.Fields(s), ""))
}

// letterOfText 在当前选项里找文本对应的字母
func letterOfText(q Question, text string) (string, bool) {
	want := normOption(text)
	for _, o := range q.Options {
		if normOption(o.Text) == want {
			return o.Value, true
		}
	}
	return "", false
}

// answerFromBank 命中返回答案与 true
func answerFromBank(b Bank, q Question, kind string) (any, bool) {
	e, ok := b[q.QID]
	if !ok || e.Kind != kind {
		return nil, false
	}
	if e.Stem != "" && e.Stem != stemFingerprint(q.Stem) {
		return nil, false // 同 qid 但题干变了，不认
	}

	switch kind {
	case "choice":
		if len(e.Texts) == 0 {
			return nil, false
		}
		if l, ok := letterOfText(q, e.Texts[0]); ok {
			return l, true
		}
		return nil, false
	case "multi":
		if len(e.Texts) == 0 {
			return nil, false
		}
		var letters []string
		for _, t := range e.Texts {
			l, ok := letterOfText(q, t)
			if !ok {
				return nil, false // 有一个选项找不到就不敢用
			}
			letters = append(letters, l)
		}
		sort.Strings(letters)
		return strings.Join(letters, ""), true
	case "judge":
		if e.Answer == "" {
			return nil, false
		}
		return e.Answer, true
	case "fill":
		if len(e.Texts) == 0 {
			return nil, false
		}
		out := make([]string, len(e.Texts))
		copy(out, e.Texts)
		return out, true
	default: // essay
		if e.Answer == "" {
			return nil, false
		}
		return e.Answer, true
	}
}

// storeAnswer 把作答结果写进题库
func storeAnswer(b Bank, q Question, kind string, ans any) {
	e := BankEntry{Kind: kind, Stem: stemFingerprint(q.Stem)}

	switch v := ans.(type) {
	case string:
		if kind == "choice" || kind == "multi" {
			var texts []string
			for _, l := range v {
				for _, o := range q.Options {
					if o.Value == string(l) {
						texts = append(texts, o.Text)
						break
					}
				}
			}
			if len(texts) != len(v) {
				return // 有字母对不上选项，别存
			}
			e.Texts = texts
			e.Answer = v
		} else {
			e.Answer = v
		}
	case []string:
		e.Texts = append([]string(nil), v...)
	default:
		return
	}
	b[q.QID] = e
}

// cmdQuizBank 查看或清空题库缓存
func cmdQuizBank(args []string) error {
	clear := false
	for _, a := range args {
		if a == "--clear" || a == "-c" {
			clear = true
		}
	}
	if clear {
		if err := saveBank(Bank{}); err != nil {
			return err
		}
		fmt.Println("题库缓存已清空")
		return nil
	}

	b := loadBank()
	if len(b) == 0 {
		fmt.Println("题库为空，跑 hsc quiz solve 会自动积累")
		return nil
	}
	count := map[string]int{}
	for _, e := range b {
		count[e.Kind]++
	}
	fmt.Printf("题库共 %d 题  %s\n", len(b), bankPath())
	for _, k := range []string{"choice", "multi", "judge", "fill", "essay"} {
		if n := count[k]; n > 0 {
			fmt.Printf("  %-7s %d\n", k, n)
		}
	}
	fmt.Println("\n清空: hsc quiz bank --clear    跳过缓存作答: hsc quiz solve --no-cache")
	return nil
}
