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
			fmt.Printf("已通知 CAS 注销（HTTP %d）\n", resp.StatusCode)
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
		fmt.Println("— 本来就没有登录态")
		return nil
	}
	fmt.Println("✔ 已退出登录，删除: " + joinStrings(removed, ", "))
	if !all {
		fmt.Println("  （加密凭据仍保留，下次直接 hsc login-pw；要一并清除用 hsc logout --all）")
	}
	return nil
}
