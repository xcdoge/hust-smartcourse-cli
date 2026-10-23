package main

import (
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strings"
)

// ---------------- 题目结构 ----------------

type Option struct {
	Value string `json:"value"`
	Text  string `json:"text"`
}

type Question struct {
	QID        string   `json:"qid"`
	QType      int      `json:"qtype"`
	TypeLabel  string   `json:"typeLabel"`
	Stem       string   `json:"stem"`
	Score      string   `json:"score"`
	Options    []Option `json:"options"`
	BlankCount int      `json:"blankCount"`
}

type Quiz struct {
	Index     int               `json:"index"`
	Title     string            `json:"title"`
	Work      WorkPoint         `json:"work"`
	Action    string            `json:"action"`
	PageURL   string            `json:"pageUrl"`
	Hidden    map[string]string `json:"hidden"`
	Questions []Question        `json:"questions"`
}

// ---------------- HTML 工具 ----------------

var (
	reTag       = regexp.MustCompile(`<[^>]+>`)
	reSpace     = regexp.MustCompile(`\s+`)
	reQBlocks   = regexp.MustCompile(`<div[^>]*class="singleQuesId"[^>]*id="question(\d+)"`)
	reTiMu      = regexp.MustCompile(`<div[^>]*class="[^"]*TiMu[^"]*"`)
	reTitle     = regexp.MustCompile(`(?s)<div[^>]*class="newZy_TItle"[^>]*>(.*?)</div>`)
	reTypeTag   = regexp.MustCompile(`【([^】]+)】`)
	reScore     = regexp.MustCompile(`（\s*([\d.]+)\s*分\s*）`)
	reOption    = regexp.MustCompile(`(?s)<span[^>]*name="answer(check)?(\d+)"[^>]*data="([^"]*)"[^>]*>.*?</span>.*?<a[^>]*>(.*?)</a>`)
	reQID1      = regexp.MustCompile(`<li[^>]*qid="(\d+)"`)
	reQID2      = regexp.MustCompile(`name="answer(\d+)"`)
	reQID3      = regexp.MustCompile(`id="answer(\d+)"`)
	reQType     = regexp.MustCompile(`qtype="(\d+)"`)
	reBlank     = regexp.MustCompile(`<input[^>]*name="answer(\d+)"[^>]*>`)
	reHidden    = regexp.MustCompile(`(?s)<input[^>]*type="hidden"[^>]*>`)
	reName      = regexp.MustCompile(`name="([^"]+)"`)
	reValue     = regexp.MustCompile(`value="([^"]*)"`)
	reAction    = regexp.MustCompile(`(?s)<form[^>]*(?:id|name)="form1"[^>]*>`)
	reActVal    = regexp.MustCompile(`action="([^"]+)"`)
	reUTEnc     = regexp.MustCompile(`utEnc\s*=\s*"([0-9a-f]{32})"`)
	reTitlePage = regexp.MustCompile(`<title>([^<]*)</title>`)
)

func stripTags(s string) string {
	s = reTag.ReplaceAllString(s, "")
	r := strings.NewReplacer("&nbsp;", " ", "&amp;", "&", "&lt;", "<", "&gt;", ">", "&quot;", `"`, "&#39;", "'")
	s = r.Replace(s)
	return strings.TrimSpace(reSpace.ReplaceAllString(s, " "))
}

