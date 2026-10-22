// HUST 统一身份认证（Apereo CAS，自定义前端）登录
// 流程： GET service -> CAS login 页(拿 lt/execution) -> POST /cas/rsa(拿 publicKey)
//        -> RSA(PKCS1v15) 加密账号密码 -> POST /cas/login -> 302 service?ticket=ST-xxx
import crypto from 'node:crypto';
import { CookieJar, httpGet, follow } from './http.mjs';

export const CAS_ORIGIN = 'https://pass.hust.edu.cn';
export const SMART_ORIGIN = 'https://smartcourse.hust.edu.cn';
export const SSO_SERVICE = `${SMART_ORIGIN}/fyportal-smartcourse/sso/hust`;

export function rsaEncrypt(b64Spki, text) {
  const key = crypto.createPublicKey({
    key: Buffer.from(b64Spki, 'base64'),
    format: 'der',
    type: 'spki',
  });
  return crypto
    .publicEncrypt({ key, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(text, 'utf8'))
    .toString('base64');
}

export function parseLoginPage(html) {
  const pick = (re) => {
    const m = html.match(re);
    return m ? m[1] : null;
  };
  return {
    lt: pick(/id="lt"\s+name="lt"\s+value="([^"]*)"/) || pick(/name="lt"\s+value="([^"]*)"/),
    execution: pick(/name="execution"\s+value="([^"]*)"/),
    eventId: pick(/name="_eventId"\s+value="([^"]*)"/) || 'submit',
    hasCaptcha: /id="codeImage"/.test(html),
    errormsg: (html.match(/id="errormsghide"[^>]*>([\s\S]{0,400}?)</) || [])[1]?.trim() || null,
  };
}

export class CasSession {
  constructor(jar = new CookieJar()) {
    this.jar = jar;
    // 复刻浏览器自动填的隐藏域（UAParser 结果 + FingerprintJS 32 位哈希）
    this.uaJson = JSON.stringify({
      ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      browser: { name: 'Chrome', version: '131.0.0.0', major: '131' },
      engine: { name: 'Blink', version: '131.0.0.0' },
      os: { name: 'Windows', version: '10' },
      device: { vendor: undefined, model: undefined, type: undefined },
      cpu: { architecture: 'amd64' },
    });
    this.visitorId = crypto.randomBytes(16).toString('hex');
  }

  loginUrl() {
    return `${CAS_ORIGIN}/cas/login?service=${encodeURIComponent(SSO_SERVICE)}`;
  }

  /** 打开登录页，拿 lt/execution 与验证码状态 */
  async open() {
    const { res, chain, url } = await follow(this.loginUrl(), this.jar);
    const html = await res.text();
    this.page = parseLoginPage(html);
    this.pageHtml = html;
    this.pageUrl = url;
    this.pageChain = chain;
    return this.page;
  }

  /** 拉验证码图片（PNG buffer），返回 {buffer, contentType} */
  async captcha() {
    const url = `${CAS_ORIGIN}/cas/code?${Math.random()}`;
    const res = await httpGet(url, this.jar);
    const buf = Buffer.from(await res.arrayBuffer());
    return { buffer: buf, contentType: res.headers.get('content-type') || 'image/png' };
  }

  /** 提交账号密码，成功返回 ticket（字符串）；失败抛错并带 message */
  async submit({ username, password, captcha = '' }) {
    const rsaRes = await httpGet(`${CAS_ORIGIN}/cas/rsa`, this.jar, {
      method: 'POST',
      headers: {
        'x-requested-with': 'XMLHttpRequest',
        referer: this.loginUrl(),
        accept: 'application/json, text/javascript, */*; q=0.01',
      },
    });
    const { publicKey } = await rsaRes.json();

    const body = new URLSearchParams({
      un: username,
      pd: password,
      ul: rsaEncrypt(publicKey, username),
      pl: rsaEncrypt(publicKey, password),
      lt: this.page?.lt ?? '',
      execution: this.page?.execution ?? 'e1s1',
      _eventId: this.page?.eventId ?? 'submit',
      code: captcha,
      code2: captcha,
      ua: this.uaJson,
      visitorId: this.visitorId,
      skipWechat: 'true',
    });
    // 浏览器表单里有两个同名的空 rsa 隐藏域，逐字节对齐
    body.append('rsa', '');
    body.append('rsa', '');
    body.append('not_exit_number', '');
    body.append('service_id', '');

    const res = await httpGet(`${CAS_ORIGIN}/cas/login?service=${encodeURIComponent(SSO_SERVICE)}`, this.jar, {
      method: 'POST',
      body: body.toString(),
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: CAS_ORIGIN,
        referer: this.loginUrl(),
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    if (res.status === 302 || res.status === 303) {
      const loc = res.headers.get('location');
      await res.arrayBuffer().catch(() => {});
      const ticket = new URL(loc, CAS_ORIGIN).searchParams.get('ticket');
      if (ticket) return { ok: true, ticket, location: loc };
      return { ok: false, stage: 'redirect-no-ticket', location: loc };
    }

    const html = await res.text();
    const info = parseLoginPage(html);
    const msg =
      info.errormsg ||
      (html.match(/<div[^>]*id="msg"[^>]*>([\s\S]{0,300}?)<\/div>/) || [])[1] ||
      (html.match(/msg[^>]*>([^<]{0,200})</) || [])[1] ||
      '未知错误';
    return {
      ok: false,
      stage: 'form',
      status: res.status,
      message: msg.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
      needsCaptcha: /验证码|code/i.test(html) && /验证码/.test(html),
      html,
    };
  }

  /** 走完 SSO，把 smartcourse 的会话 cookie 落到 jar 里 */
  async completeSso(ticket) {
    const url = `${SSO_SERVICE}?ticket=${encodeURIComponent(ticket)}`;
    const { res, url: finalUrl, chain } = await follow(url, this.jar);
    const status = res.status;
    const html = await res.text();
    return { status, finalUrl, chain, htmlLen: html.length };
  }
}
