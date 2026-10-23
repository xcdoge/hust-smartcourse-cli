package main

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"fmt"
	"image/gif"
)

//go:embed data/captcha-model.json
var modelJSON []byte

const (
	captchaThreshold = 200
	digitCell        = 24 // 特征网格边长
)

type sample struct {
	Digit string
	Bits  []uint8
	Key   string
}

type captchaModel struct {
	N       int
	Samples []sample
}

var loadedModel *captchaModel

func loadCaptchaModel() (*captchaModel, error) {
	if loadedModel != nil {
		return loadedModel, nil
	}
	var raw struct {
		N       int                 `json:"N"`
		Samples [][]json.RawMessage `json:"samples"`
	}
	if err := json.Unmarshal(modelJSON, &raw); err != nil {
		return nil, fmt.Errorf("解析验证码模型失败: %w", err)
	}
	m := &captchaModel{N: raw.N}
	if m.N == 0 {
		m.N = digitCell
	}
	for _, row := range raw.Samples {
		if len(row) < 2 {
			continue
		}
		var digit string
		var bits []int
		var key string
		if len(row) > 2 {
			_ = json.Unmarshal(row[2], &key)
		}
		if err := json.Unmarshal(row[0], &digit); err != nil {
			continue
		}
		if err := json.Unmarshal(row[1], &bits); err != nil {
			continue
		}
		conv := make([]uint8, len(bits))
		for i, v := range bits {
			if v != 0 {
				conv[i] = 1
			}
		}
		m.Samples = append(m.Samples, sample{Digit: digit, Bits: conv, Key: key})
	}
	if len(m.Samples) == 0 {
		return nil, fmt.Errorf("验证码模型为空")
	}
	loadedModel = m
	return m, nil
}

// inkCanvas 多帧取交集去噪后的墨迹图
type inkCanvas struct {
	W, H int
	Mask []uint8
}

func buildInkCanvas(gifData []byte, maxFrames int) (*inkCanvas, int, error) {
	g, err := gif.DecodeAll(bytes.NewReader(gifData))
	if err != nil {
		return nil, 0, fmt.Errorf("GIF 解码失败: %w", err)
	}
	if len(g.Image) == 0 {
		return nil, 0, fmt.Errorf("GIF 没有帧")
	}
	n := len(g.Image)
	if n > maxFrames {
		n = maxFrames
	}
	b := g.Image[0].Bounds()
	w, h := b.Dx(), b.Dy()
	mask := make([]uint8, w*h)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			dark := 0
			for f := 0; f < n; f++ {
				img := g.Image[f]
				ib := img.Bounds()
				px, py := ib.Min.X+x, ib.Min.Y+y
				if px >= ib.Max.X || py >= ib.Max.Y {
					continue
				}
				r, gg, bb, _ := img.At(px, py).RGBA()
				gray := (float64(r)*0.3 + float64(gg)*0.59 + float64(bb)*0.11) / 256.0
				if gray < captchaThreshold {
					dark++
				}
			}
			if dark > 1 {
				mask[y*w+x] = 1
			}
		}
	}
	return &inkCanvas{W: w, H: h, Mask: mask}, len(g.Image), nil
}

// findBands 按列投影切出数字块
func (c *inkCanvas) findBands(minWidth, minInk int) [][2]int {
	var out [][2]int
	start := -1
	for x := 0; x <= c.W; x++ {
		ink := 0
		if x < c.W {
			for y := 0; y < c.H; y++ {
				ink += int(c.Mask[y*c.W+x])
			}
		}
		on := x < c.W && ink >= minInk
		if on && start < 0 {
			start = x
		} else if !on && start >= 0 {
			if x-start >= minWidth {
				out = append(out, [2]int{start, x})
			}
			start = -1
		}
	}
	return out
}

