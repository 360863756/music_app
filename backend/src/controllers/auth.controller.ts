import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { AppDataSource } from '../config/database';
import { User } from '../models/User.model';
import { getWechatUserInfo } from '../services/wechat.service';
import { smsCodeStore, SmsScene } from '../services/sms-code.store';
import { createSmsSender } from '../services/sms.service';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const userRepository = AppDataSource.getRepository(User);
const smsSender = createSmsSender();
const IS_DEV = process.env.NODE_ENV !== 'production';

/* ============== 校验工具 ============== */

/** 用户名规则：3~20 位，允许字母/数字/下划线/中文，首字符不能是下划线 */
const USERNAME_RE = /^[A-Za-z0-9_\u4e00-\u9fa5]{3,20}$/;
function isValidUsername(s: string): boolean {
  if (!s || typeof s !== 'string') return false;
  if (s.startsWith('_')) return false;
  return USERNAME_RE.test(s);
}

/** 中国大陆手机号：1 开头，第二位 3-9，共 11 位 */
const PHONE_RE = /^1[3-9]\d{9}$/;
function isValidPhone(s: string): boolean {
  if (!s || typeof s !== 'string') return false;
  return PHONE_RE.test(s);
}

/** 密码规则：6~32 位，允许任意可见字符 */
function isValidPassword(s: string): boolean {
  if (!s || typeof s !== 'string') return false;
  return s.length >= 6 && s.length <= 32;
}

const VALID_SCENES: SmsScene[] = ['register', 'login', 'reset', 'bind'];
function isValidScene(s: any): s is SmsScene {
  return typeof s === 'string' && (VALID_SCENES as string[]).includes(s);
}

