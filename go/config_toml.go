package main

import (
	"fmt"
	"os"
	"strings"

	"github.com/BurntSushi/toml"
)

// 配置文件固定放在 state/config.toml，第一次用的时候自动生成
const configName = "config.toml"

type LLMConfig struct {
	Enabled        bool    `toml:"enabled"`
	BaseURL        string  `toml:"base_url"`
	APIKey         string  `toml:"api_key"`
	Model          string  `toml:"model"`
	Temperature    float64 `toml:"temperature"`
	MaxTokens      int     `toml:"max_tokens"`
	TimeoutSeconds int     `toml:"timeout_seconds"`
}

type QuizConfig struct {
	AutoSubmit bool     `toml:"auto_submit"`
	Types      []string `toml:"types"`
	DelayMs    int      `toml:"delay_ms"`
	Retries    int      `toml:"retries"`
}

type Config struct {
	LLM  LLMConfig  `toml:"llm"`
	Quiz QuizConfig `toml:"quiz"`
}

const defaultConfigTOML = `# hsc 配置
# 自动答题（hsc quiz solve）使用 [llm] 里的接口，格式兼容 OpenAI

[llm]
# 改成 true 才会真正调用接口
enabled = false
base_url = "https://api.openai.com/v1"
api_key = ""
model = "gpt-4o-mini"
temperature = 0.2
max_tokens = 4096
timeout_seconds = 60

[quiz]
# solve 完成后是否直接交卷
auto_submit = false
# 参与自动作答的题型：choice=单选 multi=多选 judge=判断 fill=填空 essay=简答
types = ["choice", "multi", "judge", "fill"]
# 每题之间的间隔，避免触发限流
delay_ms = 300
# 单题失败重试次数
retries = 2
`

// configPath state/config.toml
func configPath() string { return statePath(configName) }

// ensureConfig 文件不存在就写一份默认配置，返回是否新建
func ensureConfig() (bool, error) {
	if fileExists(configPath()) {
		return false, nil
	}
	if err := os.WriteFile(configPath(), []byte(defaultConfigTOML), 0o600); err != nil {
		return false, err
	}
	return true, nil
}

// loadConfig 读取配置；文件缺失时先按默认值生成
func loadConfig() (*Config, bool, error) {
	created, err := ensureConfig()
	if err != nil {
		return nil, false, err
	}
	var c Config
	if _, err := toml.DecodeFile(configPath(), &c); err != nil {
		return nil, created, fmt.Errorf("state/%s 解析失败: %w", configName, err)
	}
	if c.LLM.BaseURL == "" {
		c.LLM.BaseURL = "https://api.openai.com/v1"
	}
	if c.LLM.Model == "" {
		c.LLM.Model = "gpt-4o-mini"
	}
	if c.LLM.MaxTokens <= 0 {
		c.LLM.MaxTokens = 4096
	}
	if c.LLM.TimeoutSeconds <= 0 {
		c.LLM.TimeoutSeconds = 60
	}
	if c.Quiz.DelayMs <= 0 {
		c.Quiz.DelayMs = 300
	}
	if len(c.Quiz.Types) == 0 {
		c.Quiz.Types = []string{"choice", "multi", "judge", "fill"}
	}
	return &c, created, nil
}

// cmdConfig 查看或初始化配置
func cmdConfig(args []string) error {
	sub := "show"
	if len(args) > 0 {
		sub = args[0]
	}
	switch sub {
	case "init", "new", "reset":
		if fileExists(configPath()) && sub == "new" {
			return fmt.Errorf("state/%s 已存在", configName)
		}
		if err := os.WriteFile(configPath(), []byte(defaultConfigTOML), 0o600); err != nil {
			return err
		}
		fmt.Printf("已生成 %s\n", configPath())
		return nil
	case "show", "":
		c, created, err := loadConfig()
		if err != nil {
			return err
		}
		if created {
			fmt.Printf("首次运行，已生成默认配置 %s\n\n", configPath())
		}
		fmt.Printf("配置文件: %s\n\n", configPath())
		fmt.Println("[llm]")
		fmt.Printf("  enabled   = %v\n", c.LLM.Enabled)
		fmt.Printf("  base_url  = %s\n", c.LLM.BaseURL)
		fmt.Printf("  api_key   = %s\n", maskKey(c.LLM.APIKey))
		fmt.Printf("  model     = %s\n", c.LLM.Model)
		fmt.Printf("  temperature = %.2f\n", c.LLM.Temperature)
		fmt.Printf("  max_tokens  = %d\n", c.LLM.MaxTokens)
		fmt.Println("\n[quiz]")
		fmt.Printf("  auto_submit = %v\n", c.Quiz.AutoSubmit)
		fmt.Printf("  types       = %s\n", strings.Join(c.Quiz.Types, ", "))
		fmt.Printf("  delay_ms    = %d\n", c.Quiz.DelayMs)
		if !c.LLM.Enabled || c.LLM.APIKey == "" {
			fmt.Println("\n自动答题未启用：把 [llm] 里的 enabled 改成 true 并填好 api_key")
		}
		return nil
	default:
		return fmt.Errorf("未知子命令 %q，可用: show / init / new", sub)
	}
}

func maskKey(k string) string {
	if k == "" {
		return "(未填写)"
	}
	r := []rune(k)
	if len(r) <= 8 {
		return "****"
	}
	return string(r[:4]) + "****" + string(r[len(r)-4:])
}
