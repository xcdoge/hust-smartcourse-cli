package main

import "testing"

func TestSpeedLimited(t *testing.T) {
	cases := []struct {
		otherInfo string
		want      bool
	}{
		{"nodeId_1-cpi_2-rt_d-ds_1-ff_1-vt_1-v_5", false},
		{"nodeId_1-cpi_2-rt_0.9-ds_1-ff_1-vt_1-v_5", false},
		{"nodeId_1-cpi_2-rt_1-ds_1-ff_1-vt_1-v_5", true},
		{"nodeId_1-cpi_2-rt_1.5-ds_1", false}, // 允许 1.5 倍，不算限速
		{"", false},
	}
	for _, c := range cases {
		if got := speedLimited(c.otherInfo); got != c.want {
			t.Errorf("speedLimited(%q) = %v, 期望 %v", c.otherInfo, got, c.want)
		}
	}
}

func TestCourseRT(t *testing.T) {
	cases := map[string]float64{
		"rt_d-xx":   0.9,
		"rt_0.9":    0.9,
		"rt_1":      1,
		"rt_1.5":    1.5,
		"no-rt-tag": 0.9,
	}
	for in, want := range cases {
		if got := courseRT(in); got != want {
			t.Errorf("courseRT(%q) = %v, 期望 %v", in, got, want)
		}
	}
}

func TestSpeedSummary(t *testing.T) {
	cases := []struct {
		limited, total int
		want           string
	}{
		{0, 26, "全部支持倍速"},
		{26, 26, "全部限 1 倍速"},
		{3, 26, "3 个限 1 倍速"},
		{0, 0, "无任务点"},
	}
	for _, c := range cases {
		if got := speedSummary(c.limited, c.total); got != c.want {
			t.Errorf("speedSummary(%d,%d) = %q, 期望 %q", c.limited, c.total, got, c.want)
		}
	}
}
