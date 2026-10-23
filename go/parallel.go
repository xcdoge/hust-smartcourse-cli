package main

import "sync"

// parallelEach 并发执行 fn(i, item)，最多 workers 个同时在跑。
// 单个任务出错不影响其他任务（错误由 fn 自己记录）。
func parallelEach(n, workers int, fn func(i int)) {
	if n <= 0 {
		return
	}
	if workers <= 0 {
		workers = 8
	}
	if workers > n {
		workers = n
	}
	sem := make(chan struct{}, workers)
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		sem <- struct{}{}
		go func(i int) {
			defer wg.Done()
			defer func() { <-sem }()
			fn(i)
		}(i)
	}
	wg.Wait()
}
