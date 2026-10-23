package main

import (
	"crypto/md5"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Client 包一层 http.Client：不自动跟随重定向（要逐跳看 Location），带 cookie 罐
type Client struct {
	hc  *http.Client
	Jar *Jar
}

var defaultHeaders = map[string]string{
	"User-Agent":      userAgent,
	"Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
	"Accept-Language": "zh-CN,zh;q=0.9",
}

func newClient(jar *Jar) *Client {
	return &Client{
		hc: &http.Client{
			Timeout: 30 * time.Second,
			Jar:     jar, // 关键：挂上 cookie 罐，Set-Cookie（含 CASTGC）才会落进 jar
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
		Jar: jar,
	}
}

// Do 发一次请求，返回响应与 body
func (c *Client) Do(method, rawURL string, form url.Values, extra map[string]string) (*http.Response, []byte, error) {
	var body io.Reader
	if form != nil {
		body = strings.NewReader(form.Encode())
	}
	req, err := http.NewRequest(method, rawURL, body)
	if err != nil {
		return nil, nil, err
	}
	for k, v := range defaultHeaders {
		req.Header.Set(k, v)
	}
	if form != nil {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	for k, v := range extra {
		req.Header.Set(k, v)
	}
	resp, err := c.hc.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return resp, nil, err
	}
	return resp, data, nil
}

// Follow 手动跟随重定向，返回最终响应、最终 URL 与 body
func (c *Client) Follow(rawURL string, extra map[string]string) (*http.Response, string, []byte, error) {
	cur := rawURL
	for i := 0; i < 12; i++ {
		resp, data, err := c.Do(http.MethodGet, cur, nil, extra)
		if err != nil {
			return nil, cur, nil, err
		}
		loc := resp.Header.Get("Location")
		if resp.StatusCode >= 300 && resp.StatusCode < 400 && loc != "" {
			cur = resolveURL(cur, loc)
			continue
		}
		return resp, cur, data, nil
	}
	return nil, cur, nil, fmt.Errorf("重定向次数过多: %s", rawURL)
}

func resolveURL(base, loc string) string {
	if strings.HasPrefix(loc, "http://") || strings.HasPrefix(loc, "https://") {
		return loc
	}
	b, err := url.Parse(base)
	if err != nil {
		return loc
	}
	l, err := url.Parse(loc)
	if err != nil {
		return loc
	}
	return b.ResolveReference(l).String()
}

func md5Hex(s string) string {
	sum := md5.Sum([]byte(s))
	return hex.EncodeToString(sum[:])
}