/** 签 token：subject 用 userId，附带 username 方便日志 */
function signToken(user: User): string {
  return jwt.sign(
    { userId: user.id.toString(), username: user.username },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

/** 打包给前端的用户信息（永远不回 password） */
function publicUser(user: User) {
  return {
    id: user.id,
    username: user.username,
    phone: user.phone || '',
    nickname: user.nickname || '',
    avatar: user.avatar || '',
  };
}

/** 拿请求方 IP（代理后面用 X-Forwarded-For 的第一跳） */
function clientIp(req: Request): string {
  const xff = (req.headers['x-forwarded-for'] || '') as string;
  if (xff) return xff.split(',')[0].trim();
  return req.ip || req.socket.remoteAddress || 'unknown';
}

/* ============== 发送验证码 ============== */

/**
 * POST /api/auth/sms/send
 * body: { phone: string, scene: 'register'|'login'|'reset'|'bind' }
 *
 * 各 scene 的预检：
 *   register → 要求该 phone **未被** 注册过
 *   login    → 要求该 phone **已经** 注册
 *   reset    → 要求该 phone **已经** 注册
 *   bind     → 要求该 phone **未被** 其他人占用（authenticate 中间件保证有当前用户）
 */
export const sendSmsCode = async (req: Request, res: Response) => {
  try {
    const { phone, scene } = req.body || {};
    if (!isValidPhone(phone)) {
      return res.status(400).json({ message: '手机号格式不正确' });
    }
    if (!isValidScene(scene)) {
      return res.status(400).json({ message: '验证码场景无效' });
    }

    const existing = await userRepository.findOne({ where: { phone } });

    if (scene === 'register' && existing) {
      return res.status(400).json({ message: '该手机号已注册' });
    }
    if ((scene === 'login' || scene === 'reset') && !existing) {
      return res.status(400).json({ message: '该手机号尚未注册' });
    }
    if (scene === 'bind') {
      const myId = (req as any).userId;
      if (!myId) {
        return res.status(401).json({ message: '请先登录' });
      }
      if (existing && existing.id.toString() !== myId.toString()) {
        return res.status(400).json({ message: '该手机号已被其他账号绑定' });
      }
    }

    const issued = smsCodeStore.issue(phone, scene, clientIp(req));
    if (!issued.ok) {
      return res.status(429).json({ message: issued.reason });
    }

    await smsSender.send(phone, issued.code, scene);

    // 开发/Mock 模式下把验证码回传给前端，方便联调；真实厂商永远不回
    const payload: any = { message: '验证码已发送', expiresInSec: 300 };
    if (IS_DEV && smsSender.echoCodeInDevResponse) {
      payload.devCode = issued.code;
    }
    return res.json(payload);
  } catch (error: any) {
    console.error('[sendSmsCode] error:', error);
    return res.status(500).json({ message: '服务异常，请稍后再试' });
  }
};

/* ============== 注册 ============== */

/**
 * POST /api/auth/register
 * body: { username, password, phone, smsCode }
 *
 * 约束：
 *   - username 规则见 isValidUsername
 *   - password 6-32 位
 *   - phone 必填 + 短信验证码必须先通过
 *   - username / phone 均唯一
 */
export const register = async (req: Request, res: Response) => {
  try {
    const { username, password, phone, smsCode } = req.body || {};

    if (!isValidUsername(username)) {
      return res.status(400).json({ message: '用户名格式不正确（3-20 位，支持字母/数字/下划线/中文）' });
    }
    if (!isValidPassword(password)) {
      return res.status(400).json({ message: '密码长度需为 6-32 位' });
    }
    if (!isValidPhone(phone)) {
      return res.status(400).json({ message: '手机号格式不正确' });
    }
    if (!smsCode || typeof smsCode !== 'string') {
      return res.status(400).json({ message: '请填写短信验证码' });
    }

    // 唯一性校验（先查，再比对验证码，失败时给用户更精确的提示）
    const exUser = await userRepository.findOne({ where: { username } });
    if (exUser) {
      return res.status(400).json({ message: '该用户名已被使用' });
    }
    const exPhone = await userRepository.findOne({ where: { phone } });
    if (exPhone) {
      return res.status(400).json({ message: '该手机号已注册' });
    }

    const verify = smsCodeStore.verify(phone, 'register', smsCode);
    if (!verify.ok) {
      return res.status(400).json({ message: verify.reason });
    }

    const hashed = await bcrypt.hash(password, 10);
    const user = userRepository.create({
      username,
      password: hashed,
      phone,
    });
    await userRepository.save(user);

    const token = signToken(user);
    return res.status(201).json({
      message: '注册成功',
      token,
      user: publicUser(user),
    });
  } catch (error: any) {
    console.error('[register] error:', error);
    return res.status(500).json({ message: '服务异常，请稍后再试' });
  }
};

/* ============== 密码登录（用户名或手机号 + 密码）============== */

/**
 * POST /api/auth/login
 * body: { account, password }    ← account 既可以填 username 也可以填 phone
 *
 * 为什么合并成 account 而不是拆两个接口：
 *   - 前端主登录页只有一个"账号"输入框就够了，UX 简洁
 *   - 自动按"11 位数字"判别是手机号还是用户名，降低用户理解负担
 */
export const login = async (req: Request, res: Response) => {
  try {
    const { account, password } = req.body || {};
    if (!account || !password) {
      return res.status(400).json({ message: '请填写账号和密码' });
    }
    if (typeof account !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ message: '账号或密码格式不正确' });
    }

    const acct = account.trim();
    const lookupField = PHONE_RE.test(acct) ? 'phone' : 'username';
    const user = await userRepository.findOne({ where: { [lookupField]: acct } as any });
    if (!user || !user.password) {
      return res.status(401).json({ message: '账号或密码错误' });
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res.status(401).json({ message: '账号或密码错误' });
    }

    const token = signToken(user);
    return res.json({
      message: '登录成功',
      token,
      user: publicUser(user),
    });
  } catch (error: any) {
    console.error('[login] error:', error);
    return res.status(500).json({ message: '服务异常，请稍后再试' });
  }
};

/* ============== 短信验证码登录 ============== */

/**
 * POST /api/auth/login-sms
 * body: { phone, smsCode }
 *
 * 面向场景：用户忘了密码但记得手机号；或老用户换机后快速登录。
 * 必须 phone 已注册（sendSmsCode 时已经预检，这里再兜一层）
 */
