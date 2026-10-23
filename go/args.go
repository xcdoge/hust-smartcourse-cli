package main

import (
	"strings"
	"unicode"
)

// parseArgs 把交互模式里敲的一行拆成参数，支持引号：
//
//	init "https://a?x=1&y=2"  ->  ["init", "https://a?x=1&y=2"]
//	init 'https://...'        ->  单引号同样处理
//
// 不加引号时按空白拆分（URL 里没有空格，一般也该加引号，因为 & 在某些 shell 里有含义）。
func parseArgs(line string) []string {
	var out []string
	var cur strings.Builder
	inSingle, inDouble := false, false
	hasToken := false

	flush := func() {
		if hasToken {
			out = append(out, cur.String())
			cur.Reset()
			hasToken = false
		}
	}

	for _, r := range line {
		switch {
		case r == '\'' && !inDouble:
			inSingle = !inSingle
			hasToken = true
		case r == '"' && !inSingle:
			inDouble = !inDouble
			hasToken = true
		case unicode.IsSpace(r) && !inSingle && !inDouble:
			flush()
		default:
			cur.WriteRune(r)
			hasToken = true
		}
	}
	flush()
	return out
}

// trimQuotes 去掉参数两端残留的引号（防止用户多打了引号）
func trimQuotes(s string) string {
	return strings.Trim(s, `"'`)
}
