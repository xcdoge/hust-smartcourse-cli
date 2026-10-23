package main

import (
	"crypto/rand"
	"crypto/rsa"
	"fmt"
	"math/big"
)

// encryptPKCS1v15 手写 PKCS#1 v1.5 加密。
//
// 为什么不直接用 rsa.EncryptPKCS1v15：
// Go 1.24 起对 <1024 位的 RSA 密钥直接报错
// （crypto/rsa: 512-bit keys are insecure），而 HUST CAS 发的就是 512 位公钥。
// 这里自己按 RFC 8017 拼 EM = 0x00 || 0x02 || PS || 0x00 || M，再做模幂。
func encryptPKCS1v15(pub *rsa.PublicKey, msg []byte) ([]byte, error) {
	k := (pub.N.BitLen() + 7) / 8
	if len(msg) > k-11 {
		return nil, fmt.Errorf("消息太长（%d 字节），密钥只有 %d 位", len(msg), pub.N.BitLen())
	}
	psLen := k - len(msg) - 3
	ps := make([]byte, psLen)
	if _, err := rand.Read(ps); err != nil {
		return nil, err
	}
	for i := range ps {
		if ps[i] == 0 {
			ps[i] = 1 // 填充串不能含 0x00
		}
	}
	em := make([]byte, 0, k)
	em = append(em, 0x00, 0x02)
	em = append(em, ps...)
	em = append(em, 0x00)
	em = append(em, msg...)

	m := new(big.Int).SetBytes(em)
	c := new(big.Int).Exp(m, big.NewInt(int64(pub.E)), pub.N)
	out := make([]byte, k)
	c.FillBytes(out)
	return out, nil
}
