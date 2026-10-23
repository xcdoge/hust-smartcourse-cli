package main

import (
	"fmt"
	"strings"
)

type ScanRow struct {
	Chapter     string `json:"chapter"`
	ChapterName string `json:"chapterTitle"`
	Page        int    `json:"page"`
	PageTitle   string `json:"pageTitle"`
	Module      string `json:"module"`
	Type        string `json:"type"`
	Title       string `json:"title"`
	JobID       string `json:"jobid"`
	WorkID      string `json:"workid"`
	ObjectID    string `json:"objectId"`
	Enc         string `json:"enc"`
	JToken      string `json:"jtoken"`
	OtherInfo   string `json:"otherInfo"`
	AttDuration int    `json:"attDuration"`
	IsPassed    bool   `json:"isPassed"`
}

type ScanResult struct {
	CourseID string         `json:"courseId"`
	Chapters int            `json:"chapters"`
	Types    map[string]int `json:"typeCount"`
	Rows     []ScanRow      `json:"rows"`
}

// loadScanFor 读取 scan.json，并校验它属于当前课程
func loadScanFor(t Target) (*ScanResult, error) {
	var res ScanResult
	if err := readJSON(statePath("scan.json"), &res); err != nil {
		return nil, fmt.Errorf("缺少 state/scan.json，先执行 hsc scan")
	}
	if res.CourseID != "" && res.CourseID != t.CourseID {
		return nil, fmt.Errorf("state/scan.json 属于另一门课（courseId %s），当前是 %s，先重新执行 hsc scan",
			res.CourseID, t.CourseID)
	}
	return &res, nil
}

// cmdScan 逐 tab 全量扫描（num=0 学习材料、num=1 练习题…）
func cmdScan() error {
	t, err := loadTarget()
	if err != nil {
		return err
	}
	c := newClient(NewJar())
	if err := loadSession(c); err != nil {
		return err
	}
	res, err := scanCourse(c, t)
	if err != nil {
		return err
	}
	logf("扫描完成：%d 个附件，类型分布见 state/scan.json", len(res.Rows))
	return nil
}

// scanCourse 扫描全部章节的全部 tab，写入 state/scan.json
func scanCourse(c *Client, t Target) (*ScanResult, error) {
	chapters, _, err := fetchChapters(c, t)
	if err != nil {
		return nil, err
	}
	logf("章节 %d 个", len(chapters))

	res := ScanResult{CourseID: t.CourseID, Chapters: len(chapters), Types: map[string]int{}}

	// 并发扫每个章节的所有 tab（原来串行 6.6 秒）
	perChapter := make([][]ScanRow, len(chapters))
	parallelEach(len(chapters), 8, func(i int) {
		ch := chapters[i]
		var rows []ScanRow
		for num := 0; num < 4; num++ {
			// 服务端偶发返回没有 mArg 的页面，重试两次再放弃这个 tab
			var m *mArg
			var err error
			for attempt := 0; attempt < 3; attempt++ {
				if m, err = fetchCards(c, t, ch.KnowledgeID, num); err == nil {
					break
				}
				sleepSec(0.3 * float64(attempt+1))
			}
			if err != nil {
				break
			}
			for _, a := range m.Attachments {
				mod := a.Property.Module
				rows = append(rows, ScanRow{
					Chapter:     ch.KnowledgeID,
					Page:        num,
					Module:      mod,
					Type:        a.Type,
					Title:       firstNonEmpty(a.Property.Name, a.Property.Title),
					JobID:       a.JobID,
					WorkID:      firstNonEmpty(a.Property.WorkID, a.Property.WorkIDAlt),
					ObjectID:    firstNonEmpty(a.ObjectID, a.ObjectIDCamel, a.Property.ObjectID),
					Enc:         a.Enc,
					JToken:      a.JToken,
					OtherInfo:   a.OtherInfo,
					AttDuration: a.AttDuration,
					IsPassed:    a.IsPassed,
				})
			}
		}
		perChapter[i] = rows
	})
	for _, rows := range perChapter {
		for _, r := range rows {
			res.Types[r.Module+"/"+r.Type]++
			res.Rows = append(res.Rows, r)
		}
	}

	if err := writeJSON(statePath("scan.json"), res); err != nil {
		return nil, err
	}
	logf("附件类型统计：")
	for k, v := range res.Types {
		logf("  %s: %d", k, v)
	}
	nonMedia := 0
	for _, r := range res.Rows {
		if !strings.Contains(r.Module, "insertvideo") && !strings.Contains(r.Module, "insertdoc") {
			nonMedia++
		}
	}
	logf("共 %d 个附件，其中非视频/文档 %d 个（已写 state/scan.json）", len(res.Rows), nonMedia)
	return &res, nil
}

// cmdDoc 完成文档/图片任务点
func cmdDoc(args []string) error {
	force := false
	for _, a := range args {
		if a == "--all" {
			force = true
		}
	}
	t, err := loadTarget()
	if err != nil {
		return err
	}
	res, err := loadScanFor(t)
	if err != nil {
		return err
	}
	c := newClient(NewJar())
	if err := loadSession(c); err != nil {
		return err
	}
	done, skipped, failed := 0, 0, 0
	for _, r := range res.Rows {
		if !strings.Contains(r.Module, "insertdoc") && r.Type != "document" {
			continue
		}
		if r.IsPassed && !force {
			skipped++
			continue
		}
		u := fmt.Sprintf("%s/mooc-ans/job/document?jobid=%s&knowledgeid=%s&courseid=%s&clazzid=%s&jtoken=%s&checkMicroTopic=true&microTopicId=&courseEngineInfo=false",
			smartOrigin, r.JobID, r.Chapter, t.CourseID, t.ClazzID, r.JToken)
		_, _, body, err := c.Follow(u, map[string]string{
			"X-Requested-With": "XMLHttpRequest",
			"Referer":          smartOrigin + "/ananas/modules/doc/index.html",
		})
		msg := strings.TrimSpace(string(body))
		ok := err == nil && strings.Contains(msg, "成功") || strings.Contains(msg, "已经完成")
		if ok {
			done++
			logf("ok   %s  %s", truncate(r.Title, 40), truncate(msg, 24))
		} else {
			failed++
			logf("fail %s  %s", truncate(r.Title, 40), truncate(msg, 30))
		}
		sleepSec(0.25)
	}
	logf("完成 %d，跳过 %d，失败 %d", done, skipped, failed)
	return nil
}
