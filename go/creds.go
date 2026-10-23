package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"os/user"
	"strings"
	"time"

	"golang.org/x/crypto/scrypt"
)

const (
	encCredFile = "cred.enc.json"
	txtCredFile = "cred.txt"
)

type credFile struct {
	V       int    `json:"v"`
	Alg     string `json:"alg"`
	KDF     string `json:"kdf"`
	Salt    string `json:"salt"`
	IV      string `json:"iv"`
	Tag     string `json:"tag"`
	Data    string `json:"data"`
	SavedAt string `json:"savedAt"`
	User    string `json:"user"`
}

type Credentials struct {
	Username string
	Password string
	Source   string
}

// machineMaterial 机器指纹：换机器 / 换用户即失效
func machineMaterial() []byte {
	host, _ := os.Hostname()
	name := ""
	if u, err := user.Current(); err == nil {
		name = u.Username
		// Windows 下是 DOMAIN\user，Node 版只有 user，取最后一段对齐
		if i := strings.LastIndexAny(name, `\/`); i >= 0 {
			name = name[i+1:]
		}
		name = strings.ToLower(name)
	}
	extra := os.Getenv("HUST_CLI_KEY")
	// 与 Node 版保持一致：直接用原始字符串作为 scrypt 口令，方便两个版本互解
	return []byte(host + "|" + name + "|" + extra)
}

func maskUser(s string) string {
	r := []rune(s)
	if len(r) <= 4 {
		if len(r) == 0 {
			return ""
		}
		return string(r[0]) + "***"
	}
	return string(r[:4]) + "***"
}

func saveCreds(username, password string) error {
	salt := make([]byte, 16)
	iv := make([]byte, 12)
	if _, err := rand.Read(salt); err != nil {
		return err
	}
	if _, err := rand.Read(iv); err != nil {
		return err
	}
	key, err := scrypt.Key(machineMaterial(), salt, 16384, 8, 1, 32)
	if err != nil {
		return err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return err
	}
	plain, _ := json.Marshal(map[string]string{"u": username, "p": password, "t": fmt.Sprint(time.Now().Unix())})
	sealed := gcm.Seal(nil, iv, plain, nil)
	tag := sealed[len(sealed)-gcm.Overhead():]
	ct := sealed[:len(sealed)-gcm.Overhead()]

	cf := credFile{
		V: 1, Alg: "aes-256-gcm", KDF: "scrypt",
		Salt:    base64.StdEncoding.EncodeToString(salt),
		IV:      base64.StdEncoding.EncodeToString(iv),
		Tag:     base64.StdEncoding.EncodeToString(tag),
		Data:    base64.StdEncoding.EncodeToString(ct),
		SavedAt: time.Now().Format(time.RFC3339),
		User:    maskUser(username),
	}
	return writeJSON(statePath(encCredFile), cf)
}

func loadEncryptedCreds() (*Credentials, error) {
	var cf credFile
	if err := readJSON(statePath(encCredFile), &cf); err != nil {
		return nil, err
	}
	salt, err1 := base64.StdEncoding.DecodeString(cf.Salt)
	iv, err2 := base64.StdEncoding.DecodeString(cf.IV)
	tag, err3 := base64.StdEncoding.DecodeString(cf.Tag)
	data, err4 := base64.StdEncoding.DecodeString(cf.Data)
	for _, e := range []error{err1, err2, err3, err4} {
		if e != nil {
			return nil, fmt.Errorf("凭据文件损坏: %w", e)
		}
	}
	key, err := scrypt.Key(machineMaterial(), salt, 16384, 8, 1, 32)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	sealed := append(append([]byte{}, data...), tag...)
	plain, err := gcm.Open(nil, iv, sealed, nil)
	if err != nil {
		return nil, fmt.Errorf("解不开（换机器/换用户/被改过）: %w", err)
	}
	var out struct {
		U string `json:"u"`
		P string `json:"p"`
	}
	if err := json.Unmarshal(plain, &out); err != nil {
		return nil, err
	}
	if out.U == "" || out.P == "" {
		return nil, fmt.Errorf("凭据内容不完整")
	}
	return &Credentials{Username: out.U, Password: out.P, Source: "enc"}, nil
}

func loadPlainCreds() (*Credentials, error) {
	b, err := os.ReadFile(statePath(txtCredFile))
	if err != nil {
		return nil, err
	}
	var lines []string
	for _, l := range strings.Split(string(b), "\n") {
		l = strings.TrimSpace(l)
		if l != "" {
			lines = append(lines, l)
		}
	}
	if len(lines) < 2 {
		return nil, fmt.Errorf("state/cred.txt 需要两行：账号 / 密码")
	}
	return &Credentials{Username: lines[0], Password: lines[1], Source: "plain"}, nil
}

// loadCreds 优先加密文件，其次旧版明文
func loadCreds() (*Credentials, error) {
	if c, err := loadEncryptedCreds(); err == nil {
		return c, nil
	}
	if c, err := loadPlainCreds(); err == nil {
		return c, nil
	}
	return nil, fmt.Errorf("没有可用凭据。执行 hsc cred save <学号> <密码>，或在 state/cred.txt 写两行")
}

func migratePlainCreds() (bool, error) {
	c, err := loadPlainCreds()
	if err != nil {
		return false, nil
	}
	if err := saveCreds(c.Username, c.Password); err != nil {
		return false, err
	}
	_ = os.Remove(statePath(txtCredFile))
	return true, nil
}

func forgetCreds() []string {
	var removed []string
	for _, f := range []string{encCredFile, txtCredFile} {
		if _, err := os.Stat(statePath(f)); err == nil {
			if os.Remove(statePath(f)) == nil {
				removed = append(removed, f)
			}
		}
	}
	return removed
}