// parseQuiz 从作业页面解析题目
func parseQuiz(html string) []Question {
	type block struct {
		html string
		qid  string
	}
	var blocks []block

	locs := reQBlocks.FindAllStringSubmatchIndex(html, -1)
	if len(locs) > 0 {
		for i, loc := range locs {
			end := len(html)
			if i+1 < len(locs) {
				end = locs[i+1][0]
			}
			blocks = append(blocks, block{html: html[loc[0]:end], qid: html[loc[2]:loc[3]]})
		}
	} else {
		offs := reTiMu.FindAllStringIndex(html, -1)
		for i, o := range offs {
			end := len(html)
			if i+1 < len(offs) {
				end = offs[i+1][0]
			}
			blocks = append(blocks, block{html: html[o[0]:end]})
		}
	}

	var out []Question
	for _, b := range blocks {
		h := b.html
		titleHTML := ""
		if m := reTitle.FindStringSubmatch(h); m != nil {
			titleHTML = m[1]
		} else if len(h) > 800 {
			titleHTML = h[:800]
		} else {
			titleHTML = h
		}
		typeLabel := ""
		if m := reTypeTag.FindStringSubmatch(titleHTML); m != nil {
			typeLabel = m[1]
		}
		score := ""
		if m := reScore.FindStringSubmatch(titleHTML); m != nil {
			score = m[1]
		}
		stem := stripTags(reTypeTag.ReplaceAllString(titleHTML, ""))

		var opts []Option
		for _, m := range reOption.FindAllStringSubmatch(h, -1) {
			opts = append(opts, Option{Value: m[3], Text: stripTags(m[4])})
		}

		qid := b.qid
		if qid == "" {
			for _, re := range []*regexp.Regexp{reQID1, reQID2, reQID3} {
				if m := re.FindStringSubmatch(h); m != nil {
					qid = m[1]
					break
				}
			}
		}

		qtype := 9
		if m := reQType.FindStringSubmatch(h); m != nil {
			qtype = atoiOr(m[1], 9)
		} else {
			switch {
			case strings.Contains(typeLabel, "单选"):
				qtype = 0
			case strings.Contains(typeLabel, "多选"):
				qtype = 1
			case strings.Contains(typeLabel, "判断"):
				qtype = 3
			case strings.Contains(typeLabel, "填空"):
				qtype = 4
			}
		}
		blanks := len(reBlank.FindAllStringSubmatch(h, -1))
		out = append(out, Question{
			QID: qid, QType: qtype, TypeLabel: typeLabel,
			Stem: stem, Score: score, Options: opts, BlankCount: blanks,
		})
	}
	return out
}

func parseHidden(html string) map[string]string {
	out := map[string]string{}
	for _, tag := range reHidden.FindAllString(html, -1) {
		nm := reName.FindStringSubmatch(tag)
		if nm == nil {
			continue
		}
		val := reValue.FindStringSubmatch(tag)
		v := ""
		if val != nil {
			v = strings.ReplaceAll(val[1], "&amp;", "&")
		}
		out[nm[1]] = v
	}
	return out
}

// ---------------- 抓取 ----------------

func ktokenOf(c *Client, t Target, chapterID string, page int) string {
	m, err := fetchCards(c, t, chapterID, page)
	if err != nil {
		return ""
	}
	if v, ok := m.Defaults["ktoken"].(string); ok {
		return v
	}
	return ""
}

func utEncOf(c *Client, t Target, firstChapter string) string {
	u := fmt.Sprintf("%s/mycourse/studentstudy?chapterId=%s&courseId=%s&clazzid=%s&cpi=%s&enc=%s&mooc2=1&hidetype=0",
		smartOrigin, firstChapter, t.CourseID, t.ClazzID, t.CPI, t.Enc)
	_, _, body, err := c.Follow(u, nil)
	if err != nil {
		return ""
	}
	if m := reUTEnc.FindStringSubmatch(string(body)); m != nil {
		return m[1]
	}
	return ""
}

func workPageURL(t Target, w WorkPoint, ktoken, ut string) string {
	q := "api=1&workId=" + w.WorkID +
		"&jobid=" + url.QueryEscape(w.JobID) +
		"&originJobId=" + url.QueryEscape(w.JobID) +
		"&needRedirect=true&skipHeader=true&knowledgeid=" + w.ChapterID +
		"&ktoken=" + ktoken + "&cpi=" + t.CPI + "&ut=s&clazzId=" + t.ClazzID +
		"&type=&enc=" + w.Enc + "&utenc=" + ut + "&mooc2=1&courseid=" + t.CourseID
	return smartOrigin + "/mooc-ans/api/work?" + q
}

var browserHeaders = map[string]string{
	"Accept":                    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
	"Sec-Fetch-Dest":            "iframe",
	"Sec-Fetch-Mode":            "navigate",
	"Sec-Fetch-Site":            "same-origin",
	"Upgrade-Insecure-Requests": "1",
	"Referer":                   smartOrigin + "/ananas/modules/work/index.html?v=1",
}