// cellBits 裁紧包围盒，居中放到 N×N（不缩放）
func (c *inkCanvas) cellBits(x0, x1, n int) []uint8 {
	y0, y1 := -1, -1
	for y := 0; y < c.H; y++ {
		for x := x0; x < x1; x++ {
			if c.Mask[y*c.W+x] != 0 {
				if y0 < 0 {
					y0 = y
				}
				y1 = y
				break
			}
		}
	}
	if y0 < 0 {
		return nil
	}
	y1++
	w, h := x1-x0, y1-y0
	grid := make([]uint8, n*n)
	ox, oy := (n-w)/2, (n-h)/2
	for y := y0; y < y1; y++ {
		for x := x0; x < x1; x++ {
			if c.Mask[y*c.W+x] == 0 {
				continue
			}
			gx, gy := x-x0+ox, y-y0+oy
			if gx >= 0 && gx < n && gy >= 0 && gy < n {
				grid[gy*n+gx] = 1
			}
		}
	}
	return grid
}

func shiftBits(bits []uint8, n, dx, dy int) []uint8 {
	if dx == 0 && dy == 0 {
		return bits
	}
	out := make([]uint8, n*n)
	for y := 0; y < n; y++ {
		for x := 0; x < n; x++ {
			if bits[y*n+x] == 0 {
				continue
			}
			nx, ny := x+dx, y+dy
			if nx >= 0 && nx < n && ny >= 0 && ny < n {
				out[ny*n+nx] = 1
			}
		}
	}
	return out
}

func hamming(a, b []uint8) int {
	d := 0
	n := len(a)
	if len(b) < n {
		n = len(b)
	}
	for i := 0; i < n; i++ {
		if a[i] != b[i] {
			d++
		}
	}
	return d
}

var shiftOffsets = [][2]int{{0, 0}, {1, 0}, {-1, 0}, {0, 1}, {0, -1}}

// bestDistance 允许 ±1 像素平移，取最小汉明距离
func bestDistance(bits, sampleBits []uint8, n int) int {
	best := 1 << 30
	for _, s := range shiftOffsets {
		d := hamming(shiftBits(bits, n, s[0], s[1]), sampleBits)
		if d < best {
			best = d
		}
	}
	return best
}

type digitScore struct {
	Digit string
	Dist  int
	Conf  float64
}

type captchaResult struct {
	Code   string
	Conf   float64
	Count  int
	Digits []digitScore
}

// recognizeCaptcha 识别验证码
func recognizeCaptcha(gifData []byte) (*captchaResult, error) {
	model, err := loadCaptchaModel()
	if err != nil {
		return nil, err
	}
	canvas, frames, err := buildInkCanvas(gifData, 4)
	if err != nil {
		return nil, err
	}
	bands := canvas.findBands(5, 2)
	res := &captchaResult{}
	for _, b := range bands {
		bits := canvas.cellBits(b[0], b[1], model.N)
		if bits == nil {
			continue
		}
		type cand struct {
			digit string
			dist  int
		}
		cands := make([]cand, 0, len(model.Samples))
		for _, s := range model.Samples {
			cands = append(cands, cand{digit: s.Digit, dist: bestDistance(bits, s.Bits, model.N)})
		}
		// 找最近与次近（不同数字）
		best, second := cands[0], cands[0]
		for _, c := range cands {
			if c.dist < best.dist {
				best = c
			}
		}
		second = cand{dist: 1 << 30}
		for _, c := range cands {
			if c.digit != best.digit && c.dist < second.dist {
				second = c
			}
		}
		conf := 0.0
		if second.dist > 0 && second.dist > best.dist {
			conf = float64(second.dist-best.dist) / float64(second.dist)
		}
		res.Digits = append(res.Digits, digitScore{Digit: best.digit, Dist: best.dist, Conf: conf})
		res.Code += best.digit
	}
	res.Count = len(res.Digits)
	res.Conf = 1
	for _, d := range res.Digits {
		if d.Conf < res.Conf {
			res.Conf = d.Conf
		}
	}
	_ = frames
	return res, nil
}
