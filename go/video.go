package main

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"regexp"
	"strings"
	"time"
)

const logSalt = "d_yHJ!$pdA~5"

// defaultReportURL 来自课程卡片 mArg.defaults.reportUrl（status 接口不一定给）
var defaultReportURL string

var reRT = regexp.MustCompile(`rt_([0-9.]+|d)`)

type videoStatus struct {
	Status    string  `json:"status"`
	Duration  float64 `json:"duration"`
	DToken    string  `json:"dtoken"`
	ReportURL string  `json:"reportUrl"`
	RT        float64 `json:"rt"`
}

// videoMeta 取视频状态（dtoken / reportUrl / duration）
func videoMeta(c *Client, v VideoPoint) (*videoStatus, error) {
	u := fmt.Sprintf("%s/ananas/status/%s?k=1731&flag=normal&ro=0", smartOrigin, v.ObjectID)
	_, _, body, err := c.Follow(u, nil)
	if err != nil {
		return nil, err
	}
	text := strings.TrimSpace(string(body))
	if i := strings.Index(text, "{"); i > 0 {
		text = text[i:]
	}
	var st videoStatus
	if err := json.Unmarshal([]byte(text), &st); err != nil {
		return nil, fmt.Errorf("解析 status 失败: %w (%s)", err, truncate(text, 80))
	}
	if st.Status != "success" {
		return nil, fmt.Errorf("status 返回 %q", st.Status)
	}
	return &st, nil
}

// courseRT 从 otherInfo 里读限速标记：rt_d → 0.9，rt_1 → 1
func courseRT(otherInfo string) float64 {
	m := reRT.FindStringSubmatch(otherInfo)
	if len(m) < 2 {
		return 0.9
	}
	if m[1] == "d" {
		return 0.9
	}
	return atofOr(m[1], 1)
}

// report 上报一次播放进度
func report(c *Client, t Target, v VideoPoint, st *videoStatus, playingTime, clipTime float64, rt float64) (bool, error) {
	playingMs := int64(math.Round(playingTime * 1000))
	durMs := int64(math.Round(st.Duration * 1000))
	uid := c.Jar.UID()
	if uid == "" {
		return false, fmt.Errorf("cookie 里没有 _uid，无法签名（重新登录）")
	}
	sign := md5Hex(fmt.Sprintf("[%s][%s][%s][%s][%d][%s][%d][%s]",
		t.ClazzID, uid, v.JobID, v.ObjectID, playingMs, logSalt, durMs, fmtClip(clipTime)))

	q := strings.Join([]string{
		"clazzId=" + t.ClazzID,
		"playingTime=" + fmtFloat(playingTime),
		"duration=" + fmtFloat(st.Duration),
		"clipTime=" + fmtClip(clipTime),
		"objectId=" + v.ObjectID,
		"otherInfo=" + v.OtherInfo,
		"jobid=" + v.JobID,
		"userid=" + uid,
		"isdrag=0",
		"view=pc",
		"enc=" + sign,
		"rt=" + fmtFloat(rt),
		"videoFaceCaptureEnc=" + v.VideoFaceCaptureEnc,
		"dtype=Video",
		"_t=" + fmt.Sprint(time.Now().UnixMilli()),
		"attDuration=" + fmt.Sprint(v.AttDuration),
		"attDurationEnc=" + v.AttDurationEnc,
		"courseEngineInfo=false",
	}, "&")
	base := st.ReportURL
	if base == "" {
		base = defaultReportURL
	}
	if base == "" {
		return false, fmt.Errorf("拿不到 reportUrl（status 和 mArg.defaults 都没有）")
	}
	u := base + "/" + st.DToken + "?" + q
	_, _, body, err := c.Follow(u, map[string]string{
		"Referer":          smartOrigin + "/ananas/modules/video/index.html",
		"X-Requested-With": "XMLHttpRequest",
	})
	if err != nil {
		return false, err
	}
	var out struct {
		IsPassed bool `json:"isPassed"`
	}
	_ = json.Unmarshal(body, &out)
	return out.IsPassed, nil
}

func fmtFloat(f float64) string {
	// 去掉多余小数：1000 → "1000"，1000.5 → "1000.5"
	if math.Abs(f-math.Round(f)) < 1e-9 {
		return fmt.Sprintf("%.0f", f)
	}
	return strings.TrimRight(strings.TrimRight(fmt.Sprintf("%.3f", f), "0"), ".")
}

func fmtClip(dur float64) string {
	return "0_" + fmtFloat(dur)
}

// playTimeSeconds 把卡片里的 playTime 归一成秒。
//
// 注意：mArg 里 playTime 是毫秒（349000 表示 349 秒），attDuration 是秒。
// 直接当秒用会从 349000 开始上报，等于一步跳到结尾，服务端会判无效。
func playTimeSeconds(v VideoPoint) float64 {
	p := v.PlayTime
	if p <= 0 {
		return 0
	}
	if v.AttDuration > 0 && p > float64(v.AttDuration)*3 {
		return p / 1000
	}
	if p > 100000 { // 超过 27 小时的"秒"显然不对，按毫秒处理
		return p / 1000
	}
	return p
}