export const loginWithSms = async (req: Request, res: Response) => {
  try {
    const { phone, smsCode } = req.body || {};
    if (!isValidPhone(phone)) {
      return res.status(400).json({ message: '手机号格式不正确' });
    }
    if (!smsCode || typeof smsCode !== 'string') {
      return res.status(400).json({ message: '请填写验证码' });
    }

    const user = await userRepository.findOne({ where: { phone } });
    if (!user) {
      return res.status(400).json({ message: '该手机号尚未注册' });
    }

    const verify = smsCodeStore.verify(phone, 'login', smsCode);
    if (!verify.ok) {
      return res.status(400).json({ message: verify.reason });
    }

    const token = signToken(user);
    return res.json({
      message: '登录成功',
      token,
      user: publicUser(user),
    });
  } catch (error: any) {
    console.error('[loginWithSms] error:', error);
    return res.status(500).json({ message: '服务异常，请稍后再试' });
  }
};

/* ============== 手机号 + 验证码 重置密码 ============== */

/**
 * POST /api/auth/reset-password
 * body: { phone, smsCode, newPassword }
 *
 * 注意：
 *   - 不需要登录态；凭手机号 + 短信验证码证明本人
 *   - 重置成功后不自动登录（前端跳回登录页更稳妥，避免"自动登录但地址栏还停在找回页"的怪异体验）
 */
export const resetPassword = async (req: Request, res: Response) => {
  try {
    const { phone, smsCode, newPassword } = req.body || {};
    if (!isValidPhone(phone)) {
      return res.status(400).json({ message: '手机号格式不正确' });
    }
    if (!smsCode || typeof smsCode !== 'string') {
      return res.status(400).json({ message: '请填写验证码' });
    }
    if (!isValidPassword(newPassword)) {
      return res.status(400).json({ message: '新密码长度需为 6-32 位' });
    }

    const user = await userRepository.findOne({ where: { phone } });
    if (!user) {
      return res.status(400).json({ message: '该手机号尚未注册' });
    }

    const verify = smsCodeStore.verify(phone, 'reset', smsCode);
    if (!verify.ok) {
      return res.status(400).json({ message: verify.reason });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await userRepository.save(user);

    return res.json({ message: '密码重置成功，请用新密码登录' });
  } catch (error: any) {
    console.error('[resetPassword] error:', error);
    return res.status(500).json({ message: '服务异常，请稍后再试' });
  }
};

/* ============== 登录后修改密码（支持"旧密码"或"短信验证码"两种路径）============== */

/**
 * POST /api/auth/change-password   （需要登录）
 * body: { oldPassword?, smsCode?, newPassword }
 *
 * 任选其一方式证明身份：
 *   - oldPassword：传了就校验旧密码
 *   - smsCode    ：走 scene='reset'，前提是当前账号已绑定手机号
 */
export const changePassword = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) return res.status(401).json({ message: '未登录' });

    const { oldPassword, smsCode, newPassword } = req.body || {};
    if (!isValidPassword(newPassword)) {
      return res.status(400).json({ message: '新密码长度需为 6-32 位' });
    }

    const user = await userRepository.findOne({ where: { id: parseInt(userId) } });
    if (!user) return res.status(404).json({ message: '用户不存在' });

    // 二选一：短信验证码 或 旧密码
    if (smsCode && typeof smsCode === 'string') {
      if (!user.phone) {
        return res.status(400).json({ message: '当前账号未绑定手机号，无法使用短信验证' });
      }
      const verify = smsCodeStore.verify(user.phone, 'reset', smsCode);
      if (!verify.ok) {
        return res.status(400).json({ message: verify.reason });
      }
    } else if (oldPassword && typeof oldPassword === 'string') {
      if (!user.password) {
        return res.status(400).json({ message: '账号未设置密码，请使用短信验证码修改' });
      }
      const ok = await bcrypt.compare(oldPassword, user.password);
      if (!ok) {
        return res.status(400).json({ message: '旧密码错误' });
      }
    } else {
      return res.status(400).json({ message: '请提供旧密码或短信验证码' });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await userRepository.save(user);
    return res.json({ message: '密码修改成功' });
  } catch (error: any) {
    console.error('[changePassword] error:', error);
    return res.status(500).json({ message: '服务异常，请稍后再试' });
  }
};

