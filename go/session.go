package main

import "fmt"

// loadSession 读取登录态，失败时给出可操作的提示而不是裸路径
func loadSession(c *Client) error {
	if !fileExists(statePath("cookies.json")) {
		return fmt.Errorf("未登录，先执行 hsc login-qr 或 hsc login-pw")
	}
	if err := c.Jar.Load(); err != nil {
		return fmt.Errorf("登录态损坏，重新登录一次: %w", err)
	}
	if c.Jar.Count() == 0 {
		return fmt.Errorf("cookie 为空，重新登录一次")
	}
	return nil
}
