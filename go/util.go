package main

import (
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n]) + "…"
}

func encodeForm(m map[string]string) url.Values {
	v := url.Values{}
	for k, val := range m {
		v.Set(k, val)
	}
	return v
}

func urlQueryEscape(s string) string { return url.QueryEscape(s) }

func logf(format string, args ...any) {
	ts := time.Now().Format("15:04:05")
	msg := fmt.Sprintf("["+ts+"] "+format, args...)
	println(msg)
	if f, err := os.OpenFile(statePath("gcli.log"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644); err == nil {
		_, _ = f.WriteString(msg + "\n")
		_ = f.Close()
	}
}

func sleepSec(sec float64) {
	if sec <= 0 {
		return
	}
	time.Sleep(time.Duration(sec * float64(time.Second)))
}

func nowNano() int64 { return time.Now().UnixNano() }

func atoiOr(s string, def int) int {
	if n, err := strconv.Atoi(strings.TrimSpace(s)); err == nil {
		return n
	}
	return def
}

func atofOr(s string, def float64) float64 {
	if v, err := strconv.ParseFloat(strings.TrimSpace(s), 64); err == nil {
		return v
	}
	return def
}
