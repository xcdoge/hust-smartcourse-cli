package main

import (
	"fmt"
	"os"
)

// cmdLogout 退出登录
//
//	hsc logout         只清登录态（cookie），保留加密凭据
//	hsc logout --all   连凭据一起清掉（等于彻底登出 + 忘掉账号）
func cmdLogout(args []string) error {
	all := false
	for _, a := range args {
		if a == "--all" || a == "-a" {
			all = true
		}
	}

	// ① 有会话的话，顺带通知 CAS 注销（失败不影响本地清理）
	jar := NewJar()
	if err := jar.Load(); err == nil && jar.Count() > 0 {
		c := newClient(jar)
		if resp, _, _, err := c.Follow(casURL+"/logout", nil); err == nil {
			fmt.Printf("已注销 CAS 会话 (HTTP %d)\n", resp.StatusCode)
		}
	}

	// ② 删除本地登录态
	var removed []string
	if fileExists(statePath("cookies.json")) {
		if os.Remove(statePath("cookies.json")) == nil {
			removed = append(removed, "cookies.json")
		}
	}
	if fileExists(statePath("visitor.json")) {
		if os.Remove(statePath("visitor.json")) == nil {
			removed = append(removed, "visitor.json")
		}
	}

	// ③ --all：连凭据一起清
	if all {
		for _, f := range forgetCreds() {
			removed = append(removed, f)
		}
	}

	if len(removed) == 0 {
		fmt.Println("无登录态可清除")
		return nil
	}
	fmt.Println("已清除: " + joinStrings(removed, ", "))
	if !all {
		fmt.Println("凭据保留，下次 login-pw 可直接用；要一并删除用 --all")
	}
	return nil
}