/* ============== 绑定 / 换绑手机号（登录后）============== */

/**
 * POST /api/auth/bind-phone   （需要登录）
 * body: { phone, smsCode }
 *
 * 主要给微信登录用户首次补绑手机号用；也兼容已有手机用户的换绑。
 */
export const bindPhone = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) return res.status(401).json({ message: '未登录' });

    const { phone, smsCode } = req.body || {};
    if (!isValidPhone(phone)) {
      return res.status(400).json({ message: '手机号格式不正确' });
    }
    if (!smsCode || typeof smsCode !== 'string') {
      return res.status(400).json({ message: '请填写验证码' });
    }

    // 被别人占用了就拒绝
    const occupied = await userRepository.findOne({ where: { phone } });
    if (occupied && occupied.id.toString() !== userId.toString()) {
      return res.status(400).json({ message: '该手机号已被其他账号绑定' });
    }

    const verify = smsCodeStore.verify(phone, 'bind', smsCode);
    if (!verify.ok) {
      return res.status(400).json({ message: verify.reason });
    }

    const user = await userRepository.findOne({ where: { id: parseInt(userId) } });
    if (!user) return res.status(404).json({ message: '用户不存在' });

    user.phone = phone;
    await userRepository.save(user);

    return res.json({ message: '手机号绑定成功', user: publicUser(user) });
  } catch (error: any) {
    console.error('[bindPhone] error:', error);
    return res.status(500).json({ message: '服务异常，请稍后再试' });
  }
};

/* ============== 微信登录（保留，但不强制填手机号）============== */

export const wechatLogin = async (req: Request, res: Response) => {
  try {
    const { code } = req.body || {};
    if (!code) {
      return res.status(400).json({ message: '缺少微信登录 code' });
    }

    const wxInfo = await getWechatUserInfo(code);
    if (!wxInfo) {
      return res.status(401).json({ message: '微信登录失败' });
    }

    let user = await userRepository.findOne({ where: { wechatOpenId: wxInfo.openid } });
    if (user) {
      user.wechatUnionId = wxInfo.unionid;
      user.nickname = wxInfo.nickname;
      user.avatar = wxInfo.headimgurl;
      await userRepository.save(user);
    } else {
      // 自动生成一个 wx_xxx 用户名占位（不重要，反正微信用户主要靠 openId 识别）；
      // 有极小概率撞用户名，这里循环最多 5 次加随机尾缀兜底
      let candidate = `wx_${wxInfo.openid.substring(0, 10)}`;
      for (let i = 0; i < 5; i++) {
        const dup = await userRepository.findOne({ where: { username: candidate } });
        if (!dup) break;
        candidate = `wx_${wxInfo.openid.substring(0, 6)}_${Math.floor(Math.random() * 10000)}`;
      }
      user = userRepository.create({
        username: candidate,
        wechatOpenId: wxInfo.openid,
        wechatUnionId: wxInfo.unionid,
        nickname: wxInfo.nickname,
        avatar: wxInfo.headimgurl,
      });
      await userRepository.save(user);
    }

    const token = signToken(user);
    return res.json({
      message: '微信登录成功',
      token,
      user: publicUser(user),
      needBindPhone: !user.phone, // 前端据此提示去补绑手机号
    });
  } catch (error: any) {
    console.error('[wechatLogin] error:', error);
    return res.status(500).json({ message: '微信登录失败' });
  }
};

/* ============== 当前用户信息 ============== */

export const getCurrentUser = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const user = await userRepository.findOne({ where: { id: parseInt(userId) } });
    if (!user) return res.status(404).json({ message: '用户不存在' });
    return res.json({ user: publicUser(user) });
  } catch (error: any) {
    console.error('[getCurrentUser] error:', error);
    return res.status(500).json({ message: '服务异常，请稍后再试' });
  }
};
