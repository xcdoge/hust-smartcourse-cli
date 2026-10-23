package main

import (
	"fmt"
	"net/url"
	"strings"
)

// cmdInit 生成 state/target.json
//
//	hsc init                     写一份模板，提示手动填
//	hsc init "<课程链接>"         从 URL 里自动解析 courseid/clazzid/cpi/enc
//	hsc init --courseid=X --clazzid=Y --cpi=Z [--enc=W]
func cmdInit(args []string) error {
	t := Target{}

	for _, a := range args {
		a = trimQuotes(a)
		if strings.HasPrefix(a, "http://") || strings.HasPrefix(a, "https://") {
			u, err := url.Parse(a)
			if err != nil {
				return fmt.Errorf("链接解析失败: %w", err)
			}
			q := u.Query()
			t.CourseID = firstNonEmpty(q.Get("courseid"), q.Get("courseId"))
			t.ClazzID = firstNonEmpty(q.Get("clazzid"), q.Get("clazzId"))
			t.CPI = q.Get("cpi")
			t.Enc = q.Get("enc")
			continue
		}
		for _, kv := range []struct {
			prefix string
			field  *string
		}{
			{"--courseid=", &t.CourseID},
			{"--clazzid=", &t.ClazzID},
			{"--cpi=", &t.CPI},
			{"--enc=", &t.Enc},
			{"--name=", &t.Name},
		} {
			if strings.HasPrefix(a, kv.prefix) {
				*kv.field = strings.TrimPrefix(a, kv.prefix)
			}
		}
	}

	if err := writeJSON(statePath("target.json"), t); err != nil {
		return err
	}

	if t.CourseID == "" || t.ClazzID == "" {
		fmt.Println("state/target.json 已生成，courseId / clazzId 为空")
		fmt.Println()
		fmt.Println("补全方式：")
		fmt.Println("  hsc init \"<课程链接>\"")
		fmt.Println(`  例: hsc init "https://smartcourse.hust.edu.cn/...?courseid=...&clazzid=...&cpi=..."`)
		fmt.Println("  hsc init --courseid=... --clazzid=... --cpi=... --enc=...")

		fmt.Println()
		fmt.Println("参数取自浏览器地址栏。")
		return nil
	}

	fmt.Printf("state/target.json 已写入\n  courseId = %s\n  clazzId  = %s\n  cpi      = %s\n",
		t.CourseID, t.ClazzID, firstNonEmpty(t.CPI, "-"))
	fmt.Println("\n接下来: hsc course")
	return nil
}
