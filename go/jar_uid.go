package main

// UID 从 cookie 罐里取平台数字 uid（_uid / UID / uid）
func (j *Jar) UID() string {
	j.mu.Lock()
	defer j.mu.Unlock()
	for _, m := range j.data {
		for _, key := range []string{"_uid", "UID", "uid"} {
			if v, ok := m[key]; ok && v != "" {
				return v
			}
		}
	}
	return ""
}
