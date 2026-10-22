# 协议逆向笔记

平台：`smartcourse.hust.edu.cn`，内核是**超星泛雅**（Chaoxing Fanya），部署了自定义的 CAS 单点登录与若干反爬/限速策略。

本文记录三块逆向结果：**登录链路**、**播放上报签名**、**测验交卷**。

---

## 一、登录链路

```
GET /mooc-smartcourse/mooc2-ans/...        → 302 /passport-smartcourse/login
                                           → 302 /fyportal-smartcourse/sso/hust
                                           → 302 https://pass.hust.edu.cn/cas/login?service=...
```

CAS 是 HUST 定制版 Apereo，前端脚本 `login_stander_new.js`：

1. `POST /cas/rsa` 返回 512 位 RSA 公钥（base64 SPKI）
2. 前端用 `JSEncrypt`（PKCS#1 v1.5）分别加密账号、密码，填入 `#ul` / `#pl`
3. 表单提交到 `/cas/login?service=...`，成功返回 `302 ...?ticket=ST-xxx`
4. 跟随 ticket 完成 SSO，拿到 `smartcourse` 域下的会话 cookie

Node 侧等价实现（`src/lib/cas.mjs`）：

```js
const key = crypto.createPublicKey({ key: Buffer.from(b64Spki,'base64'), format:'der', type:'spki' });
const enc = crypto.publicEncrypt({ key, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(text)).toString('base64');
```

### 踩坑记录

- **图形验证码是强校验的**（早期结论「不校验」是错的）：`/cas/code` 返回一张 **多帧动图**，
  填错会直接返回 `id="errormsghide">验证码错误`，跟密码错误是两种不同提示
- **验证码识别（已在本项目实现）**：
  1. GIF 多帧解码后取**交集**去噪（静止的数字在多帧都黑 → `cnt > 1` 才算墨迹）
  2. 按**列投影**切出 4 个数字块（比 hust-cli 写死的 x 偏移稳健）
  3. 每块裁紧包围盒、居中补到 24×24（**不缩放**，Python/Node 两边结果一致）
  4. 与标注样本做 1-NN（汉明距离），**允许 ±1 像素平移**取最小距离，
     并用 top1/top2 距离差作为置信度

  实测（80 张标注样本 = 320 个数字，留一验证）：

  | 策略 | 单字 | 整图 |
  | --- | --- | --- |
  | 1-NN | 95.9% | 84.7% |
  | 3-NN 投票 | 94.4% | 79.3% |
  | **1-NN + ±1 平移容差** | **97.8%** | **91.5%** |

  配合"低置信度就换图、失败就重试"的策略，连续多次自动化登录全部一次命中。
  实现见 `src/lib/gif.mjs`（手写 GIF 解码）、`src/lib/captcha.mjs`、`data/captcha-model.json`。

  注意：hust-cli 自带的码本**已随字体更换失效**（实测匹配度仅 130~170/340，满分 340），
  且它只比较"每行墨点数"（20 维），比本项目用的整幅二值图（576 维）弱很多。
  重建码本的方法见 `tools/build-model.py`（抓图 → 人工标注 → 生成模型）。
- **失败计数**：连续 5 次锁 1 分钟，不封号
- **扫码登录可行，但必须「先拿会话、再换票」**（见下一节）

### 账密登录（已验证，但需要验证码）

```
① GET  /cas/login              ← 不带 service！从页面抠 lt / execution
② GET  /cas/code               ← 拿验证码动图（多帧 GIF）
③ POST /cas/rsa                ← 拿公钥
④ POST /cas/login              ← 字段见下
      ua=<JSON> visitorId=<32hex> rsa="" ul pl code phoneCode lt execution _eventId=submit
      成功判据：302 → http://one.hust.edu.cn/
⑤ GET  /cas/login?service=<超星> → 302 带 ticket → 进站
```

实测结果：填对验证码后一次通过（`302 → one.hust.edu.cn` → 换票 → 章节页 155 个章节）。
`ul`/`pl` 用 RSA PKCS#1 v1.5 + base64；`ua` 是浏览器指纹 JSON；`visitorId` 持久化复用即可。

