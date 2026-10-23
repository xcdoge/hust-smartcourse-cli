package main

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
)

var (
	reLT        = regexp.MustCompile(`name="lt"\s+value="([^"]*)"`)
	reExecution = regexp.MustCompile(`name="execution"\s+value="([^"]*)"`)
)

// captchaPage 一次登录页 + 验证码
type captchaPage struct {
	Client    *Client
	LT        string
	Execution string
	Image     []byte
}

func fetchLoginPage(c *Client) (lt, execution string, err error) {
	resp, _, body, err := c.Follow(casURL+"/login", nil)
	if err != nil {
		return "", "", err
	}
	if resp.StatusCode != 200 {
		return "", "", fmt.Errorf("登录页返回 %d", resp.StatusCode)
	}
	html := string(body)
	m1 := reLT.FindStringSubmatch(html)
	m2 := reExecution.FindStringSubmatch(html)
	if len(m1) > 1 {
		lt = m1[1]
	}
	if len(m2) > 1 {
		execution = m2[1]
	}
	return lt, execution, nil
}

func fetchCaptcha(c *Client) ([]byte, error) {
	_, data, err := c.Do("GET", casURL+"/code", nil, nil)
	if err != nil {
		return nil, err
	}
	return data, nil
}

func fetchPublicKey(c *Client) (string, error) {
	_, data, err := c.Do("POST", casURL+"/rsa", nil, nil)
	if err != nil {
		return "", err
	}
	var out struct {
		PublicKey string `json:"publicKey"`
	}
	if err := json.Unmarshal(data, &out); err != nil {
		return "", fmt.Errorf("解析 RSA 响应失败: %w (%s)", err, truncate(string(data), 80))
	}
	if out.PublicKey == "" {
		return "", fmt.Errorf("RSA 公钥为空")
	}
	return out.PublicKey, nil
}

// rsaEncryptBase64 PKCS#1 v1.5 加密后 base64
func rsaEncryptBase64(b64Key, plain string) (string, error) {
	der, err := base64.StdEncoding.DecodeString(b64Key)
	if err != nil {
		return "", err
	}
	pub, err := x509.ParsePKIXPublicKey(der)
	if err != nil {
		// 有些部署给的是 PKCS#1 格式
		if k, err2 := x509.ParsePKCS1PublicKey(der); err2 == nil {
			pub = k
		} else {
			return "", fmt.Errorf("解析公钥失败: %w", err)
		}
	}
	rsaPub, ok := pub.(*rsa.PublicKey)
	if !ok {
		return "", fmt.Errorf("公钥不是 RSA")
	}
	enc, err := encryptPKCS1v15(rsaPub, []byte(plain))
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(enc), nil
}

func newVisitorID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// visitorID 持久化复用
func visitorID() string {
	var v struct {
		VisitorID string `json:"visitorId"`
	}
	if err := readJSON(statePath("visitor.json"), &v); err == nil && v.VisitorID != "" {
		return v.VisitorID
	}
	id := newVisitorID()
	_ = writeJSON(statePath("visitor.json"), map[string]string{"visitorId": id})
	return id
}

func uaJSON() string {
	m := map[string]any{
		"ua":      userAgent,
		"browser": map[string]string{"name": "Chrome", "version": "135.0.0.0", "major": "135"},
		"cpu":     map[string]string{"architecture": "amd64"},
		"device":  map[string]string{},
		"engine":  map[string]string{"name": "Blink", "version": "135.0.0.0"},
		"os":      map[string]string{"name": "windows", "version": "10"},
	}
	b, _ := json.Marshal(m)
	return string(b)
}

// casLoginResult 登录尝试结果
type casLoginResult struct {
	OK       bool
	Redirect string // 302 的 Location
	Message  string // 失败原因
	Need2FA  bool
}

// submitLogin 提交账号密码 + 验证码
func submitLogin(c *Client, lt, execution, username, password, code string) (casLoginResult, error) {
	pub, err := fetchPublicKey(c)
	if err != nil {
		return casLoginResult{}, err
	}
	ul, err := rsaEncryptBase64(pub, username)
	if err != nil {
		return casLoginResult{}, err
	}
	pl, err := rsaEncryptBase64(pub, password)
	if err != nil {
		return casLoginResult{}, err
	}

	form := make(map[string]string)
	form["ua"] = uaJSON()
	form["visitorId"] = visitorID()
	form["rsa"] = ""
	form["ul"] = ul
	form["pl"] = pl
	form["code"] = code
	form["phoneCode"] = ""
	form["lt"] = lt
	form["execution"] = execution
	form["_eventId"] = "submit"

	values := encodeForm(form)
	resp, body, err := c.Do("POST", casURL+"/login", values, map[string]string{
		"Origin":  casOrigin,
		"Referer": casURL + "/login",
	})
	if err != nil {
		return casLoginResult{}, err
	}
	loc := resp.Header.Get("Location")
	if resp.StatusCode >= 300 && resp.StatusCode < 400 {
		return casLoginResult{OK: true, Redirect: loc}, nil
	}
	html := string(body)
	msg := extractHidden(html, "errormsghide")
	need2FA := strings.Contains(html, `id="phoneCode"`)
	if msg == "" && need2FA {
		msg = "需要企业微信验证码(2FA)"
	}
	if msg == "" {
		msg = "未知错误"
	}
	return casLoginResult{Message: msg, Need2FA: need2FA}, nil
}

func extractHidden(html, id string) string {
	re := regexp.MustCompile(`id="` + id + `">([^<]*)<`)
	m := re.FindStringSubmatch(html)
	if len(m) > 1 {
		return m[1]
	}
	return ""
}

// exchangeTicket 用已有 CAS 会话换超星的 service ticket
func exchangeTicket(c *Client) (string, error) {
	target := casURL + "/login?service=" + urlQueryEscape(ssoService)
	resp, finalURL, _, err := c.Follow(target, nil)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%d %s", resp.StatusCode, finalURL), nil
}

// verifySite 抓章节页确认登录态
func verifySite(c *Client, t Target) (chapters int, size int, err error) {
	u := fmt.Sprintf("%s/mooc-smartcourse/mooc2-ans/mycourse/studentcourse?courseid=%s&clazzid=%s",
		smartOrigin, t.CourseID, t.ClazzID)
	_, finalURL, body, err := c.Follow(u, nil)
	if err != nil {
		return 0, 0, err
	}
	if strings.Contains(finalURL, "/logout") || strings.Contains(finalURL, "passport") {
		return 0, len(body), fmt.Errorf("会话无效（被踢到 %s）", truncate(finalURL, 80))
	}
	return strings.Count(string(body), "toOld("), len(body), nil
}
