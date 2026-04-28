import { Router } from 'express';
import {
  register,
  login,
  loginWithSms,
  resetPassword,
  changePassword,
  bindPhone,
  sendSmsCode,
  wechatLogin,
  getCurrentUser,
} from '../controllers/auth.controller';
import { authenticate, optionalAuthenticate } from '../middleware/auth.middleware';

const router: import('express').Router = Router();

/* 账号注册 / 登录（用户名 + 密码 / 手机号 + 密码 二合一） */
router.post('/register', register);
router.post('/login', login);

/* 短信登录 / 找回密码 */
router.post('/login-sms', loginWithSms);
router.post('/reset-password', resetPassword);

/* 登录后：修改密码 / 绑定手机号 */
router.post('/change-password', authenticate, changePassword);
router.post('/bind-phone', authenticate, bindPhone);

/* 发送短信验证码：scene=bind 需要登录；其它 scene 匿名可访问。
 * 用 optionalAuthenticate：两个分支都能用同一个接口，controller 内再做鉴权。 */
router.post('/sms/send', optionalAuthenticate, sendSmsCode);

/* 微信登录 */
router.post('/wechat', wechatLogin);

/* 当前登录用户 */
router.get('/me', authenticate, getCurrentUser);

export default router;