// cmdQuizDump 抓题
func cmdQuizDump() error {
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

	seen := map[string]bool{}
	var quizzes []Quiz
	ut := ""
	for _, r := range res.Rows {
		if r.WorkID == "" || seen[r.WorkID] {
			continue
		}
		seen[r.WorkID] = true
		if ut == "" {
			ut = utEncOf(c, t, r.Chapter)
		}
		kt := ktokenOf(c, t, r.Chapter, r.Page)
		w := WorkPoint{ChapterID: r.Chapter, Title: r.Title, WorkID: r.WorkID, JobID: r.JobID, Enc: r.Enc}
		pageURL := workPageURL(t, w, kt, ut)
		_, _, body, err := c.Follow(pageURL, browserHeaders)
		if err != nil {
			logf("✘ %s 抓取失败: %v", truncate(r.Title, 20), err)
			continue
		}
		html := string(body)
		title := ""
		if m := regexp.MustCompile(`<title>([^<]*)</title>`).FindStringSubmatch(html); m != nil {
			title = m[1]
		}
		if strings.Contains(title, "已批阅") {
			logf("  跳过（已批阅） %s", truncate(r.Title, 24))
			continue
		}
		qs := parseQuiz(html)
		action := ""
		if m := reAction.FindStringSubmatch(html); m != nil {
			if a := reActVal.FindStringSubmatch(m[0]); a != nil {
				action = a[1]
			}
		}
		quizzes = append(quizzes, Quiz{
			Index: len(quizzes), Title: firstNonEmpty(r.Title, w.Title), Work: w,
			Action: action, PageURL: pageURL, Hidden: parseHidden(html), Questions: qs,
		})
		logf("[%d] %d 题 %s", len(quizzes)-1, len(qs), truncate(r.Title, 24))
		sleepSec(0.2)
	}

	if err := writeJSON(statePath("quizzes.json"), quizzes); err != nil {
		return err
	}
	// 人类可读版
	var sb strings.Builder
	total := 0
	for _, q := range quizzes {
		total += len(q.Questions)
		fmt.Fprintf(&sb, "\n===== [%d] %s（%d题）=====\n\n", q.Index, q.Title, len(q.Questions))
		for i, qq := range q.Questions {
			fmt.Fprintf(&sb, "%d %s  [%s qid=%s %s分]\n", i+1, qq.Stem, qq.TypeLabel, qq.QID, qq.Score)
			for _, o := range qq.Options {
				fmt.Fprintf(&sb, "  %s. %s\n", o.Value, o.Text)
			}
		}
	}
	_ = os.WriteFile(statePath("quiz-readable.txt"), []byte(sb.String()), 0o644)
	sort.Slice(quizzes, func(i, j int) bool { return quizzes[i].Index < quizzes[j].Index })
	logf("共 %d 份未完成测验，题目总数 %d", len(quizzes), total)
	return nil
}

// Answer 支持字符串或字符串数组
type Answer json.RawMessage

func answerAsString(a Answer) (string, []string) {
	var s string
	if err := json.Unmarshal(a, &s); err == nil {
		return s, nil
	}
	var arr []string
	if err := json.Unmarshal(a, &arr); err == nil {
		return "", arr
	}
	var iface any
	if err := json.Unmarshal(a, &iface); err == nil {
		switch v := iface.(type) {
		case bool:
			if v {
				return "true", nil
			}
			return "false", nil
		case float64:
			return fmt.Sprintf("%v", v), nil
		}
	}
	return "", nil
}

