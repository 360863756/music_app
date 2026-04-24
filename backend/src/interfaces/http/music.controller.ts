/**
 * 音乐深链解析 HTTP 控制器
 *
 * 路由：
 *   GET /api/music/resolve?title=xxx&artist=xxx&platform=apple|spotify|netease|qq|kugou
 *     单平台解析：返回 { ok, data: ResolvedSong | null }
 *
 *   GET /api/music/resolve-all?title=xxx&artist=xxx
 *     五家一次性并发解析：返回 { ok, data: { apple?, spotify?, netease?, qq?, kugou? } }
 *
 * 失败策略：
 *   - 参数缺失 → 400
 *   - 单平台解析失败不算错，data 返回 null，由前端决定兜底
 */

import { Request, Response } from 'express';
import {
  resolveOne,
  resolveAll,
  MusicPlatform,
} from '../../services/music-resolve.service';

const VALID_PLATFORMS: MusicPlatform[] = [
  'apple',
  'spotify',
  'netease',
  'qq',
  'kugou',
];

export async function resolveMusicDeeplink(req: Request, res: Response) {
  try {
    const title = String(req.query.title || '').trim();
    const artist = String(req.query.artist || '').trim();
    const platform = String(req.query.platform || '').trim() as MusicPlatform;

    if (!title) {
      return res.status(400).json({ ok: false, message: '缺少 title 参数' });
    }
    if (!VALID_PLATFORMS.includes(platform)) {
      return res.status(400).json({
        ok: false,
        message: `platform 必须是 ${VALID_PLATFORMS.join('/')} 之一`,
      });
    }

    const data = await resolveOne(platform, title, artist);
    return res.json({ ok: true, data });
  } catch (err: any) {
    console.error('[resolveMusicDeeplink] 失败:', err);
    return res.status(500).json({ ok: false, message: err?.message || '服务器错误' });
  }
}

export async function resolveAllDeeplinks(req: Request, res: Response) {
  try {
    const title = String(req.query.title || '').trim();
    const artist = String(req.query.artist || '').trim();
    if (!title) {
      return res.status(400).json({ ok: false, message: '缺少 title 参数' });
    }
    const data = await resolveAll(title, artist);
    return res.json({ ok: true, data });
  } catch (err: any) {
    console.error('[resolveAllDeeplinks] 失败:', err);
    return res.status(500).json({ ok: false, message: err?.message || '服务器错误' });
  }
}
