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
	Chapters int            `json:"chapters"`
	Types    map[string]int `json:"typeCount"`
	Rows     []ScanRow      `json:"rows"`
}

// cmdScan 逐 tab 全量扫描（num=0 学习材料、num=1 练习题…）
func cmdScan() error {
	t, err := loadTarget()
	if err != nil {
		return err
	}
	c := newClient(NewJar())
	if err := c.Jar.Load(); err != nil {
		return fmt.Errorf("读取登录态失败（先登录）: %w", err)
	}
	chapters, _, err := fetchChapters(c, t)
	if err != nil {
		return err
	}
	logf("章节 %d 个", len(chapters))

	res := ScanResult{Chapters: len(chapters), Types: map[string]int{}}
	for i, ch := range chapters {
		for num := 0; num < 4; num++ {
			m, err := fetchCards(c, t, ch.KnowledgeID, num)
			if err != nil {
				break
			}
			for _, a := range m.Attachments {
				mod := a.Property.Module
				key := mod + "/" + a.Type
				res.Types[key]++
				res.Rows = append(res.Rows, ScanRow{
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
		if (i+1)%20 == 0 {
			logf("  已扫 %d/%d", i+1, len(chapters))
		}
	}
	if err := writeJSON(statePath("scan.json"), res); err != nil {
		return err
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
	return nil
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
	var res ScanResult
	if err := readJSON(statePath("scan.json"), &res); err != nil {
		return fmt.Errorf("先跑 hsc scan: %w", err)
	}
	c := newClient(NewJar())
	if err := c.Jar.Load(); err != nil {
		return fmt.Errorf("读取登录态失败（先登录）: %w", err)
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
			logf("✔ %s -> %s", truncate(r.Title, 40), truncate(msg, 30))
		} else {
			failed++
			logf("✘ %s -> %s", truncate(r.Title, 40), truncate(msg, 40))
		}
		sleepSec(0.25)
	}
	logf("完成 %d，跳过(已完成) %d，失败 %d", done, skipped, failed)
	return nil
}
