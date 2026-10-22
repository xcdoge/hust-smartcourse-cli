// 简单 CookieJar + 手动跟随重定向的 fetch 封装
// 用于：CAS 统一身份认证（pass.hust.edu.cn）→ 智慧课堂（smartcourse.hust.edu.cn）

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export class CookieJar {
  constructor() {
    /** @type {Map<string, Map<string,string>>} host -> name -> value */
    this.byHost = new Map();
  }

  load(obj) {
    this.byHost = new Map();
    for (const [host, kv] of Object.entries(obj || {})) {
      this.byHost.set(host, new Map(Object.entries(kv)));
    }
  }

  toJSON() {
    const out = {};
    for (const [host, m] of this.byHost) out[host] = Object.fromEntries(m);
    return out;
  }

  /** 选择对某 host 生效的 cookie：精确 host + 它的父域（.example.com / example.com） */
  getFor(url) {
    const host = new URL(url).hostname;
    const parts = host.split('.');
    const out = new Map();
    // 从最上层父域开始，子域覆盖父域
    for (let i = parts.length - 1; i >= 0; i--) {
      const h = parts.slice(i).join('.');
      for (const key of [h, '.' + h]) {
        const m = this.byHost.get(key);
        if (m) for (const [k, v] of m) out.set(k, v);
      }
    }
    return out;
  }

  header(url) {
    const m = this.getFor(url);
    if (m.size === 0) return '';
    return [...m].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  /** 吞下一个响应的 Set-Cookie */
  absorb(url, res) {
    const host = new URL(url).hostname;
    const list = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const raw of list) {
      const seg = raw.split(';');
      const kv = seg[0];
      const idx = kv.indexOf('=');
      if (idx < 0) continue;
      const name = kv.slice(0, idx).trim();
      const value = kv.slice(idx + 1).trim();
      let domain = host;
      let expired = false;
      for (const attr of seg.slice(1)) {
        const [k, v = ''] = attr.split('=');
        const key = k.trim().toLowerCase();
        if (key === 'domain' && v.trim()) domain = v.trim().replace(/^\./, '.');
        if (key === 'max-age' && Number(v) <= 0) expired = true;
        if (key === 'expires') {
          const t = Date.parse(v);
          if (!Number.isNaN(t) && t < Date.now()) expired = true;
        }
      }
      if (!this.byHost.has(domain)) this.byHost.set(domain, new Map());
      const m = this.byHost.get(domain);
      if (expired || value === '') m.delete(name);
      else m.set(name, value);
    }
  }
}

export async function httpGet(url, jar, extra = {}) {
  const headers = {
    'user-agent': DEFAULT_UA,
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'zh-CN,zh;q=0.9',
    ...extra.headers,
  };
  const cookie = jar ? jar.header(url) : '';
  if (cookie) headers.cookie = cookie;
  const { signal, timeoutMs = 30000, ...rest } = extra;
  const res = await fetch(url, {
    redirect: 'manual',
    ...rest,
    headers,
    signal: signal ?? AbortSignal.timeout(timeoutMs),
  });
  if (jar) jar.absorb(url, res);
  return res;
}

/** 手动跟随重定向，返回最终响应与跳转链 */
export async function follow(url, jar, { max = 12, headers = {} } = {}) {
  let cur = url;
  const chain = [];
  for (let i = 0; i < max; i++) {
    const res = await httpGet(cur, jar, { headers });
    const loc = res.headers.get('location');
    chain.push({ url: cur, status: res.status, location: loc });
    if (res.status >= 300 && res.status < 400 && loc) {
      // 丢弃 body，避免连接泄漏
      await res.arrayBuffer().catch(() => {});
      cur = new URL(loc, cur).toString();
      continue;
    }
    return { res, chain, url: cur };
  }
  throw new Error('重定向次数过多: ' + JSON.stringify(chain, null, 2));
}
