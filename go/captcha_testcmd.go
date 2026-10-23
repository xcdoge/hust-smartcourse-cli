package main

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// cmdCaptchaTest 用标注样本做留一验证，确认 Go 版识别器与 Node 版一致
func cmdCaptchaTest() error {
	model, err := loadCaptchaModel()
	if err != nil {
		return err
	}
	var labels map[string]string
	if err := readJSON(statePath("labels.json"), &labels); err != nil {
		return fmt.Errorf("缺少 state/labels.json: %w", err)
	}
	files, err := filepath.Glob(statePath("captchas", "*.gif"))
	if err != nil {
		return err
	}
	sort.Strings(files)
	if len(files) == 0 {
		return fmt.Errorf("state/captchas/ 下没有样本")
	}

	whole, digitOK, digitTotal := 0, 0, 0
	var wrong []string
	for _, f := range files {
		key := strings.TrimSuffix(filepath.Base(f), ".gif")
		want, ok := labels[key]
		if !ok {
			continue
		}
		data, err := os.ReadFile(f)
		if err != nil {
			continue
		}
		canvas, _, err := buildInkCanvas(data, 4)
		if err != nil {
			continue
		}
		bands := canvas.findBands(5, 2)
		got := ""
		for _, b := range bands {
			bits := canvas.cellBits(b[0], b[1], model.N)
			if bits == nil {
				continue
			}
			bestDigit, bestDist := "", 1<<30
			for _, s := range model.Samples {
				if s.Key == key { // 留一：剔除同源样本
					continue
				}
				if d := bestDistance(bits, s.Bits, model.N); d < bestDist {
					bestDist, bestDigit = d, s.Digit
				}
			}
			got += bestDigit
		}
		digitTotal += len(want)
		if got == want {
			whole++
			digitOK += len(want)
		} else {
			for i := 0; i < len(want) && i < len(got); i++ {
				if want[i] == got[i] {
					digitOK++
				}
			}
			wrong = append(wrong, fmt.Sprintf("%s 期望 %s 得 %s", key, want, got))
		}
	}
	fmt.Printf("样本 %d 张\n", len(files))
	fmt.Printf("单字准确率: %d/%d = %.1f%%\n", digitOK, digitTotal, float64(digitOK)*100/float64(digitTotal))
	fmt.Printf("整张准确率: %d/%d = %.1f%%\n", whole, len(files), float64(whole)*100/float64(len(files)))
	for i, w := range wrong {
		if i >= 8 {
			fmt.Printf("  ... 还有 %d 条\n", len(wrong)-8)
			break
		}
		fmt.Println("  " + w)
	}
	return nil
}
