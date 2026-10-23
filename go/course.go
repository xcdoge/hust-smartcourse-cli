package main

import (
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"strings"
)

// Attachment 章节卡片里的一个任务点
type Attachment struct {
	Type                string  `json:"type"`
	JobID               string  `json:"jobid"`
	Enc                 string  `json:"enc"`
	JToken              string  `json:"jtoken"`
	OtherInfo           string  `json:"otherInfo"`
	IsPassed            bool    `json:"isPassed"`
	AttDuration         int     `json:"attDuration"`
	AttDurationEnc      string  `json:"attDurationEnc"`
	VideoFaceCaptureEnc string  `json:"videoFaceCaptureEnc"`
	ObjectID            string  `json:"objectid"`
	ObjectIDCamel       string  `json:"objectId"`
	PlayTime            float64 `json:"playTime"`
	HeadOffset          float64 `json:"headOffset"`
	Property            struct {
		Module    string `json:"module"`
		Name      string `json:"name"`
		Title     string `json:"title"`
		WorkID    string `json:"workid"`
		WorkType  string `json:"worktype"`
		ObjectID  string `json:"objectid"`
		WorkIDAlt string `json:"workId"`
	} `json:"property"`
}

type mArg struct {
	Defaults    map[string]any `json:"defaults"`
	Attachments []Attachment   `json:"attachments"`
}

type Chapter struct {
	KnowledgeID string `json:"knowledgeId"`
	Title       string `json:"title"`
}

type VideoPoint struct {
	ChapterID           string  `json:"chapterId"`
	Title               string  `json:"title"`
	ObjectID            string  `json:"objectId"`
	JobID               string  `json:"jobid"`
	OtherInfo           string  `json:"otherInfo"`
	AttDuration         int     `json:"attDuration"`
	AttDurationEnc      string  `json:"attDurationEnc"`
	VideoFaceCaptureEnc string  `json:"videoFaceCaptureEnc"`
	IsPassed            bool    `json:"isPassed"`
	PlayTime            float64 `json:"playTime"`
}

type WorkPoint struct {
	ChapterID   string `json:"chapterId"`
	ChapterName string `json:"chapterTitle"`
	Page        int    `json:"page"`
	Title       string `json:"title"`
	WorkID      string `json:"workid"`
	JobID       string `json:"jobid"`
	Enc         string `json:"enc"`
	WorkType    string `json:"worktype"`
}

type CourseSnapshot struct {
	Target    Target       `json:"target"`
	ReportURL string       `json:"reportUrl"`
	Chapters  []Chapter    `json:"chapters"`
	Videos    []VideoPoint `json:"videos"`
	Works     []WorkPoint  `json:"works"`
	FetchedAt string       `json:"fetchedAt"`
}

// extractJSON 从 HTML 里抠出 `marker = { ... }` 的完整 JSON（按括号配平，跳过字符串）
//
// 注意：页面里通常先有一句 `mArg = "";` 的占位赋值，所以必须按 `标记 = {` 来定位，
// 不能只找第一个标记再找下一个 '{'。
func extractJSON(html, marker string) ([]byte, error) {
	re := regexp.MustCompile(regexp.QuoteMeta(marker) + `\s*=\s*\{`)
	loc := re.FindStringIndex(html)
	if loc == nil {
		return nil, fmt.Errorf("页面里找不到 %s = {", marker)
	}
	start := loc[1] - 1
	depth := 0
	inStr := false
	esc := false
	for i := start; i < len(html); i++ {
		c := html[i]
		if inStr {
			if esc {
				esc = false
			} else if c == '\\' {
				esc = true
			} else if c == '"' {
				inStr = false
			}
			continue
		}
		switch c {
		case '"':
			inStr = true
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return []byte(html[start : i+1]), nil
			}
		}
	}
	return nil, fmt.Errorf("括号不配平")
}

var reToOld = regexp.MustCompile(`toOld\('(\d+)',\s*'(\d+)'`)
var reChapterTitle = regexp.MustCompile(`title="([^"]{1,120})"`)

// fetchChapters 从章节列表页解析章节
func fetchChapters(c *Client, t Target) ([]Chapter, int, error) {
	u := fmt.Sprintf("%s/mooc-smartcourse/mooc2-ans/mycourse/studentcourse?courseid=%s&clazzid=%s",
		smartOrigin, t.CourseID, t.ClazzID)
	_, finalURL, body, err := c.Follow(u, nil)
	if err != nil {
		return nil, 0, err
	}
	if strings.Contains(finalURL, "/logout") {
		return nil, 0, fmt.Errorf("会话已失效，请重新登录")
	}
	html := string(body)
	var out []Chapter
	seen := map[string]bool{}
	for _, m := range reToOld.FindAllStringSubmatch(html, -1) {
		kid := m[2]
		if seen[kid] {
			continue
		}
		seen[kid] = true
		out = append(out, Chapter{KnowledgeID: kid})
	}
	return out, len(body), nil
}

