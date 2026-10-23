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
		fmt.Println("✔ 已生成 state/target.json（还是空的，需要你填）")
		fmt.Println()
		fmt.Println("两种填法：")
		fmt.Println("  ① 直接把课程链接丢给它，自动解析：")
		fmt.Println(`     hsc init "https://smartcourse.hust.edu.cn/.../mycourse/stu?courseid=...&clazzid=...&cpi=..."`)
		fmt.Println("  ② 手动编辑 state/target.json：")
		fmt.Println(`     { "courseId": "...", "clazzId": "...", "cpi": "...", "enc": "..." }`)
		fmt.Println()
		fmt.Println("这些参数都在浏览器打开课程时的地址栏里。")
		return nil
	}

	fmt.Printf("✔ 已写入 state/target.json\n  courseId = %s\n  clazzId  = %s\n  cpi      = %s\n",
		t.CourseID, t.ClazzID, firstNonEmpty(t.CPI, "(空)"))
	fmt.Println("\n下一步：hsc course  然后 hsc scan")
	return nil
}
