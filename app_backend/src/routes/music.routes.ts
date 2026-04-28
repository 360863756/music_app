import { Router } from 'express';
import {
  resolveMusicDeeplink,
  resolveAllDeeplinks,
} from '../interfaces/http/music.controller';

const router: import('express').Router = Router();

// 单平台解析：GET /api/music/resolve?title=晴天&artist=周杰伦&platform=netease
router.get('/resolve', resolveMusicDeeplink);

// 六家一次性并发解析（前端打开歌曲详情页时一次预取）：
// GET /api/music/resolve-all?title=晴天&artist=周杰伦
router.get('/resolve-all', resolveAllDeeplinks);

export default router;
