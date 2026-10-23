package main

import (
	"fmt"
	"net/url"
	"strconv"
	"strings"
)

// cmdInit 选课
//
//	hsc init             列出账号下所有课程
//	hsc init <序号>       选第 N 门课（自动抓结构）
//	hsc init "<课程链接>"  从 URL 解析参数
//	hsc init --refresh   强制重新拉课程列表
func cmdInit(args []string) error {
	refresh := false
	noScan := false
	var positional []string
	for _, a := range args {
		if a == "--refresh" || a == "-r" {
			refresh = true
			continue
		}
		if a == "--no-scan" {
			noScan = true
			continue
		}
		positional = append(positional, trimQuotes(a))
	}

	c := newClient(NewJar())
	hasSession := loadSession(c) == nil

	// ① 带课程链接：直接解析，不需要列表
	if len(positional) > 0 && (strings.HasPrefix(positional[0], "http://") || strings.HasPrefix(positional[0], "https://")) {
		t := targetFromURL(positional[0])
		if t.CourseID == "" || t.ClazzID == "" {
			return fmt.Errorf("链接里没有 courseid / clazzid")
		}
		if err := writeJSON(statePath("target.json"), t); err != nil {
			return err
		}
		fmt.Printf("已选择课程\n  courseId = %s\n  clazzId  = %s\n  cpi      = %s\n", t.CourseID, t.ClazzID, firstNonEmpty(t.CPI, "-"))
		fmt.Println("\n接下来: hsc course")
		return nil
	}

	// ② 带序号：切课程
	if len(positional) > 0 {
		n, err := strconv.Atoi(positional[0])
		if err != nil {
			return fmt.Errorf("参数 %q 既不是序号也不是课程链接", positional[0])
		}
		if !hasSession {
			return fmt.Errorf("未登录，先执行 hsc login-qr 或 hsc login-pw")
		}
		_, err = switchCourseOpt(c, n, !noScan)
		return err
	}

	// ③ 无参数：列课程
	if !hasSession {
		return fmt.Errorf("未登录，先执行 hsc login-qr 或 hsc login-pw")
	}
	// 列表一定要现拉：缓存里的顺序可能已经变了（退课/加课），
	// 而紧接着的 `init <序号>` 会刷新，两边不一致就会切错课
	list, err := loadCourseList(c, true)
	if err != nil {
		return err
	}
	_ = refresh
	cur, _ := loadTargetIfExists()
	fmt.Printf("共 %d 门课程\n\n", len(list))
	printCourseList(list, cur)
	fmt.Println("\n选课: hsc init <序号>    重新拉列表: hsc init --refresh")
	return nil
}

// targetFromURL 从课程链接里抠出参数
func targetFromURL(raw string) Target {
	t := Target{}
	u, err := url.Parse(raw)
	if err != nil {
		return t
	}
	q := u.Query()
	t.CourseID = firstNonEmpty(q.Get("courseid"), q.Get("courseId"))
	t.ClazzID = firstNonEmpty(q.Get("clazzid"), q.Get("clazzId"))
	t.CPI = q.Get("cpi")
	t.Enc = q.Get("enc")
	return t
}

// resolvePlayTarget 处理 --id：给了就切课程，没给就用现有 target
func resolvePlayTarget(c *Client, id int) (Target, error) {
	if id > 0 {
		return switchCourse(c, id)
	}
	return loadTarget()
}
