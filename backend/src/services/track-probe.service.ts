/**
 * 「未入库歌曲 → 自动 BPM 检测 → 入库」服务。
 *
 * 触发场景：
 *   用户在搜索页输入"花樽与花"，本地曲库（TrackEntity）没命中，前端把 title+artist
 *   抛给 POST /api/run/probe-track，由本服务尝试自动鉴定并落库。
 *
 * 流程：
 *   1) iTunes Search API 按 term=`title artist` 取头条结果，拿到 30s preview 的
 *      MP3 直链（previewUrl）；中文小众歌经常没有，找不到直接返回 null，让
 *      前端走"去录一段"的兜底路径。
 *   2) axios 下载 previewUrl 为 Buffer。
 *   3) 复用 detectBpm 服务过 ffmpeg + music-tempo 拿 BPM。
 *   4) 用 classifyBpm 把 BPM → motionForm / speedFeel，写一行 TrackEntity 到 DB。
 *      不打 isReference=true，跟正常曲目走同一个池子，下次搜索就能命中。
 *
 * 设计取舍：
 *   - 入库时不写 audioUrl —— iTunes 的 previewUrl 有 token，30s 后就 403，落库
 *     存了也没用。前端要播放还是走 song-detail 的同播深链。
 *   - title + artist 双字段做主键级别的去重，避免重复鉴定刷 DB。
 *   - 整个调用 12s 内必须有结果，否则前端 UI 会僵；超时统一 abort。
 */

import axios from 'axios';
import { AppDataSource } from '../config/database';
import { TrackEntity } from '../infrastructure/persistence/Track.entity';
import { detectBpm } from './bpm-detection.service';
import { classifyBpm } from '../domain/motion/BpmClassification';

const ITUNES_TIMEOUT_MS = 6000;
const PREVIEW_TIMEOUT_MS = 8000;
const PREVIEW_MAX_BYTES = 8 * 1024 * 1024; // 30s 预览正常 ~1MB，限 8MB 防滥用
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export type ProbeOutcome =
  | {
      ok: true;
      source: 'itunes-detected' | 'cached';
      track: {
        id: number;
        title: string;
        artist: string;
        bpm: number;
        motionForm: 'run' | 'walk';
        speedFeel: 'slow' | 'medium' | 'fast';
        language: string;
        genre: string;
      };
      detection?: { rawBpm: number; confidence: number; elapsedMs: number };
    }
  | { ok: false; reason: 'not_found' | 'preview_failed' | 'detect_failed'; message: string };

/** 用 LOWER 大小写不敏感地按 title+artist 找一条已入库的曲。 */
async function findExistingTrack(title: string, artist: string): Promise<TrackEntity | null> {
  const repo = AppDataSource.getRepository(TrackEntity);
  // artist 可能是 "周杰伦/费玉清" 这样的拼接，前缀模糊匹配更友好
  return repo
    .createQueryBuilder('t')
    .where('LOWER(t.title) = LOWER(:title)', { title })
    .andWhere('t.isReference = 0')
    .andWhere('LOWER(t.artist) LIKE LOWER(:artist)', { artist: `%${artist.split('/')[0].trim()}%` })
    .limit(1)
    .getOne();
}

type ItunesHit = {
  previewUrl: string;
  trackName: string;
  artistName: string;
  collectionName?: string;
  primaryGenreName?: string;
};

/** iTunes Search API：term=`title artist`，拿 30s preview 直链。找不到返回 null。 */
async function searchItunesPreview(title: string, artist: string): Promise<ItunesHit | null> {
  const term = artist ? `${title} ${artist}` : title;
  try {
    const resp = await axios.get('https://itunes.apple.com/search', {
      params: { term, media: 'music', entity: 'song', limit: 1, country: 'cn' },
      timeout: ITUNES_TIMEOUT_MS,
      headers: { 'User-Agent': UA },
    });
    const r = resp.data?.results?.[0];
    if (!r || !r.previewUrl) {
      console.warn('[probe] iTunes no preview for', term, 'resultCount=', resp.data?.resultCount);
      return null;
    }
    return {
      previewUrl: String(r.previewUrl),
      trackName: String(r.trackName || title),
      artistName: String(r.artistName || artist),
      collectionName: r.collectionName ? String(r.collectionName) : undefined,
      primaryGenreName: r.primaryGenreName ? String(r.primaryGenreName) : undefined,
    };
  } catch (e: any) {
    console.warn('[probe] iTunes search failed:', e?.code || e?.message || e);
    return null;
  }
}

