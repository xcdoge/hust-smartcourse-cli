package main

import "testing"

func TestPlayTimeSeconds(t *testing.T) {
	cases := []struct {
		name     string
		playTime float64
		duration int
		want     float64
	}{
		{"未观看", 0, 351, 0},
		{"毫秒：349000 = 349 秒", 349000, 351, 349},
		{"秒：已经是秒就别再除", 100, 351, 100},
		{"毫秒小值：2000 = 2 秒", 2000, 60, 2},
		{"无时长信息时按秒处理", 50, 0, 50},
	}
	for _, c := range cases {
		got := playTimeSeconds(VideoPoint{PlayTime: c.playTime, AttDuration: c.duration})
		if got != c.want {
			t.Errorf("%s: playTimeSeconds(%v, %d) = %v, 期望 %v", c.name, c.playTime, c.duration, got, c.want)
		}
	}
}