// playOne 把一个视频刷到通过
func playOne(c *Client, t Target, v VideoPoint, speed float64, tickSec float64, dry bool, debug bool) error {
	// 先拉一次最新参数：otherInfo/attDurationEnc/playTime 都可能已经变了
	// HSC_SKIP_REFRESH=1 可跳过（仅用于调试/测试）
	skipRefresh := os.Getenv("HSC_SKIP_REFRESH") != ""
	if !skipRefresh {
		if fresh, err := refreshedVideo(c, t, v); err == nil {
			if fresh.PlayTime != v.PlayTime || fresh.OtherInfo != v.OtherInfo {
				logf("  参数已更新 playTime %.0f -> %.0f", v.PlayTime, fresh.PlayTime)
			}
			v = fresh
			if v.IsPassed {
				logf("  服务端标记已通过，跳过")
				return nil
			}
		}
	}
	st, err := videoMeta(c, v)
	if err != nil {
		return err
	}
	rt := courseRT(v.OtherInfo)
	dur := st.Duration
	if dur <= 0 {
		return fmt.Errorf("时长异常: %v", dur)
	}
	target := dur - 2
	if rt < 1 {
		// 不限速：按倍速推进
		target = dur - 2
	}
	logf("%s  %.0fs  rt=%.2f", truncate(v.Title, 40), dur, rt)
	if debug {
		logf("  %s", describeReport(c, t, v, v.PlayTime, rt))
	}
	if dry {
		logf("  (dry-run，不实际上报)")
		return nil
	}

	// 每次上报推进 speed*tick 秒，两次上报之间等 tick 秒——这样倍速才和真实节奏成比例。
	// 循环里不 sleep 的话，服务端会看到「1 秒内前进几百秒」，直接判刷量。
	if tickSec <= 0 {
		tickSec = 10
	}
	step := speed * tickSec
	if step <= 0 {
		step = tickSec
	}
	played := playTimeSeconds(v)
	if played < 0 {
		played = 0
	}
	// 服务端记录的进度不能超过时长；超了就从头开始（否则会被当成非法跳转）
	if played >= target {
		played = math.Max(target-step, 0)
	}
	for attempt := 0; attempt < 400; attempt++ {
		played = math.Min(played+step, target)
		passed, err := report(c, t, v, st, played, dur, rt)
		if err != nil {
			return err
		}
		if debug {
			logf("  上报 %.0f/%.0f -> isPassed=%v", played, dur, passed)
		}
		if passed {
			logf("  通过 playingTime=%.0f/%.0f", played, dur)
			return nil
		}
		if played >= target {
			break
		}
		sleepSec(tickSec)
	}
	// 阶梯补报：95% → 98%，每次换新 dtoken
	for _, pct := range []float64{0.95, 0.96, 0.97, 0.98} {
		if st2, err := videoMeta(c, v); err == nil {
			st = st2
		}
		if passed, err := report(c, t, v, st, dur*pct, dur, rt); err == nil && passed {
			logf("  补报通过 %.0f%%", pct*100)
			return nil
		}
		sleepSec(math.Max(tickSec/2, 1))
	}
	// 换 token 再报几次
	for i := 0; i < 4; i++ {
		st2, err := videoMeta(c, v)
		if err != nil {
			sleepSec(2)
			continue
		}
		if passed, err := report(c, t, v, st2, dur*0.97, dur, rt); err == nil && passed {
			logf("  换 token 后通过")
			return nil
		}
		sleepSec(3)
	}
	return fmt.Errorf("多次上报仍未通过")
}

// cmdPlay 批量播放
type playOpts struct {
	All      bool
	Speed    float64
	Tick     float64
	Limit    int
	ObjectID string
	Dry      bool
	Debug    bool
}

func cmdPlay(args []string) error {
	opts := playOpts{All: true, Speed: 1, Tick: 10, Limit: 0}
	for _, a := range args {
		switch {
		case a == "--all":
			opts.All = true
		case a == "--dry":
			opts.Dry = true
		case a == "--debug":
			opts.Debug = true
		case strings.HasPrefix(a, "--speed="):
			opts.Speed = atofOr(strings.TrimPrefix(a, "--speed="), 1)
		case strings.HasPrefix(a, "--tick="):
			opts.Tick = atofOr(strings.TrimPrefix(a, "--tick="), 10)
		case strings.HasPrefix(a, "--limit="):
			opts.Limit = atoiOr(strings.TrimPrefix(a, "--limit="), 0)
		case strings.HasPrefix(a, "--objectid="):
			opts.ObjectID = strings.TrimPrefix(a, "--objectid=")
		}
	}

	var snap CourseSnapshot
	if err := readJSON(statePath("course.json"), &snap); err != nil {
		return fmt.Errorf("缺少 state/course.json，先执行 hsc course")
	}
	c := newClient(NewJar())
	if err := loadSession(c); err != nil {
		return err
	}
	defaultReportURL = snap.ReportURL

	var todo []VideoPoint
	for _, v := range snap.Videos {
		if opts.ObjectID != "" && v.ObjectID != opts.ObjectID {
			continue
		}
		if v.IsPassed {
			continue
		}
		todo = append(todo, v)
	}
	if opts.Limit > 0 && len(todo) > opts.Limit {
		todo = todo[:opts.Limit]
	}
	totalMin := 0
	for _, v := range todo {
		totalMin += v.AttDuration
	}
	logf("待处理 %d 个，合计 %.2f 小时", len(todo), float64(totalMin)/3600)

	ok, fail := 0, 0
	for i, v := range todo {
		logf("[%d/%d]", i+1, len(todo))
		if err := playOne(c, snap.Target, v, opts.Speed, opts.Tick, opts.Dry, opts.Debug); err != nil {
			logf("  失败: %v", err)
			fail++
			continue
		}
		ok++
	}
	logf("完成：成功 %d，失败 %d", ok, fail)
	return nil
}
