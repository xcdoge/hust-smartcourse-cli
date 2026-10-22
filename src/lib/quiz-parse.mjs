// 解析「做作业」页面的题目
export function stripTags(s) {
  return String(s)
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 从作业页面 HTML 里抽出题目数组 */
export function parseQuiz(html) {
  // 优先按 singleQuesId（id="question<qid>"）切块，填空题只有这种方式能拿到 qid
  const blocks = [];
  const idRe = /<div[^>]*class="singleQuesId"[^>]*id="question(\d+)"/g;
  const starts = [];
  let m;
  while ((m = idRe.exec(html))) starts.push({ at: m.index, qid: m[1] });
  if (starts.length > 0) {
    for (let i = 0; i < starts.length; i++) {
      const end = i + 1 < starts.length ? starts[i + 1].at : html.length;
      blocks.push({ html: html.slice(starts[i].at, end), forceQid: starts[i].qid });
    }
  } else {
    const re = /<div[^>]*class="[^"]*TiMu[^"]*"/g;
    const s2 = [];
    while ((m = re.exec(html))) s2.push(m.index);
    for (let i = 0; i < s2.length; i++) {
      blocks.push({ html: html.slice(s2[i], i + 1 < s2.length ? s2[i + 1] : html.length), forceQid: null });
    }
  }

  const questions = [];
  for (const blk of blocks) {
    const b = blk.html;
    // 题型 + 题干
    const titleM = b.match(/<div[^>]*class="newZy_TItle"[^>]*>([\s\S]*?)<\/div>/);
    let titleHtml = titleM ? titleM[1] : b.slice(0, 800);
    const typeLabel = (titleHtml.match(/【([^】]+)】/) || [])[1] || '';
    // 题干：截到「（x分）」为止，去掉后面的选项噪音
    const cutM = titleHtml.match(/^([\s\S]*?（\s*[\d.]+\s*分\s*）)/);
    const titleClean = cutM ? cutM[1] : titleHtml;
    const stem = stripTags(titleClean.replace(/【[^】]+】/, ''));
    const score = (titleClean.match(/（\s*([\d.]+)\s*分\s*）/) || titleHtml.match(/（\s*([\d.]+)\s*分\s*）/) || [])[1] || '';

    // 选项：单选 name="answer<qid>"，多选 name="answercheck<qid>"
    const opts = [];
    const optRe =
      /<span[^>]*name="answer(check)?(\d+)"[^>]*data="([^"]*)"[^>]*>[\s\S]*?<\/span>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/g;
    let om;
    while ((om = optRe.exec(b))) {
      opts.push({ qid: om[2], value: om[3], text: stripTags(om[4]) });
    }
    // 题干里的 qid（没有选项时从 li/input 里找）
    const qidM =
      b.match(/<li[^>]*qid="(\d+)"/) ||
      b.match(/name="answer(\d+)"/) ||
      b.match(/id="answer(\d+)"/) ||
      b.match(/qid[=\s"':]+(\d+)/);
    const qid = blk.forceQid || (qidM ? qidM[1] : opts[0]?.qid || '');
    const qtypeM = b.match(/qtype="(\d+)"/);

    // 填空题：文本输入框
    const blanks = [];
    const blankRe = /<input[^>]*name="answer(\d+)"[^>]*>/g;
    let bm;
    while ((bm = blankRe.exec(b))) blanks.push(bm[1]);

    questions.push({
      qid,
      qtype: qtypeM ? Number(qtypeM[1]) : typeLabel.includes('单选') ? 0 : typeLabel.includes('多选') ? 1 : typeLabel.includes('判断') ? 3 : typeLabel.includes('填空') ? 4 : 9,
      typeLabel,
      stem,
      score,
      options: opts.map((o) => ({ value: o.value, text: o.text })),
      blankCount: blanks.length,
    });
  }
  return questions;
}
