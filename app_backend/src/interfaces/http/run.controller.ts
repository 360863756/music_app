import { Request, Response } from 'express';
import { appContainer } from '../../composition/container';
import { parseMotionForm } from '../../domain/motion/MotionForm';
import { parseSpeedFeel } from '../../domain/motion/SpeedFeel';
import { AppDataSource } from '../../config/database';
import { TrackEntity } from '../../infrastructure/persistence/Track.entity';
import { probeTrack } from '../../services/track-probe.service';

function num(q: unknown): number | undefined {
  if (q === undefined || q === null || q === '') return undefined;
  const n = parseInt(String(q), 10);
  return Number.isFinite(n) ? n : undefined;
}

export async function classifyBpm(req: Request, res: Response) {
  try {
    const bpm = num(req.body?.bpm);
    if (bpm === undefined) {
      return res.status(400).json({ message: 'bpm required' });
    }
    const result = appContainer.classifyBpm!.execute(bpm);
    res.json({ interpretation: result });
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
}

export async function searchTracks(req: Request, res: Response) {
  try {
    const referenceBpm = num(req.query.referenceBpm);
    const result = await appContainer.searchTracks!.execute({
      keyword: req.query.keyword as string | undefined,
      motionForm: parseMotionForm(req.query.motionForm as string | undefined),
      speedFeel: parseSpeedFeel(req.query.speedFeel as string | undefined),
      language: req.query.language as string | undefined,
      artist: req.query.artist as string | undefined,
      genre: req.query.genre as string | undefined,
      bpmMin: num(req.query.bpmMin),
      bpmMax: num(req.query.bpmMax),
      limit: num(req.query.limit),
      offset: num(req.query.offset),
      random: req.query.random === 'true' || req.query.random === '1',
      noCount: req.query.noCount === 'true' || req.query.noCount === '1',
      recommend: req.query.recommend === 'true' || req.query.recommend === '1',
      referenceBpm,
    });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
}

export async function getTrack(req: Request, res: Response) {
  try {
    const id = num(req.params.id);
    if (id === undefined) return res.status(400).json({ message: 'invalid id' });
    const referenceBpm = num(req.query.referenceBpm);
    const row = await appContainer.getTrack!.execute(id, referenceBpm);
    if (!row) return res.status(404).json({ message: 'not found' });
    res.json(row);
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
}

/** 组装引导参照曲的音频 URL：相对路径用 host 自动拼全；已是 http(s) 的保留 */
function absolutizeAudioUrl(req: Request, audioUrl: string | null | undefined): string {
  if (!audioUrl) return '';
  if (/^https?:\/\//i.test(audioUrl)) return audioUrl;
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${proto}://${host}${audioUrl.startsWith('/') ? '' : '/'}${audioUrl}`;
}

export async function onboardingReferenceTracks(req: Request, res: Response) {
  try {
    const repo = appContainer.trackRepo!;
    const [walk, run] = await Promise.all([
      repo.findReferenceByMotionForm('walk'),
      repo.findReferenceByMotionForm('run'),
    ]);
    const toDto = (t: typeof walk) => {
      if (!t) return null;
      return {
        id: t.id,
        title: t.title,
        artist: t.artist,
        bpm: t.bpm,
        motionForm: t.motionForm,
        speedFeel: t.speedFeel,
        audioUrl: absolutizeAudioUrl(req, t.audioUrl),
      };
    };
    res.json({ walk: toDto(walk), run: toDto(run) });
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
}

export async function onboardingRecommend(req: Request, res: Response) {
  try {
    const referenceBpm = num(req.body?.referenceBpm);
    const feedback = req.body?.feedback as string | undefined;
    if (referenceBpm === undefined) {
      return res.status(400).json({ message: 'referenceBpm required' });
    }
    if (feedback !== 'too_fast' && feedback !== 'too_slow' && feedback !== 'ok') {
      return res.status(400).json({ message: 'feedback must be too_fast | too_slow | ok' });
    }
    const result = await appContainer.onboardingRecommend!.execute(referenceBpm, feedback);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
}

/**
 * POST /api/run/probe-track  body: { title, artist? }
 * 用户搜了一首本地曲库没有的歌，前端把名字甩过来 → iTunes 拿 30s 试听 →
 * detectBpm → 入库。详见 services/track-probe.service.ts。
 *
 * 响应区分 ok / 失败 reason，让前端能给不同文案：
 *   ok=true:           {ok:true, source, track, detection?}
 *   not_found:         iTunes 没找到 / 试听 URL 不可用 → 引导用户去录音页
 *   preview_failed:    下载失败                       → 让用户稍后重试
 *   detect_failed:     算法没出节奏                   → 让用户稍后重试 / 录音
 */
export async function probeTrackHandler(req: Request, res: Response) {
  try {
    const title = (req.body?.title as string | undefined)?.toString().trim() || '';
    const artist = (req.body?.artist as string | undefined)?.toString().trim() || '';
    if (!title) {
      return res.status(400).json({ ok: false, reason: 'not_found', message: '请提供歌名' });
    }
    const out = await probeTrack(title, artist);
    if (!out.ok) {
      // 业务失败用 200，让前端按 reason 渲染不同 UI；HTTP 错误码留给真正的服务故障
      return res.json(out);
    }
    return res.json(out);
  } catch (e: any) {
    console.error('[probeTrackHandler] 内部错误：', e);
    return res.status(500).json({ ok: false, reason: 'detect_failed', message: e?.message || '服务器错误' });
  }
}

export async function listPlaylists(req: Request, res: Response) {
  try {
    const userId = parseInt((req as any).userId, 10);
    const list = await appContainer.listPlaylists!.execute(userId);
    res.json(
      list.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        motionForm: p.motionForm,
        trackCount: p.items.length,
        updatedAt: p.updatedAt,
      }))
    );
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
}

export async function getPlaylistDetail(req: Request, res: Response) {
  try {
    const userId = parseInt((req as any).userId, 10);
    const id = num(req.params.id);
    if (id === undefined) return res.status(400).json({ message: 'invalid id' });
    const detail = await appContainer.getPlaylistDetail!.execute(id, userId);
    if (!detail) return res.status(404).json({ message: 'not found' });
    res.json(detail);
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
}

export async function createPlaylist(req: Request, res: Response) {
  try {
    const userId = parseInt((req as any).userId, 10);
    const { name, description, motionForm } = req.body || {};
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ message: 'name required' });
    }
    const mf = motionForm ? parseMotionForm(motionForm) : undefined;
    const pl = await appContainer.createPlaylist!.execute(
      userId,
      name,
      typeof description === 'string' ? description : undefined,
      mf
    );
    res.status(201).json({ id: pl.id, name: pl.name });
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
}

export async function updatePlaylist(req: Request, res: Response) {
  try {
    const userId = parseInt((req as any).userId, 10);
    const id = num(req.params.id);
    if (id === undefined) return res.status(400).json({ message: 'invalid id' });
    const { name, description, motionForm } = req.body || {};
    const updated = await appContainer.updatePlaylist!.execute(id, userId, {
      name: typeof name === 'string' ? name : undefined,
      description: description === null ? null : typeof description === 'string' ? description : undefined,
      motionForm:
        motionForm === null ? null : motionForm ? parseMotionForm(motionForm) : undefined,
    });
    if (!updated) return res.status(404).json({ message: 'not found' });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
}

export async function deletePlaylist(req: Request, res: Response) {
  try {
    const userId = parseInt((req as any).userId, 10);
    const id = num(req.params.id);
    if (id === undefined) return res.status(400).json({ message: 'invalid id' });
    const ok = await appContainer.deletePlaylist!.execute(id, userId);
    if (!ok) return res.status(404).json({ message: 'not found' });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
}

export async function addPlaylistTrack(req: Request, res: Response) {
  try {
    const userId = parseInt((req as any).userId, 10);
    const id = num(req.params.id);
    const trackId = num(req.body?.trackId);
    if (id === undefined || trackId === undefined) {
      return res.status(400).json({ message: 'playlist id and trackId required' });
    }
    const pl = await appContainer.addTrackToPlaylist!.execute(id, userId, trackId);
    if (!pl) return res.status(404).json({ message: 'not found' });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
}

export async function removePlaylistTrack(req: Request, res: Response) {
  try {
    const userId = parseInt((req as any).userId, 10);
    const id = num(req.params.id);
    const trackId = num(req.params.trackId);
    if (id === undefined || trackId === undefined) {
      return res.status(400).json({ message: 'invalid params' });
    }
    const pl = await appContainer.removeTrackFromPlaylist!.execute(id, userId, trackId);
    if (!pl) return res.status(404).json({ message: 'not found' });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
}

export async function reorderPlaylistTracks(req: Request, res: Response) {
  try {
    const userId = parseInt((req as any).userId, 10);
    const id = num(req.params.id);
    if (id === undefined) return res.status(400).json({ message: 'invalid id' });
    const raw = (req.body || {}).trackIds;
    if (!Array.isArray(raw)) {
      return res.status(400).json({ message: 'trackIds must be array' });
    }
    const trackIds: number[] = [];
    for (const v of raw) {
      const n = num(v);
      if (n === undefined) return res.status(400).json({ message: 'invalid trackId' });
      trackIds.push(n);
    }
    const pl = await appContainer.reorderPlaylistTracks!.execute(id, userId, trackIds);
    if (!pl) return res.status(404).json({ message: 'playlist not found or trackIds mismatch' });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
}

export async function exportPlaylist(req: Request, res: Response) {
  try {
    const userId = parseInt((req as any).userId, 10);
    const id = num(req.params.id);
    if (id === undefined) return res.status(400).json({ message: 'invalid id' });
    const data = await appContainer.buildPlaylistExport!.execute(id, userId);
    if (!data) return res.status(404).json({ message: 'not found' });
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
}

// --- 歌单分享 / 导入 ---
// 分享是"无状态"的：把歌单快照（name/description/motionForm + 每条 track 的 id/title/artist/bpm）
// 塞进一个带前缀的 base64url 字符串返回给用户，用户发给朋友。朋友用自己的账号调 import，服务
// 端解码出快照，按 id 优先、title+artist 精确匹配兜底的顺序建一份新歌单。
//
// 选 stateless 的原因：不用改 DB，也没有"分享长期可用 / 会不会被撤回 / 过期"这些额外运维问题；
// 代价是分享码里含 playlist 内容，会略长（几十首大约 1~2KB），但完全可接受。

const SHARE_PREFIX = 'PLS1:';

type SharePayload = {
  v: 1;
  n: string; // name
  d?: string; // description
  m?: string; // motionForm
  t: Array<[number, string, string, number]>; // [id, title, artist, bpm]
};

function encodeShare(p: SharePayload): string {
  const json = JSON.stringify(p);
  const b64 = Buffer.from(json, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  return SHARE_PREFIX + b64;
}

function decodeShare(code: string): SharePayload | null {
  const raw = (code || '').trim();
  if (!raw.startsWith(SHARE_PREFIX)) return null;
  const b64 = raw
    .slice(SHARE_PREFIX.length)
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  try {
    const padded = b64 + '==='.slice((b64.length + 3) % 4);
    const json = Buffer.from(padded, 'base64').toString('utf8');
    const obj = JSON.parse(json);
    if (!obj || obj.v !== 1 || typeof obj.n !== 'string' || !Array.isArray(obj.t)) {
      return null;
    }
    return obj as SharePayload;
  } catch {
    return null;
  }
}

export async function getPlaylistShareCode(req: Request, res: Response) {
  try {
    const userId = parseInt((req as any).userId, 10);
    const id = num(req.params.id);
    if (id === undefined) return res.status(400).json({ message: 'invalid id' });
    const detail = await appContainer.getPlaylistDetail!.execute(id, userId);
    if (!detail) return res.status(404).json({ message: 'not found' });
    const payload: SharePayload = {
      v: 1,
      n: detail.name,
      d: detail.description ?? undefined,
      m: detail.motionForm ?? undefined,
      t: detail.tracks.map((t: any) => [
        Number(t.id) || 0,
        `${t.title || ''}`,
        `${t.artist || ''}`,
        Number(t.bpm) || 0,
      ] as [number, string, string, number]),
    };
    const shareCode = encodeShare(payload);
    // 另外给一份纯文本列表，便于用户直接贴到微信/备忘录等场景
    const textLines: string[] = [];
    textLines.push(`【歌单】${detail.name}`);
    if (detail.description) textLines.push(`说明：${detail.description}`);
    for (const t of detail.tracks as any[]) {
      textLines.push(`${t.artist} - ${t.title}  [BPM ${t.bpm}]`);
    }
    textLines.push('');
    textLines.push('—— 分享码（发给朋友，在 App「导入分享歌单」里粘贴）——');
    textLines.push(shareCode);
    res.json({
      shareCode,
      textSummary: textLines.join('\n'),
      trackCount: detail.tracks.length,
    });
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
}

export async function importPlaylistByShareCode(req: Request, res: Response) {
  try {
    const userId = parseInt((req as any).userId, 10);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(401).json({ message: 'login required' });
    }
    const rawCode = `${req.body?.shareCode ?? ''}`;
    const payload = decodeShare(rawCode);
    if (!payload) {
      return res.status(400).json({ message: '分享码无效或已损坏' });
    }

    // 1) 建空歌单（沿用 createPlaylist 的校验）
    const mf = payload.m ? parseMotionForm(payload.m) : undefined;
    const pl = await appContainer.createPlaylist!.execute(
      userId,
      payload.n || '未命名歌单',
      payload.d,
      mf
    );

    // 2) 逐条 resolve track：先按分享里的 id 找，拿不到再按 title+artist 精确匹配兜底
    const trackRepo = AppDataSource.getRepository(TrackEntity);
    let added = 0;
    const missed: Array<{ title: string; artist: string; bpm: number }> = [];
    for (const row of payload.t) {
      const [sid, title, artist, bpm] = row;
      let resolvedId: number | null = null;
      if (sid > 0) {
        const e = await trackRepo.findOne({ where: { id: sid, isReference: false } });
        if (e) resolvedId = e.id;
      }
      if (resolvedId == null && title && artist) {
        const e = await trackRepo.findOne({
          where: { title, artist, isReference: false },
        });
        if (e) resolvedId = e.id;
      }
      if (resolvedId != null) {
        try {
          await appContainer.addTrackToPlaylist!.execute(pl.id, userId, resolvedId);
          added += 1;
        } catch {
          missed.push({ title, artist, bpm });
        }
      } else {
        missed.push({ title, artist, bpm });
      }
    }

    res.json({
      id: pl.id,
      name: pl.name,
      total: payload.t.length,
      added,
      missed: missed.length,
      missedTracks: missed,
    });
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
}

export async function createMotionTemplate(req: Request, res: Response) {
  try {
    const body = req.body || {};
    const {
      title,
      description,
      motionForm,
      bpmMin,
      bpmMax,
      speedFeel,
      refTrackTitle,
      refTrackArtist,
      refBpm,
    } = body;
    if (!title || !motionForm || bpmMin === undefined || bpmMax === undefined || !speedFeel) {
      return res.status(400).json({ message: 'title, motionForm, bpmMin, bpmMax, speedFeel required' });
    }
    const mf = parseMotionForm(motionForm);
    const sf = parseSpeedFeel(speedFeel);
    if (!mf || !sf) return res.status(400).json({ message: 'invalid motionForm or speedFeel' });
    const userIdRaw = (req as any).userId;
    const userId = userIdRaw ? parseInt(userIdRaw, 10) : undefined;
    const tpl = await appContainer.createMotionTemplate!.execute({
      title,
      description: typeof description === 'string' ? description : undefined,
      motionForm: mf,
      bpmMin: num(bpmMin)!,
      bpmMax: num(bpmMax)!,
      speedFeel: sf,
      refTrackTitle: typeof refTrackTitle === 'string' ? refTrackTitle : undefined,
      refTrackArtist: typeof refTrackArtist === 'string' ? refTrackArtist : undefined,
      refBpm: num(refBpm),
      userId: Number.isFinite(userId!) ? userId : undefined,
    });
    res.status(201).json({
      shareCode: tpl.shareCode,
      title: tpl.title,
      deepLink: `/pages/run/template-open?code=${tpl.shareCode}`,
    });
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
}

export async function getMotionTemplate(req: Request, res: Response) {
  try {
    const code = (req.params.code || '').trim();
    if (!code) return res.status(400).json({ message: 'code required' });
    const referenceBpm = num(req.query.referenceBpm);
    const data = await appContainer.getMotionTemplateByShare!.execute(code, referenceBpm);
    if (!data) return res.status(404).json({ message: 'not found' });
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
}

export async function listMotionTemplates(req: Request, res: Response) {
  try {
    const limit = num(req.query.limit) ?? 20;
    const list = await appContainer.listRecentTemplates!.execute(limit);
    res.json(
      list.map((t) => ({
        shareCode: t.shareCode,
        title: t.title,
        motionForm: t.motionForm,
        bpmMin: t.bpmMin,
        bpmMax: t.bpmMax,
        speedFeel: t.speedFeel,
        createdAt: t.createdAt,
      }))
    );
  } catch (e: any) {
    res.status(500).json({ message: e.message });
  }
}
