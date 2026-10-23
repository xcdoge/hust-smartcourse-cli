package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

// ---------- LLM 调用 ----------

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatRequest struct {
	Model       string        `json:"model"`
	Messages    []chatMessage `json:"messages"`
	Temperature float64       `json:"temperature"`
	MaxTokens   int           `json:"max_tokens"`
}

type chatResponse struct {
	Choices []struct {
		Message struct {
			Content          string `json:"content"`
			ReasoningContent string `json:"reasoning_content"`
		} `json:"message"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

// 空内容时能说清楚原因，而不是只报「模型返回空」
func emptyReason(cr chatResponse) string {
	if len(cr.Choices) == 0 {
		return "接口没有返回 choices"
	}
	c := cr.Choices[0]
	why := "content 为空"
	if c.FinishReason != "" {
		why += "，finish_reason=" + c.FinishReason
	}
	if c.FinishReason == "length" {
		why += "（输出被 max_tokens 截断，调大 [llm] max_tokens 或换非推理模型)"
	}
	if c.Message.ReasoningContent != "" {
		why += "（只有 reasoning_content，模型把答案放在思考区了）"
	}
	return why
}

// callLLM 调 OpenAI 兼容接口，返回模型输出
func callLLM(cfg *LLMConfig, system, user string) (string, error) {
	url := strings.TrimSuffix(cfg.BaseURL, "/") + "/chat/completions"
	body, _ := json.Marshal(chatRequest{
		Model: cfg.Model,
		Messages: []chatMessage{
			{Role: "system", Content: system},
			{Role: "user", Content: user},
		},
		Temperature: cfg.Temperature,
		MaxTokens:   cfg.MaxTokens,
	})
	req, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+cfg.APIKey)

	client := &http.Client{Timeout: time.Duration(cfg.TimeoutSeconds) * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	var cr chatResponse
	if err := json.Unmarshal(data, &cr); err != nil {
		return "", fmt.Errorf("接口返回不是 JSON (HTTP %d): %s", resp.StatusCode, truncate(string(data), 120))
	}
	if cr.Error != nil && cr.Error.Message != "" {
		return "", fmt.Errorf("接口报错: %s", cr.Error.Message)
	}
	if resp.StatusCode != 200 {
		return "", fmt.Errorf("接口返回 HTTP %d: %s", resp.StatusCode, truncate(string(data), 120))
	}
	if len(cr.Choices) == 0 {
		return "", fmt.Errorf("接口没有返回 choices")
	}
	content := strings.TrimSpace(cr.Choices[0].Message.Content)
	if content == "" {
		return "", fmt.Errorf("%s", emptyReason(cr))
	}
	return content, nil
}

// ---------- 提示词 ----------

const solveSystemPrompt = `你在完成一份课程测验。只输出答案本身，不要解释，不要加引号或标点。
单选：输出一个大写字母，如 B
多选：输出连续字母，如 ABD
判断：输出 true 或 false
填空：输出 JSON 数组，每个空一项，如 ["word1","word2"]
简答：输出一段不超过 80 字的回答`

// questionKind 把题型归一成 choice / multi / judge / fill / essay
func questionKind(q Question) string {
	label := q.TypeLabel
	switch {
	case strings.Contains(label, "多选"):
		return "multi"
	case strings.Contains(label, "单选"):
		return "choice"
	case strings.Contains(label, "判断"):
		return "judge"
	case strings.Contains(label, "填空"):
		return "fill"
	case strings.Contains(label, "简答"), strings.Contains(label, "问答"):
		return "essay"
	}
	switch q.QType {
	case 0:
		return "choice"
	case 1:
		return "multi"
	case 2:
		return "fill"
	case 3:
		return "judge"
	}
	return "essay"
}

// buildPrompt 拼单题提示词
func buildPrompt(q Question, kind string) string {
	var b strings.Builder
	switch kind {
	case "choice":
		b.WriteString("题型：单选题\n")
	case "multi":
		b.WriteString("题型：多选题（可能有多个正确答案）\n")
	case "judge":
		b.WriteString("题型：判断题\n")
	case "fill":
		fmt.Fprintf(&b, "题型：填空题（%d 个空）\n", max(1, q.BlankCount))
	case "essay":
		b.WriteString("题型：简答题\n")
	}
	b.WriteString("题目：")
	b.WriteString(q.Stem)
	b.WriteString("\n")
	if len(q.Options) > 0 {
		b.WriteString("选项：\n")
		for _, o := range q.Options {
			fmt.Fprintf(&b, "%s. %s\n", o.Value, o.Text)
		}
	}
	return b.String()
}

var (
	reLetters = regexp.MustCompile(`[A-Z]`)
	reJSONArr = regexp.MustCompile(`(?s)\[.*\]`)
)

// parseAnswer 把模型输出归一成 answers.json 需要的形态
func parseAnswer(raw, kind string) (any, error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return nil, fmt.Errorf("模型返回空")
	}
	// 去掉常见的包裹
	s = strings.Trim(s, "`\"' \n\r\t")
	if i := strings.IndexAny(s, "\n"); i > 0 && kind != "fill" {
		s = strings.TrimSpace(s[:i])
	}

	switch kind {
	case "choice":
		if m := reLetters.FindString(s); m != "" {
			return m, nil
		}
		return nil, fmt.Errorf("无法解析单选项: %q", truncate(s, 40))
	case "multi":
		letters := reLetters.FindAllString(s, -1)
		if len(letters) == 0 {
			return nil, fmt.Errorf("无法解析多选项: %q", truncate(s, 40))
		}
		// 去重并按字母序
		seen := map[string]bool{}
		var out []string
		for _, l := range letters {
			if !seen[l] {
				seen[l] = true
				out = append(out, l)
			}
		}
		return strings.Join(out, ""), nil
	case "judge":
		low := strings.ToLower(s)
		if strings.Contains(low, "true") || strings.Contains(low, "对") || strings.Contains(low, "正确") {
			return "true", nil
		}
		if strings.Contains(low, "false") || strings.Contains(low, "错") || strings.Contains(low, "错误") {
			return "false", nil
		}
		return nil, fmt.Errorf("无法解析判断项: %q", truncate(s, 40))
	case "fill":
		if m := reJSONArr.FindString(s); m != "" {
			var arr []string
			if err := json.Unmarshal([]byte(m), &arr); err == nil && len(arr) > 0 {
				return arr, nil
			}
		}
		// 退化：按常见分隔符切
		parts := strings.FieldsFunc(s, func(r rune) bool {
			return r == ',' || r == '，' || r == ';' || r == '；' || r == '|' || r == '\n'
		})
		var out []string
		for _, p := range parts {
			if t := strings.TrimSpace(p); t != "" {
				out = append(out, t)
			}
		}
		if len(out) == 0 {
			return nil, fmt.Errorf("无法解析填空项: %q", truncate(s, 40))
		}
		return out, nil
	default: // essay
		return s, nil
	}
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