如果账号开了两步验证，响应会是 200 且页面含 `id="phoneCode"`，此时要再带企业微信验证码提交一次。

### 扫码登录：两步走（已验证）

一开始我以为扫码是死路，因为它返回的 `redirect_url` 里没有 `ticket`。实际上 CAS 的扫码**根本不发 service ticket**，它只给一个 `pass.hust.edu.cn` 的 CAS 会话：

```
① 二维码内容：https://pass.hust.edu.cn/cas/qyQrLogin?uuid=<32位hex>&service=
                                                                  ↑ 必须留空
② 轮询：GET /cas/checkQRCodeScan?random=<float>&uuid=<uuid>
        headers: X-Requested-With: XMLHttpRequest, Referer: /cas/login
        每 3 秒一次，最多 60 次
        扫地成功后响应体：{"redirect_url":"http://one.hust.edu.cn/"}
        同时 Set-Cookie: CASTGC=…      ← 这才是真正的登录凭证
③ GET redirect_url（用同一个 cookie jar）
④ 换票：GET /cas/login?service=<超星 SSO 地址>   → 302 带 ?ticket=ST-…
⑤ 跟随 ticket 进入 smartcourse，拿到业务 cookie
```

**三个必须注意的点**（每一个都让第一版失败过）：

| 坑 | 后果 |
| --- | --- |
| `service` 不能填 | 填了就拿不到会话，`redirect_url` 变成裸 service 地址 |
| 轮询必须**保存 Set-Cookie** | `CASTGC` 就是轮询响应里下发的；用裸 fetch 只发不收，会话就丢了 |
| 换票要单独再请求一次 | 扫码拿的是 CAS 会话，不是某一个系统的 ticket |

超星的 SSO service 是：`http://smartcourse.hust.edu.cn/fyportal-smartcourse/sso/hust`（注意是 **http**，不是 https）。

实现见 `src/login-qr.mjs`，实测可以完全替代手动导 cookie。
- **cookie 完整性**：`document.cookie` 拿不到 HttpOnly 的 `jrose-mooc-ans`、`_d`、`1731enc` 等，
  少了这些门户会 302 到 `/mh-smartcourse/logout`。必须从**网络面板的请求头**里整行复制。

---

## 二、播放上报签名

播放器模块 `/ananas/modules/video/index.js` 与 `/ananas/videojs-ext/videojs-ext.min.js` 都是
**obfuscator.io** 混淆（字符串数组 + 旋转 + 索引）。

### 还原方法

`tools/deobf-generic.mjs`：

1. 用**字符串感知**的括号匹配抠出 `function _0x????(){var _0x????=[...]}` 数组函数
2. 从文件开头的 `var _0xAAAA=_0xBBBB;` 拿到访问器，从其函数体解析下标偏移（`-0x123` 之类）
3. 直接 `new Function` 执行文件自带的旋转 IIFE（精确）——失败时回退到"按标识符密度打分"暴力试旋转
4. 把所有 `_0x????(0xNNN)` 引用替换成字面量

> `videojs-ext.min.js` 的旋转量是 **198**（脚本自动求出）。

### 上报流程

```http
GET /ananas/status/{objectid}?k={fid}&flag=normal&ro=0
```

响应（可能带 `var d=` 前缀，需宽松解析）：

```json
{ "status":"success", "duration":1896, "dtoken":"d58140ad...",
  "reportUrl":"https://smartcourse.hust.edu.cn/mooc-ans/multimedia/log/a/{cpi}",
  "rt":0.9, "filename":"...", "crc":"..." }
```

```http
GET {reportUrl}/{dtoken}?clazzId=…&playingTime=…&duration=…&clipTime=…
    &objectId=…&otherInfo=…&jobid=…&userid=…&isdrag=0&view=pc&enc=…
    &rt=…&videoFaceCaptureEnc=…&dtype=Video&_t=…&attDuration=…&attDurationEnc=…
    &courseEngineInfo=false
```

`enc` 算法（固定盐）：

