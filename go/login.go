package main

import "fmt"

// cmdLogin 统一的登录入口
//
//	hsc login              扫码（默认）
//	hsc login --qr         扫码
//	hsc login --pw         账号密码
//	hsc login --pw --manual [--code=NNNN]
func cmdLogin(args []string) error {
	pw, qr := false, false
	for _, a := range args {
		switch a {
		case "--pw", "-p", "--password":
			pw = true
		case "--qr", "-q":
			qr = true
		}
	}
	if pw && qr {
		return fmt.Errorf("--pw 和 --qr 只能选一个")
	}
	if pw {
		return cmdLoginPw(args)
	}
	return cmdLoginQR(args)
}
