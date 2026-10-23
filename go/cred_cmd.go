package main

import (
	"fmt"
	"os"
)

// cmdCred 凭据管理
func cmdCred(args []string) error {
	sub := ""
	if len(args) > 0 {
		sub = args[0]
	}
	switch sub {
	case "save":
		if len(args) >= 3 {
			u, p := args[1], args[2]
			if err := saveCreds(u, p); err != nil {
				return err
			}
			fmt.Printf("已保存 state/%s (账号 %s)\n", encCredFile, maskUser(u))
			return nil
		}
		ok, err := migratePlainCreds()
		if err != nil {
			return err
		}
		if ok {
			fmt.Println("已迁移 cred.txt 为加密文件，明文已删除")
			return credStatus()
		}
		return fmt.Errorf("没有可迁移的明文；用法: hsc cred save <学号> <密码>")
	case "show":
		c, err := loadCreds()
		if err != nil {
			return err
		}
		src := "明文 cred.txt"
		if c.Source == "enc" {
			src = "加密文件"
		}
		fmt.Printf("来源: %s\n账号: %s\n密码: %s\n", src, c.Username, c.Password)
		return nil
	case "", "status":
		return credStatus()
	case "forget":
		removed := forgetCreds()
		if len(removed) == 0 {
			fmt.Println("— 本来就没有凭据文件")
			return nil
		}
		fmt.Println("已删除: " + joinStrings(removed, ", "))
		return nil
	default:
		return fmt.Errorf("未知子命令: %s（可用 save/show/status/forget）", sub)
	}
}

func credStatus() error {
	encExists := fileExists(statePath(encCredFile))
	plainExists := fileExists(statePath(txtCredFile))
	fmt.Printf("加密凭据 state/%-14s %s\n", encCredFile, boolMark(encExists, "存在", "无"))
	fmt.Printf("明文凭据 state/%-14s %s\n", txtCredFile, boolMark(plainExists, "存在（建议迁移）", "无"))
	if encExists {
		if _, err := loadEncryptedCreds(); err == nil {
			var cf credFile
			_ = readJSON(statePath(encCredFile), &cf)
			fmt.Printf("  保存于 %s  账号 %s\n", cf.SavedAt, cf.User)
			fmt.Println("  可解密 : 是")
		} else {
			fmt.Println("  可解密 : 否（换机器/换用户/被改过）")
		}
	}
	return nil
}

func boolMark(cond bool, yes, no string) string {
	if cond {
		return yes
	}
	return no
}

func fileExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

func joinStrings(items []string, sep string) string {
	out := ""
	for i, s := range items {
		if i > 0 {
			out += sep
		}
		out += s
	}
	return out
}