```js
enc = md5(
  `[${clazzId}][${userid}][${jobid}][${objectId}][${playingTime*1000}]` +
  `[d_yHJ!$pdA~5][${duration*1000}][${clipTime}]`
)
```

### 关键细节（都是实测出来的）

| 细节 | 结论 |
| --- | --- |
| `otherInfo` | 内嵌 `&courseId=…`，**不能 URL 编码**，要原样拼进查询串 |
| `rt` | 必须与课程配置一致；取自 `otherInfo` 的 `rt_d`(→0.9) / `rt_1`(→1)。传错直接 `403 code=6` |
| `otherInfo` 里的 `-enc_xxx` | 是课程访问口令，原样透传 |
| `playTime` | 服务端会**被最后一次上报值覆盖**，不是取最大值 |
| `headOffset` | 才是历史最大进度 |
| 判过点 | 在 `duration - 2` 附近；**报满 100% 反而判无效** |
| 限速 | `rt_1` 的课会校验「上报进度 ≈ 真实流逝时间」，1.5x 都过不了 |

### 文档/图片任务点

`insertdoc` 附件的完成接口（取自 `/ananas/ueditor/documentJob.js` 的 `finishJob()`）：

```http
GET /mooc-ans/job/document?jobid=&knowledgeid=&courseid=&clazzid=
    &jtoken=&checkMicroTopic=true&microTopicId=&courseEngineInfo=false
→ {"msg":"添加考核点成功","status":true}    // 再次调用返回「考核点已经完成」
```

`jtoken` 就在附件对象里。

---

## 三、章节测验

### 抓题

`/mooc-ans/api/work?api=1&workId=…&jobid=…&originJobId=…&needRedirect=true&skipHeader=true&knowledgeid=…&ktoken=…&cpi=…&ut=s&clazzId=…&enc=…&utenc=…&mooc2=1&courseid=…`

这个接口的 **WAF 会检查 `Sec-Fetch-*` 头**，缺失直接 403。补齐：

```
sec-fetch-dest: iframe
sec-fetch-mode: navigate
sec-fetch-site: same-origin
upgrade-insecure-requests: 1
```

### 交卷

1. 先 `GET /mooc-ans/work/validate?classId=&courseId=&knowledgeId=&cpi=`（时间校验，返回的 `enc` 实际为空）
2. `POST` 到 `/mooc-ans/work/addStudentWorkNewWeb?…&ua=pc&formType=post&saveStatus=1&pos=&version=1`
3. 表单字段：
   - 原有隐藏域原样带上（`enc`、`workTimesEnc`、`totalQuestionNum`…）
   - `answerwqbid` = 所有 qid 逗号拼接 + 末尾逗号
   - 单选 `answer<qid>` = `A`
   - 多选 `answer<qid>` = 字母连写 `ABD`（不是逗号！）
   - 判断 `answer<qid>` = `true` / `false`
   - **填空（`answertype=2`）** `answer<qid>` = `[{"content":"每空内容","name":"1"},…]` 的 JSON

> 血泪教训：`answertype<qid>` 必须**沿用页面里的隐藏域值**（填空=2/单选=0/多选=1/判断=3），
> 不要用自己推断的题型覆盖。覆盖成 4（简答）后，服务端仍返回 `success`，
> 但批阅页「我的答案」是空的、得 0 分——**提交成功不等于填进去了**。

### 判分状态

- 批阅页标题 `查看已批阅作业` + 有「本次成绩」= 已批阅
- 标题 `查看作业` = 还没批；此时填空/简答一律显示 0 分，是**占位符**，不是真 0
- 含简答题的测验要等人工批改，整份会一直挂着

---

## 四、会话与限流

| 现象 | 原因 |
| --- | --- |
| 302 到 `/mh-smartcourse/logout` | cookie 残缺或会话过期（约 12 小时） |
| 403 `【9011】…code=6` | `rt` 参数与课程不符 |
| 同一个 `dtoken` 连续跳报后被忽略 | 限流；换新 `dtoken` 隔几秒再报即可 |
| 课程首页只有几百字节 | 它是 JS 壳，校验会话要用**章节列表页** |
