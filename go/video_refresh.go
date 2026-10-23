package main

import "fmt"

// refreshedVideo 重新拉一次该章节的卡片，拿到最新的任务点参数。
//
// 为什么要这么做：course.json 里的 otherInfo 内嵌了课程访问口令（-enc_xxx），
// 还有 attDurationEnc / playTime 这些会变的东西。如果快照是上一次登录时抓的，
// 或者中途在浏览器里又看过，服务端会认为上报不合法——照样返回 200，但 isPassed 永远是 false。
func refreshedVideo(c *Client, t Target, v VideoPoint) (VideoPoint, error) {
	m, err := fetchCards(c, t, v.ChapterID, 0)
	if err != nil {
		return v, err
	}
	for _, a := range m.Attachments {
		mod := a.Property.Module
		if a.Type != "video" && mod != "insertvideo" {
			continue
		}
		oid := firstNonEmpty(a.ObjectID, a.ObjectIDCamel, a.Property.ObjectID)
		if oid != v.ObjectID {
			continue
		}
		out := v
		if a.JobID != "" {
			out.JobID = a.JobID
		}
		if a.OtherInfo != "" {
			out.OtherInfo = a.OtherInfo
		}
		if a.AttDuration > 0 {
			out.AttDuration = a.AttDuration
		}
		if a.AttDurationEnc != "" {
			out.AttDurationEnc = a.AttDurationEnc
		}
		if a.VideoFaceCaptureEnc != "" {
			out.VideoFaceCaptureEnc = a.VideoFaceCaptureEnc
		}
		out.PlayTime = a.PlayTime
		out.IsPassed = a.IsPassed
		return out, nil
	}
	return v, fmt.Errorf("章节 %s 里没找到 objectId=%s", v.ChapterID, v.ObjectID)
}

// describeReport 把一次上报的关键参数拼成一行，便于排查
func describeReport(c *Client, t Target, v VideoPoint, playingTime, rt float64) string {
	uid := c.Jar.UID()
	return fmt.Sprintf("uid=%s rt=%.2f objectId=%s jobid=%s play=%.0f otherInfo=%s",
		firstNonEmpty(uid, "(空)"), rt, truncate(v.ObjectID, 12), truncate(v.JobID, 14),
		playingTime, truncate(v.OtherInfo, 60))
}
