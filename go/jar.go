package main

import (
	"net/http"
	"net/url"
	"strings"
	"sync"
)

// Jar 一个可持久化的简易 cookie 罐：host -> name -> value
// 只做后缀匹配，够用（我们只跟 hust.edu.cn 下几个域打交道）
type Jar struct {
	mu   sync.Mutex
	data map[string]map[string]string
}

func NewJar() *Jar {
	return &Jar{data: map[string]map[string]string{}}
}

func hostOf(u *url.URL) string {
	return strings.ToLower(u.Hostname())
}

// 域名匹配：精确相等，或 cookie 的域是 host 的后缀
func domainMatches(cookieDomain, host string) bool {
	cookieDomain = strings.TrimPrefix(strings.ToLower(cookieDomain), ".")
	host = strings.ToLower(host)
	return host == cookieDomain || strings.HasSuffix(host, "."+cookieDomain)
}

func (j *Jar) SetCookies(u *url.URL, cookies []*http.Cookie) {
	j.mu.Lock()
	defer j.mu.Unlock()
	host := hostOf(u)
	for _, c := range cookies {
		domain := host
		if c.Domain != "" && domainMatches(c.Domain, host) {
			domain = strings.TrimPrefix(strings.ToLower(c.Domain), ".")
		}
		m, ok := j.data[domain]
		if !ok {
			m = map[string]string{}
			j.data[domain] = m
		}
		if c.MaxAge < 0 || c.Value == "" {
			delete(m, c.Name)
			continue
		}
		m[c.Name] = c.Value
	}
}

func (j *Jar) Cookies(u *url.URL) []*http.Cookie {
	j.mu.Lock()
	defer j.mu.Unlock()
	host := hostOf(u)
	var out []*http.Cookie
	for domain, m := range j.data {
		if !domainMatches(domain, host) {
			continue
		}
		for name, value := range m {
			out = append(out, &http.Cookie{Name: name, Value: value})
		}
	}
	return out
}

func (j *Jar) Snapshot() map[string]map[string]string {
	j.mu.Lock()
	defer j.mu.Unlock()
	out := make(map[string]map[string]string, len(j.data))
	for d, m := range j.data {
		cp := make(map[string]string, len(m))
		for k, v := range m {
			cp[k] = v
		}
		out[d] = cp
	}
	return out
}

func (j *Jar) Restore(data map[string]map[string]string) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.data = data
}

func (j *Jar) Header(u string) string {
	parsed, err := url.Parse(u)
	if err != nil {
		return ""
	}
	var parts []string
	for _, c := range j.Cookies(parsed) {
		parts = append(parts, c.Name+"="+c.Value)
	}
	return strings.Join(parts, "; ")
}

func (j *Jar) Save() error {
	return writeJSON(statePath("cookies.json"), j.Snapshot())
}

func (j *Jar) Load() error {
	var data map[string]map[string]string
	if err := readJSON(statePath("cookies.json"), &data); err != nil {
		return err
	}
	j.Restore(data)
	return nil
}

func (j *Jar) Count() int {
	j.mu.Lock()
	defer j.mu.Unlock()
	n := 0
	for _, m := range j.data {
		n += len(m)
	}
	return n
}
