package main

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// CourseItem 课程列表里的一项
type CourseItem struct {
	Index    int    `json:"index"`
	Name     string `json:"name"`
	Teacher  string `json:"teacher"`
	CourseID string `json:"courseId"`
	ClazzID  string `json:"clazzId"`
	CPI      string `json:"cpi"`
}

var (
	reCardStart  = regexp.MustCompile(`<div class="course clearfix`)
	reCardID     = regexp.MustCompile(`id="c_([0-9]+)"`)
	reClazzID    = regexp.MustCompile(`class="clazzId"[^>]*value="([0-9]+)"`)
	rePersonID   = regexp.MustCompile(`class="curPersonId"[^>]*value="([0-9]+)"`)
	reCourseName = regexp.MustCompile(`class="course-name[^"]*"[^>]*>\s*([^<]{1,80})`)
	reTeacher    = regexp.MustCompile(`class="line2 color3"[^>]*>\s*([^<]{1,40})`)
	reStuMiddle  = regexp.MustCompile(`stucoursemiddle\?courseid=([0-9]+)&clazzid=([0-9]+)&cpi=([0-9]+)`)
)

// fetchCourseList 拉取当前账号的课程列表。
// 接口是 POST /mooc-ans/visit/courselistdata?courseType=1（courseType=0 会返回空）。
func fetchCourseList(c *Client) ([]CourseItem, error) {
	u := smartOrigin + "/mooc-smartcourse/mooc2-ans/visit/courselistdata?courseType=1"
	_, _, body, err := c.Follow(u, map[string]string{
		"X-Requested-With": "XMLHttpRequest",
		"Referer":          smartOrigin + "/mooc-smartcourse/mooc2-ans/visit/interaction",
	})
	if err != nil {
		return nil, err
	}
	html := string(body)
	if len(html) < 500 {
		return nil, fmt.Errorf("课程列表返回内容过短（%d 字节），可能会话失效", len(html))
	}

	var out []CourseItem
	seen := map[string]bool{}

	// 按卡片起始位置切块，每块到下个卡片开头为止
	starts := reCardStart.FindAllStringIndex(html, -1)
	for idx, pos := range starts {
		end := len(html)
		if idx+1 < len(starts) {
			end = starts[idx+1][0]
		}
		block := html[pos[0]:end]
		mm := reCardID.FindStringSubmatch(block)
		if mm == nil {
			continue
		}
		courseID := mm[1]
		if seen[courseID] {
			continue
		}
		item := CourseItem{CourseID: courseID}
		if mm := reClazzID.FindStringSubmatch(block); mm != nil {
			item.ClazzID = mm[1]
		}
		if mm := rePersonID.FindStringSubmatch(block); mm != nil {
			item.CPI = mm[1]
		}
		if mm := reCourseName.FindStringSubmatch(block); mm != nil {
			item.Name = strings.TrimSpace(unescapeHTML(mm[1]))
		}
		if mm := reTeacher.FindStringSubmatch(block); mm != nil {
			item.Teacher = strings.TrimSpace(unescapeHTML(mm[1]))
		}
		if item.ClazzID == "" || item.CPI == "" {
			continue
		}
		seen[courseID] = true
		out = append(out, item)
	}

	// 兜底：卡片结构变了就按链接抓
	if len(out) == 0 {
		for _, m := range reStuMiddle.FindAllStringSubmatch(html, -1) {
			if seen[m[1]] {
				continue
			}
			seen[m[1]] = true
			out = append(out, CourseItem{CourseID: m[1], ClazzID: m[2], CPI: m[3]})
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("列表里没解析到课程，可能页面结构变了")
	}
	for i := range out {
		out[i].Index = i + 1
	}
	return out, nil
}

// loadCourseList 优先用缓存，--refresh 时重新拉
func loadCourseList(c *Client, refresh bool) ([]CourseItem, error) {
	if !refresh {
		var cached []CourseItem
		if err := readJSON(statePath("courses.json"), &cached); err == nil && len(cached) > 0 {
			return cached, nil
		}
	}
	list, err := fetchCourseList(c)
	if err != nil {
		return nil, err
	}
	_ = writeJSON(statePath("courses.json"), list)
	return list, nil
}

// switchCourse 按序号切课程：写 target.json，并在快照不匹配时重抓
func switchCourse(c *Client, id int) (Target, error) {
	list, err := loadCourseList(c, false)
	if err != nil {
		return Target{}, err
	}
	if id < 1 || id > len(list) {
		return Target{}, fmt.Errorf("序号 %d 超出范围（共 %d 门课）", id, len(list))
	}
	item := list[id-1]
	t := Target{
		Name:     item.Name,
		CourseID: item.CourseID,
		ClazzID:  item.ClazzID,
		CPI:      item.CPI,
	}
	if err := writeJSON(statePath("target.json"), t); err != nil {
		return t, err
	}
	logf("已切换到 [%d] %s", item.Index, firstNonEmpty(item.Name, item.CourseID))

	// 快照是别的课的，重抓一份
	var snap CourseSnapshot
	if err := readJSON(statePath("course.json"), &snap); err != nil || snap.Target.CourseID != t.CourseID {
		logf("抓取课程结构…")
		if _, err := crawlCourse(c, t); err != nil {
			return t, fmt.Errorf("切换后抓取失败: %w", err)
		}
	}
	return t, nil
}

// printCourseList 打印课程列表
func printCourseList(list []CourseItem, current Target) {
	fmt.Printf("%-3s %-34s %-10s %s\n", "序号", "课程", "教师", "状态")
	for _, it := range list {
		mark := ""
		if it.CourseID == current.CourseID {
			mark = "← 当前"
		}
		name := it.Name
		if name == "" {
			name = "(未命名 " + it.CourseID + ")"
		}
		fmt.Printf("%-3d %-34s %-10s %s\n", it.Index, truncatePad(name, 34), truncatePad(it.Teacher, 10), mark)
	}
}

func truncatePad(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		return string(r[:n-1]) + "…"
	}
	for len([]rune(s)) < n {
		s += " "
	}
	return s
}

var htmlUnescaper = strings.NewReplacer(
	"&amp;", "&", "&lt;", "<", "&gt;", ">", "&quot;", `"`,
	"&#39;", "'", "&nbsp;", " ",
)

func unescapeHTML(s string) string { return htmlUnescaper.Replace(s) }

var _ = strconv.Itoa
