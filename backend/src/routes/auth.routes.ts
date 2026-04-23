import { Router } from 'express';
import {
  register,
  login,
  wechatLogin,
  getCurrentUser,
} from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth.middleware';

const router: import('express').Router = Router();

router.post('/register', register);
router.post('/login', login);
router.post('/wechat', wechatLogin);
router.get('/me', authenticate, getCurrentUser);

export default router;
