/**
 * 听歌推荐控制器：POST /api/run/analyze-and-recommend
 *
 * 流程（A → B fallback）：
 *   前端上传录音 (multipart: audio)
 *     │
 *     ▼
 *   1) ACRCloud 识曲（没配 key 自动跳过）
 *        命中 → 在本地曲库按 title+artist 查 BPM → 命中则用，未命中继续
 *     │
 *     ▼
 *   2) music-tempo 本地 BPM 检测（+ 半/倍速修正）
 *     │
 *     ▼
 *   3) 用推导出的 BPM 查 /tracks（bpmMin/bpmMax = bpm±5），返回推荐
 *
 * 响应形态（前端据此做差异化文案）：
 *   {
 *     source: 'identified' | 'detected',
 *     bpm: 128,
 *     song?: { title, artist, album, score },  // identified 时才有
 *     detection?: { rawBpm, confidence, elapsedMs },  // detected 时才有
 *     recommendations: [...TrackDto]
 *   }
 */

import { Request, Response } from 'express';
import { appContainer } from '../../composition/container';
import { AppDataSource } from '../../config/database';
import { TrackEntity } from '../../infrastructure/persistence/Track.entity';
import { detectBpm } from '../../services/bpm-detection.service';
import { identifyTrack, RecognizedTrack } from '../../services/audio-recognize.service';

/** 从已识别歌曲反查本地曲库的 BPM；没查到返回 0。
 *  先用严格匹配 (title + artist)，再用模糊匹配 (title LIKE %xxx%)，尽量别误匹配翻唱版本。 */
async function lookupLocalBpm(rec: RecognizedTrack): Promise<number> {
  if (!rec.title) return 0;
  const repo = AppDataSource.getRepository(TrackEntity);

  // 优先：title + artist 都一致（或 artist 前缀匹配，处理"Artist A/Artist B"拼接）
  if (rec.artist) {
    const exact = await repo
      .createQueryBuilder('t')
      .where('LOWER(t.title) = LOWER(:title)', { title: rec.title })
      .andWhere('LOWER(t.artist) LIKE LOWER(:artist)', { artist: `%${rec.artist.split('/')[0].trim()}%` })
      .andWhere('t.isReference = 0')
      .limit(1)
      .getOne();
    if (exact && exact.bpm > 0) return exact.bpm;
  }

  // 兜底：只按 title 找一首有 BPM 的
  const fuzzy = await repo
    .createQueryBuilder('t')
    .where('LOWER(t.title) = LOWER(:title)', { title: rec.title })
    .andWhere('t.isReference = 0')
    .limit(1)
    .getOne();
  return fuzzy && fuzzy.bpm > 0 ? fuzzy.bpm : 0;
}

/** 查与目标 BPM 接近的推荐曲目（bpm ± tolerance）。 */
async function recommendByBpm(
  bpm: number,
  tolerance: number = 5,
  limit: number = 20,
): Promise<TrackEntity[]> {
  if (bpm <= 0) return [];
  const repo = AppDataSource.getRepository(TrackEntity);
  return repo
    .createQueryBuilder('t')
    .where('t.isReference = 0')
    .andWhere('t.bpm BETWEEN :lo AND :hi', { lo: bpm - tolerance, hi: bpm + tolerance })
    .orderBy('ABS(t.bpm - :target)', 'ASC')
    .setParameter('target', bpm)
    .limit(limit)
    .getMany();
}

function toTrackDto(t: TrackEntity) {
  return {
    id: t.id,
    title: t.title,
    artist: t.artist,
    album: t.album,
    coverUrl: t.coverUrl,
    bpm: t.bpm,
    language: t.language,
    genre: t.genre,
    motionForm: t.motionForm,
    speedFeel: t.speedFeel,
  };
}

/**
 * 主入口。路由里挂 multer.single('audio')，req.file.buffer 拿字节。
 * multer 字段名要求严格一致，前端也得用 name='audio' 上传。
 */
export async function analyzeAndRecommend(req: Request, res: Response) {
  try {
    const file = (req as any).file as { buffer: Buffer; size: number; mimetype: string } | undefined;
    if (!file || !file.buffer || file.buffer.length === 0) {
      return res.status(400).json({ message: '请先录音再上传' });
    }
    // 基本的大小限制，防止有人上传 500MB 的文件打爆后端
    if (file.buffer.length > 15 * 1024 * 1024) {
      return res.status(413).json({ message: '音频过大，请控制在 15MB 以内' });
    }

    const limit = Number(req.query.limit) > 0 ? Math.min(Number(req.query.limit), 50) : 20;
    const tolerance = Number(req.query.tolerance) > 0 ? Math.min(Number(req.query.tolerance), 15) : 5;

    // ====== 分支 A：识曲 ======
    let source: 'identified' | 'detected' = 'detected';
    let bpm = 0;
    let songInfo: { title: string; artist: string; album: string; score: number } | undefined;
    let detection: { rawBpm: number; confidence: number; elapsedMs: number } | undefined;

    const rec = await identifyTrack(file.buffer);
    if (rec != null && rec.title) {
      const localBpm = await lookupLocalBpm(rec);
      if (localBpm > 0) {
        source = 'identified';
        bpm = localBpm;
        songInfo = {
          title: rec.title,
          artist: rec.artist,
          album: rec.album,
          score: rec.score,
        };
      }
      // 曲库没这首 → 不提前退，继续走 B 分支做 BPM 检测
    }

    // ====== 分支 B：BPM 检测 ======
    if (bpm <= 0) {
      const result = await detectBpm(file.buffer);
      if (result.bpm <= 0) {
        return res.status(422).json({ message: '无法识别出节奏，请重新录制一段更清晰的音乐' });
      }
      source = 'detected';
      bpm = result.bpm;
      detection = {
        rawBpm: result.rawBpm,
        confidence: result.confidence,
        elapsedMs: result.elapsedMs,
      };
    }

    const recommendations = await recommendByBpm(bpm, tolerance, limit);

    return res.json({
      source,
      bpm,
      song: songInfo,
      detection,
      recommendations: recommendations.map(toTrackDto),
    });
  } catch (err: any) {
    console.error('[analyzeAndRecommend] 失败：', err);
    return res.status(500).json({ message: err?.message || '服务器错误' });
  }
}

// 显式提示 appContainer 未使用，避免 tsc noUnusedLocals 抗议
void appContainer;