// fetchCards 拉某一章节某个 tab 页的 mArg
func fetchCards(c *Client, t Target, knowledgeID string, num int) (*mArg, error) {
	u := fmt.Sprintf("%s/mooc-ans/knowledge/cards?clazzid=%s&courseid=%s&knowledgeid=%s&num=%d&ut=s&cpi=%s&v=2025-0424-1038-4&mooc2=1&isMicroCourse=false&editorPreview=0&crossId=",
		smartOrigin, t.ClazzID, t.CourseID, knowledgeID, num, t.CPI)
	_, _, body, err := c.Follow(u, nil)
	if err != nil {
		return nil, err
	}
	raw, err := extractJSON(string(body), "mArg")
	if err != nil {
		return nil, err
	}
	var m mArg
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, err
	}
	return &m, nil
}

// cmdCourse 抓课程结构
func cmdCourse() error {
	t, err := loadTarget()
	if err != nil {
		return err
	}
	c := newClient(NewJar())
	if err := c.Jar.Load(); err != nil {
		return fmt.Errorf("读取登录态失败（先登录）: %w", err)
	}
	chapters, size, err := fetchChapters(c, t)
	if err != nil {
		return err
	}
	logf("章节列表页 %d 字节，解析出 %d 个章节", size, len(chapters))

	snap := CourseSnapshot{Target: t, Chapters: chapters}
	for i, ch := range chapters {
		m, err := fetchCards(c, t, ch.KnowledgeID, 0)
		if err != nil {
			if i < 3 {
				logf("  章节 %s 抓取失败: %v", ch.KnowledgeID, err)
			}
			continue
		}
		if snap.ReportURL == "" {
			if v, ok := m.Defaults["reportUrl"].(string); ok && v != "" {
				snap.ReportURL = v
			}
		}
		for _, a := range m.Attachments {
			mod := a.Property.Module
			switch {
			case a.Type == "video" || mod == "insertvideo":
				oid := firstNonEmpty(a.ObjectID, a.ObjectIDCamel, a.Property.ObjectID)
				if oid == "" {
					continue
				}
				snap.Videos = append(snap.Videos, VideoPoint{
					ChapterID: ch.KnowledgeID, Title: firstNonEmpty(a.Property.Name, a.Property.Title),
					ObjectID: oid, JobID: a.JobID, OtherInfo: a.OtherInfo,
					AttDuration: a.AttDuration, AttDurationEnc: a.AttDurationEnc,
					VideoFaceCaptureEnc: a.VideoFaceCaptureEnc,
					IsPassed:            a.IsPassed, PlayTime: a.PlayTime,
				})
			case a.Type == "workid" || a.Type == "work" || mod == "work":
				snap.Works = append(snap.Works, WorkPoint{
					ChapterID: ch.KnowledgeID, Page: 0, Title: a.Property.Title,
					WorkID: firstNonEmpty(a.Property.WorkID, a.Property.WorkIDAlt),
					JobID:  a.JobID, Enc: a.Enc, WorkType: a.Property.WorkType,
				})
			}
		}
		if (i+1)%20 == 0 {
			logf("  已抓 %d/%d", i+1, len(chapters))
		}
	}
	passed := 0
	total := 0
	for _, v := range snap.Videos {
		total += v.AttDuration
		if v.IsPassed {
			passed += v.AttDuration
		}
	}
	if err := writeJSON(statePath("course.json"), snap); err != nil {
		return err
	}
	logf("视频 %d 个（已通过 %d 个，总时长 %.2f 小时）| 作业 %d 个",
		len(snap.Videos), countPassed(snap.Videos), float64(total)/3600, len(snap.Works))
	if countPassed(snap.Videos) == 0 && len(snap.Videos) == 0 {
		return fmt.Errorf("没抓到任何视频任务点")
	}
	return nil
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

func countPassed(vs []VideoPoint) int {
	n := 0
	for _, v := range vs {
		if v.IsPassed {
			n++
		}
	}
	return n
}

// 保持 os 被使用（其他文件会用到，这里仅防误删）
var _ = os.Getenv