/** 下载 previewUrl 为 Buffer，限 8MB。 */
async function downloadPreview(url: string): Promise<Buffer> {
  const resp = await axios.get<ArrayBuffer>(url, {
    responseType: 'arraybuffer',
    timeout: PREVIEW_TIMEOUT_MS,
    maxContentLength: PREVIEW_MAX_BYTES,
    headers: { 'User-Agent': UA },
  });
  const buf = Buffer.from(resp.data);
  if (buf.length === 0) throw new Error('preview 空文件');
  return buf;
}

/** 推断歌曲语言：iTunes 没给字段，按 title 是否含 CJK 字符粗判 zh / en。 */
function guessLanguage(title: string, artist: string): string {
  const s = `${title} ${artist}`;
  if (/[\u4e00-\u9fa5]/.test(s)) return 'zh';
  if (/[\u3040-\u30ff]/.test(s)) return 'ja';
  return 'en';
}

/** 主入口。 */
export async function probeTrack(rawTitle: string, rawArtist: string): Promise<ProbeOutcome> {
  const title = (rawTitle || '').trim();
  const artist = (rawArtist || '').trim();
  if (!title) {
    return { ok: false, reason: 'not_found', message: '缺少歌名' };
  }

  // 0) 已经在库就直接返回，免得反复鉴定刷 DB。
  const existing = await findExistingTrack(title, artist);
  if (existing && existing.bpm > 0) {
    return {
      ok: true,
      source: 'cached',
      track: {
        id: existing.id,
        title: existing.title,
        artist: existing.artist,
        bpm: existing.bpm,
        motionForm: existing.motionForm as 'run' | 'walk',
        speedFeel: existing.speedFeel as 'slow' | 'medium' | 'fast',
        language: existing.language,
        genre: existing.genre,
      },
    };
  }

  // 1) iTunes Search 拿 preview
  const hit = await searchItunesPreview(title, artist);
  if (!hit) {
    return {
      ok: false,
      reason: 'not_found',
      message: 'iTunes 找不到这首歌的试听链接，去录一段试试',
    };
  }

  // 2) 下载 + 3) detectBpm
  let pcmBuf: Buffer;
  try {
    pcmBuf = await downloadPreview(hit.previewUrl);
  } catch (e: any) {
    console.warn('[probe] download failed:', e?.code || e?.message || e);
    return { ok: false, reason: 'preview_failed', message: '试听下载失败，可能是网络问题' };
  }

  let detection: { bpm: number; rawBpm: number; confidence: number; elapsedMs: number };
  try {
    detection = await detectBpm(pcmBuf);
  } catch (e: any) {
    console.warn('[probe] detect failed:', e?.message || e);
    return { ok: false, reason: 'detect_failed', message: 'BPM 检测失败，请稍后再试' };
  }
  const finalBpm = Math.round(detection.bpm);
  if (finalBpm <= 0) {
    return { ok: false, reason: 'detect_failed', message: '没能从试听里检出节奏' };
  }

  // 4) 入库
  const cls = classifyBpm(finalBpm);
  const repo = AppDataSource.getRepository(TrackEntity);
  const row = repo.create({
    title: hit.trackName,
    artist: hit.artistName,
    album: hit.collectionName ?? null,
    coverUrl: null,
    bpm: cls.bpm,
    language: guessLanguage(hit.trackName, hit.artistName),
    genre: hit.primaryGenreName ?? '其他',
    motionForm: cls.motionForm,
    speedFeel: cls.speedFeel,
    audioUrl: null,
    isReference: false,
  });
  const saved = await repo.save(row);
  console.log(
    '[probe] saved',
    `id=${saved.id}`,
    `title=${saved.title}`,
    `artist=${saved.artist}`,
    `bpm=${saved.bpm}`,
    `motion=${saved.motionForm}`,
  );

  return {
    ok: true,
    source: 'itunes-detected',
    track: {
      id: saved.id,
      title: saved.title,
      artist: saved.artist,
      bpm: saved.bpm,
      motionForm: saved.motionForm as 'run' | 'walk',
      speedFeel: saved.speedFeel as 'slow' | 'medium' | 'fast',
      language: saved.language,
      genre: saved.genre,
    },
    detection: {
      rawBpm: detection.rawBpm,
      confidence: detection.confidence,
      elapsedMs: detection.elapsedMs,
    },
  };
}
