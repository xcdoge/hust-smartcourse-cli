package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

const (
	smartOrigin = "https://smartcourse.hust.edu.cn"
	casOrigin   = "https://pass.hust.edu.cn"
	casURL      = casOrigin + "/cas"
	ssoService  = "http://smartcourse.hust.edu.cn/fyportal-smartcourse/sso/hust"
	userAgent   = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36"
)

// Target 对应 state/target.json
type Target struct {
	Name     string `json:"name"`
	CourseID string `json:"courseId"`
	ClazzID  string `json:"clazzId"`
	CPI      string `json:"cpi"`
	Enc      string `json:"enc"`
}

var (
	rootDir  string
	stateDir string
)

func initPaths() error {
	wd, err := os.Getwd()
	if err != nil {
		return err
	}
	rootDir = wd
	stateDir = filepath.Join(wd, "state")
	return os.MkdirAll(stateDir, 0o755)
}

func statePath(parts ...string) string {
	return filepath.Join(append([]string{stateDir}, parts...)...)
}

func dataPath(parts ...string) string {
	return filepath.Join(append([]string{rootDir, "data"}, parts...)...)
}

func loadTarget() (Target, error) {
	var t Target
	b, err := os.ReadFile(statePath("target.json"))
	if err != nil {
		return t, fmt.Errorf("缺少课程配置 state/target.json（参考 config/target.example.json）: %w", err)
	}
	if err := json.Unmarshal(b, &t); err != nil {
		return t, fmt.Errorf("state/target.json 解析失败: %w", err)
	}
	if t.CourseID == "" || t.ClazzID == "" {
		return t, fmt.Errorf("state/target.json 里 courseId / clazzId 不能为空")
	}
	return t, nil
}

func writeJSON(path string, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o644)
}

func readJSON(path string, v any) error {
	b, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, v)
}
