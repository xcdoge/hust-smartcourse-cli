package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	qrcode "github.com/skip2/go-qrcode"
)

const (
	maxLoginAttempts = 4
	minCaptchaConf   = 0.05
)

func newLoggedClient() *Client {
	return newClient(NewJar())
}

// finishLogin 换票 + 验证 + 保存 cookie
func finishLogin(c *Client, t Target) error {
	status, err := exchangeTicket(c)
	if err != nil {
		return err
	}
	chapters, size, err := verifySite(c, t)
	if err != nil {
		return err
	}
	if err := c.Jar.Save(); err != nil {
		return err
	}
	fmt.Printf("✔ 登录成功 | 换票 %s | 章节页 %d 字节 / %d 个章节 | cookie 已写 state/cookies.json\n",
		truncate(status, 60), size, chapters)
	if chapters == 0 {
		return fmt.Errorf("章节页没解析到章节，可能课程参数不对")
	}
	return nil
}

// cmdLoginPw 账密登录（自动识别验证码 + 重试）
func cmdLoginPw(args []string) error {
	t, err := loadTarget()
	if err != nil {
		return err
	}
	creds, err := loadCreds()
	if err != nil {
		return err
	}

	codeFlag := ""
	manual := false
	for _, a := range args {
		if strings.HasPrefix(a, "--code=") {
			codeFlag = strings.TrimPrefix(a, "--code=")
		}
		if a == "--manual" {
			manual = true
		}
		if a == "--save" {
			defer func() {}()
		}
	}

	c := newLoggedClient()
	lt, execution, err := fetchLoginPage(c)
	if err != nil {
		return err
	}
	img, err := fetchCaptcha(c)
	if err != nil {
		return err
	}
	ext := "gif"
	if len(img) < 3 || string(img[:3]) != "GIF" {
		ext = "png"
	}
	_ = os.WriteFile(statePath("login-captcha."+ext), img, 0o644)

	if manual || codeFlag != "" {
		code := codeFlag
		if code == "" {
			res, rerr := recognizeCaptcha(img)
			if rerr == nil {
				fmt.Printf("（自动识别: %s conf=%.3f，仅供参照）\n", res.Code, res.Conf)
			}
			fmt.Printf("验证码已存 state/login-captcha.%s，请运行: hsc login-pw --code=XXXX\n", ext)
			return nil
		}
		res, err := submitLogin(c, lt, execution, creds.Username, creds.Password, code)
		if err != nil {
			return err
		}
		if !res.OK {
			return fmt.Errorf("提交失败: %s", res.Message)
		}
		return finishLogin(c, t)
	}

	for attempt := 1; attempt <= maxLoginAttempts; attempt++ {
		if attempt > 1 {
			c = newLoggedClient()
			lt, execution, err = fetchLoginPage(c)
			if err != nil {
				return err
			}
			img, err = fetchCaptcha(c)
			if err != nil {
				return err
			}
		}
		res, rerr := recognizeCaptcha(img)
		if rerr != nil {
			logf("第 %d 次 | 识别失败: %v", attempt, rerr)
			continue
		}
		logf("第 %d 次 | 识别 %s conf=%.3f 位数=%d", attempt, res.Code, res.Conf, res.Count)
		if res.Count != 4 || res.Conf < minCaptchaConf {
			logf("   置信度/位数不足，换一张")
			continue
		}
		out, err := submitLogin(c, lt, execution, creds.Username, creds.Password, res.Code)
		if err != nil {
			return err
		}
		if !out.OK {
			logf("   服务端拒绝: %s", out.Message)
			if out.Need2FA {
				return fmt.Errorf("该账号需要企业微信二次验证，暂不支持自动处理")
			}
			continue
		}
		return finishLogin(c, t)
	}
	return fmt.Errorf("多次尝试未成功")
}

// cmdLoginQR 扫码登录
func cmdLoginQR(args []string) error {
	t, err := loadTarget()
	if err != nil {
		return err
	}
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return err
	}
	uuid := hex.EncodeToString(buf)
	content := casURL + "/qyQrLogin?uuid=" + uuid + "&service="
	qrPath := statePath("login-qr.png")
	if err := qrcode.WriteFile(content, qrcode.Medium, 320, qrPath); err != nil {
		return fmt.Errorf("生成二维码失败: %w", err)
	}
	fmt.Printf("二维码已生成: %s\n请用「企业微信 / 华中大微校园」扫码…（最多等 3 分钟）\n", qrPath)

	c := newLoggedClient()
	redirect := ""
	for i := 1; i <= 60; i++ {
		u := fmt.Sprintf("%s/checkQRCodeScan?random=%d&uuid=%s", casURL, nowNano()/1e9, uuid)
		_, _, body, err := c.Follow(u, map[string]string{
			"X-Requested-With": "XMLHttpRequest",
			"Accept":           "application/json, text/javascript, */*; q=0.01",
			"Referer":          casURL + "/login",
		})
		if err != nil {
			logf("  第 %d 次请求异常: %v", i, err)
		} else if len(strings.TrimSpace(string(body))) > 0 {
			var r struct {
				RedirectURL string `json:"redirect_url"`
			}
			if json.Unmarshal(body, &r) == nil && r.RedirectURL != "" {
				logf("  第 %d 次: 拿到 redirect_url", i)
				redirect = r.RedirectURL
				break
			}
		} else if i%5 == 0 {
			logf("  第 %d 次: 等待扫码…", i)
		}
		sleepSec(3)
	}
	if redirect == "" {
		return fmt.Errorf("3 分钟内没等到扫码结果")
	}
	if _, _, _, err := c.Follow(redirect, nil); err != nil {
		return fmt.Errorf("兑票失败: %w", err)
	}
	return finishLogin(c, t)
}

// cmdCheck 会话体检
func cmdCheck() error {
	t, err := loadTarget()
	if err != nil {
		return err
	}
	c := newClient(NewJar())
	if err := c.Jar.Load(); err != nil {
		return fmt.Errorf("读取 state/cookies.json 失败: %w", err)
	}
	chapters, size, err := verifySite(c, t)
	if err != nil {
		return err
	}
	fmt.Printf("SESSION_OK ✔ 章节页 %d 字节 | 章节 %d 个\n", size, chapters)
	return nil
}
