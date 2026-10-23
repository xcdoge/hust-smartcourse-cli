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
	if err := os.MkdirAll(stateDir, 0o755); err != nil {
		return err
	}
	return migrateState()
}

// state/ 下按用途分子目录，避免十几个文件平铺在一起
var stateLayout = map[string]string{
	"cookies.json":      "auth",
	"cred.enc.json":     "auth",
	"cred.txt":          "auth",
	"visitor.json":      "auth",
	"login-qr.png":      "auth",
	"target.json":       "course",
	"courses.json":      "course",
	"course.json":       "course",
	"scan.json":         "course",
	"quizzes.json":      "quiz",
	"answers.json":      "quiz",
	"qbank.json":        "quiz",
	"quiz-readable.txt": "quiz",
	"play.log":          "logs",
	"config.toml":       "", // 全局配置留在顶层
}

// migrateState 把旧的平铺文件搬进子目录；已经在新位置的跳过
func migrateState() error {
	for name, sub := range stateLayout {
		if sub == "" {
			continue
		}
		oldPath := filepath.Join(stateDir, name)
		newPath := filepath.Join(stateDir, sub, name)
		if !fileExists(oldPath) || fileExists(newPath) {
			continue
		}
		if err := os.MkdirAll(filepath.Join(stateDir, sub), 0o755); err != nil {
			return err
		}
		if err := os.Rename(oldPath, newPath); err != nil {
			return err
		}
	}
	return nil
}

func statePath(parts ...string) string {
	if len(parts) == 1 {
		if sub, ok := stateLayout[parts[0]]; ok && sub != "" {
			return filepath.Join(stateDir, sub, parts[0])
		}
	}
	return filepath.Join(append([]string{stateDir}, parts...)...)
}

func dataPath(parts ...string) string {
	return filepath.Join(append([]string{rootDir, "data"}, parts...)...)
}

// loadTargetIfExists 允许没有 target.json（登录阶段不需要课程配置）
func loadTargetIfExists() (Target, bool) {
	t, err := loadTarget()
	if err != nil {
		return Target{}, false
	}
	return t, true
}

func loadTarget() (Target, error) {
	var t Target
	b, err := os.ReadFile(statePath("target.json"))
	if err != nil {
		return t, fmt.Errorf("未配置课程，先执行 hsc init \"<课程链接>\"")
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
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
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