// cmdQuizSubmit 交卷
func cmdQuizSubmit(only int) error {
	t, err := loadTarget()
	if err != nil {
		return err
	}
	var quizzes []Quiz
	if err := readJSON(statePath("quizzes.json"), &quizzes); err != nil {
		return fmt.Errorf("先跑 hsc quiz dump: %w", err)
	}
	answers := map[string]map[string]Answer{}
	if err := readJSON(statePath("answers.json"), &answers); err != nil {
		return fmt.Errorf(`缺 state/answers.json（格式 {"<index>": {"<qid>": "A"}}）: %w`, err)
	}

	okCount, skipCount, failCount := 0, 0, 0
	for _, q := range quizzes {
		if only >= 0 && q.Index != only {
			continue
		}
		ans, has := answers[fmt.Sprint(q.Index)]
		if !has || len(ans) == 0 {
			logf("[%d] 没有答案，跳过 %s", q.Index, truncate(q.Title, 20))
			skipCount++
			continue
		}
		// 交卷前先 /work/validate
		validateU := fmt.Sprintf("%s/mooc-ans/work/validate?classId=%s&courseId=%s&knowledgeId=%s&cpi=%s",
			smartOrigin, t.ClazzID, t.CourseID, q.Work.ChapterID, t.CPI)
		vEnc := ""
		if _, _, vb, verr := c0Follow(validateU, q.PageURL); verr == nil {
			var arr []any
			if json.Unmarshal(vb, &arr) == nil && len(arr) > 0 {
				vEnc = fmt.Sprint(arr[0])
			}
		}

		form := url.Values{}
		for k, v := range q.Hidden {
			form.Set(k, v)
		}
		form.Set("enc", vEnc)
		form.Set("pyFlag", "")
		var qids []string
		for _, qq := range q.Questions {
			if qq.QID != "" {
				qids = append(qids, qq.QID)
			}
		}
		form.Set("answerwqbid", strings.Join(qids, ",")+",")

		filled := 0
		for _, qq := range q.Questions {
			raw, ok := ans[qq.QID]
			if !ok {
				continue
			}
			str, arr := answerAsString(raw)
			if str == "" && len(arr) == 0 {
				continue
			}
			isBlank := qq.QType == 2 || strings.Contains(qq.TypeLabel, "填空")
			if isBlank {
				parts := arr
				if len(parts) == 0 {
					parts = strings.Split(str, "||")
				}
				type item struct {
					Content string `json:"content"`
					Name    string `json:"name"`
				}
				var items []item
				for i, p := range parts {
					items = append(items, item{Content: p, Name: fmt.Sprint(i + 1)})
					form.Set(fmt.Sprintf("answerEditor%s%d", qq.QID, i+1), p)
				}
				b, _ := json.Marshal(items)
				form.Set("answer"+qq.QID, string(b))
			} else {
				if len(arr) > 0 {
					form.Set("answer"+qq.QID, strings.Join(arr, ""))
				} else {
					form.Set("answer"+qq.QID, str)
				}
			}
			if form.Get("answertype"+qq.QID) == "" {
				form.Set("answertype"+qq.QID, fmt.Sprint(qq.QType))
			}
			filled++
		}

		action := strings.Replace(q.Action, "/mooc-ans/api/addStudentWorkNewWeb", "/mooc-ans/work/addStudentWorkNewWeb", 1)
		if action == "" {
			action = "/mooc-ans/work/addStudentWorkNewWeb"
		}
		action = resolveURL(q.PageURL, action)
		sep := "?"
		if strings.Contains(action, "?") {
			sep = "&"
		}
		action += sep + "ua=pc&formType=post&saveStatus=1&pos=&version=1"

		c := c0Client()
		_, body, err := c.Do("POST", action, form, map[string]string{
			"X-Requested-With": "XMLHttpRequest",
			"Content-Type":     "application/x-www-form-urlencoded; charset=UTF-8",
			"Referer":          q.PageURL,
			"Origin":           smartOrigin,
		})
		msg := strings.TrimSpace(string(body))
		if err != nil {
			logf("[%d] 提交失败: %v", q.Index, err)
			failCount++
			continue
		}
		ok := strings.Contains(msg, `"status":true`) || strings.Contains(msg, "success")
		if ok {
			okCount++
			logf("[%d] 填 %d/%d 题 -> %s", q.Index, filled, len(q.Questions), truncate(msg, 60))
		} else {
			failCount++
			logf("[%d] 失败 -> %s", q.Index, truncate(msg, 80))
		}
		sleepSec(0.3)
	}
	logf("提交完成：成功 %d，跳过 %d，失败 %d", okCount, skipCount, failCount)
	return nil
}

// 复用同一个 jar 的客户端（交卷要持续用同一会话）
var sharedClient *Client

func c0Client() *Client {
	if sharedClient == nil {
		sharedClient = newClient(NewJar())
		_ = sharedClient.Jar.Load()
	}
	return sharedClient
}

func c0Follow(u, referer string) (*Client, string, []byte, error) {
	c := c0Client()
	h := map[string]string{"X-Requested-With": "XMLHttpRequest"}
	if referer != "" {
		h["Referer"] = referer
	}
	_, finalURL, body, err := c.Follow(u, h)
	return c, finalURL, body, err
}
