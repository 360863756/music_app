/**
 * 短信验证码存储 & 限频。
 *
 * 为什么用进程内 Map 而不上 Redis：
 *   - 当前服务是单机单进程部署（ts-node-dev / pm2 单实例）
 *   - 验证码本身生命周期只有 5 分钟，进程重启丢失可以接受（用户重新获取即可）
 *   - 接入 Redis 会引入运维成本，等真正多实例部署时再抽成 ICodeStore 接口即可
 *
 * 限频策略（防刷短信账单）：
 *   - 单个 (phone, scene) 60 秒内只能再发 1 次
 *   - 单个 phone 跨 scene 24h 内最多发 10 条
 *   - 单个 IP（由 controller 传入）1 分钟最多 5 条
 *
 * 校验策略：
 *   - 6 位数字验证码，5 分钟过期
 *   - 每个验证码最多尝试 5 次，超过即作废
 *   - 校验成功后立刻删除（防重放）
 *
 * scene 枚举：区分场景，防止"注册验证码"被用到"重置密码"等串用
 *   - 'register' / 'login' / 'reset' / 'bind'
 */

export type SmsScene = 'register' | 'login' | 'reset' | 'bind';

interface CodeRecord {
  code: string;
  expiresAt: number; // epoch ms
  attempts: number;
}

interface PhoneDailyRecord {
  windowStart: number; // epoch ms（滚动 24h 窗口起点）
  count: number;
}

interface IpMinuteRecord {
  windowStart: number; // epoch ms
  count: number;
}

const CODE_TTL_MS = 5 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const PHONE_DAILY_LIMIT = 10;
const PHONE_DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;
const IP_MINUTE_LIMIT = 5;
const IP_MINUTE_WINDOW_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

class SmsCodeStore {
  private codes = new Map<string, CodeRecord>(); // key: phone|scene
  private phoneDaily = new Map<string, PhoneDailyRecord>(); // key: phone
  private ipMinute = new Map<string, IpMinuteRecord>(); // key: ip
  private lastSendAt = new Map<string, number>(); // key: phone|scene

  private keyOf(phone: string, scene: SmsScene): string {
    return `${phone}|${scene}`;
  }

  /**
   * 尝试为 (phone, scene) 签发验证码。
   * 返回 { ok: true, code } 或 { ok: false, reason, retryAfter? }。
   * 通过所有限频后写入 store 并返回验证码（由上层传给 SMS sender 真发）。
   */
  issue(phone: string, scene: SmsScene, ip?: string): { ok: true; code: string } | { ok: false; reason: string; retryAfter?: number } {
    const now = Date.now();

    // 1) 60s 冷却（同 phone + scene）
    const k = this.keyOf(phone, scene);
    const last = this.lastSendAt.get(k);
    if (last != null) {
      const elapsed = now - last;
      if (elapsed < RESEND_COOLDOWN_MS) {
        const retryAfter = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
        return { ok: false, reason: `请求过于频繁，请 ${retryAfter} 秒后再试`, retryAfter };
      }
    }

    // 2) phone 24h 配额
    const daily = this.phoneDaily.get(phone);
    if (daily != null && now - daily.windowStart < PHONE_DAILY_WINDOW_MS) {
      if (daily.count >= PHONE_DAILY_LIMIT) {
        return { ok: false, reason: '该手机号今日验证码请求已达上限' };
      }
    }

    // 3) IP 1min 配额
    if (ip) {
      const ipRec = this.ipMinute.get(ip);
      if (ipRec != null && now - ipRec.windowStart < IP_MINUTE_WINDOW_MS) {
        if (ipRec.count >= IP_MINUTE_LIMIT) {
          return { ok: false, reason: '操作太频繁，请稍后再试' };
        }
      }
    }

    // 全部通过：生成 6 位数字码
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    this.codes.set(k, {
      code,
      expiresAt: now + CODE_TTL_MS,
      attempts: 0,
    });
    this.lastSendAt.set(k, now);

    // 计数更新
    if (daily == null || now - daily.windowStart >= PHONE_DAILY_WINDOW_MS) {
      this.phoneDaily.set(phone, { windowStart: now, count: 1 });
    } else {
      daily.count += 1;
    }
    if (ip) {
      const ipRec = this.ipMinute.get(ip);
      if (ipRec == null || now - ipRec.windowStart >= IP_MINUTE_WINDOW_MS) {
        this.ipMinute.set(ip, { windowStart: now, count: 1 });
      } else {
        ipRec.count += 1;
      }
    }

    return { ok: true, code };
  }

  /**
   * 校验验证码。成功返回 true 并删除记录；失败 attempts+1，超过上限作废。
   */
  verify(phone: string, scene: SmsScene, code: string): { ok: true } | { ok: false; reason: string } {
    const k = this.keyOf(phone, scene);
    const rec = this.codes.get(k);
    if (rec == null) {
      return { ok: false, reason: '验证码不存在或已过期，请重新获取' };
    }
    if (Date.now() > rec.expiresAt) {
      this.codes.delete(k);
      return { ok: false, reason: '验证码已过期，请重新获取' };
    }
    rec.attempts += 1;
    if (rec.attempts > MAX_ATTEMPTS) {
      this.codes.delete(k);
      return { ok: false, reason: '验证码已失效（尝试次数过多），请重新获取' };
    }
    if (rec.code !== code) {
      return { ok: false, reason: '验证码错误' };
    }
    this.codes.delete(k);
    return { ok: true };
  }

  /** 测试/管理用：直接清空（比如 reset 脚本跑完后） */
  clearAll(): void {
    this.codes.clear();
    this.lastSendAt.clear();
    this.phoneDaily.clear();
    this.ipMinute.clear();
  }
}

export const smsCodeStore = new SmsCodeStore();
