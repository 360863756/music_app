/**
 * 听歌识曲服务（ACRCloud）。
 *
 * 设计要点：
 *  - 通过环境变量配置：ACRCLOUD_HOST / ACRCLOUD_ACCESS_KEY / ACRCLOUD_ACCESS_SECRET
 *    三者任意一个没配，识曲能力直接降级（返回 null，上层 fallback 到 BPM 检测）。
 *  - 只上传前 N 秒样本（默认 10s，ACRCloud 建议 8~15s），不用把整段音频送过去。
 *  - 严格处理失败：网络挂了、超时、签名错、没识别出来，统一返回 null；让控制器走 B 分支。
 *
 * ACRCloud 识曲协议：
 *   POST https://<host>/v1/identify
 *   multipart/form-data 字段：
 *     - sample          (file, audio bytes)
 *     - sample_bytes    (number, 样本字节数)
 *     - access_key
 *     - data_type       ('audio')
 *     - signature_version ('1')
 *     - timestamp       (unix 秒)
 *     - signature       (HMAC-SHA1(string_to_sign, access_secret)，base64)
 *   string_to_sign = "POST\n/v1/identify\n{access_key}\naudio\n1\n{timestamp}"
 *
 * 响应（命中）：
 *   { status:{code:0}, metadata:{ music: [{ title, artists:[{name}], album:{name},
 *     external_metadata:{ spotify:{track:{id}}, isrc }, score }] } }
 * 未命中：status.code === 1001
 */

import crypto from 'crypto';
import axios from 'axios';
import FormData from 'form-data';

export type RecognizedTrack = {
  title: string;
  artist: string;
  album: string;
  /** Spotify track id（可用来查 audio features -> tempo），没有就空 */
  spotifyId: string;
  /** 国际标准音像制品编码，一些 BPM 库用这个索引 */
  isrc: string;
  /** 置信度 0~100（ACRCloud 的 score） */
  score: number;
};

type AcrConfig = {
  host: string;
  accessKey: string;
  accessSecret: string;
};

function loadConfig(): AcrConfig | null {
  const host = (process.env.ACRCLOUD_HOST || '').trim();
  const accessKey = (process.env.ACRCLOUD_ACCESS_KEY || '').trim();
  const accessSecret = (process.env.ACRCLOUD_ACCESS_SECRET || '').trim();
  if (!host || !accessKey || !accessSecret) return null;
  return { host, accessKey, accessSecret };
}

/** 计算 ACRCloud 签名：HMAC-SHA1(string_to_sign, access_secret) → base64 */
function signRequest(accessKey: string, accessSecret: string, timestamp: number): string {
  const stringToSign = [
    'POST',
    '/v1/identify',
    accessKey,
    'audio',
    '1',
    String(timestamp),
  ].join('\n');
  return crypto
    .createHmac('sha1', accessSecret)
    .update(Buffer.from(stringToSign, 'utf-8'))
    .digest('base64');
}

/**
 * 识别一段音频是哪首歌。识不出 / 未配置 key / 网络异常 一律返回 null，
 * 由上层决定 fallback 策略。
 */
export async function identifyTrack(sample: Buffer): Promise<RecognizedTrack | null> {
  const cfg = loadConfig();
  if (cfg == null) {
    // ACRCloud 未配置：静默返回 null，让上层走 BPM 检测分支
    return null;
  }
  if (!sample || sample.length === 0) return null;

  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signRequest(cfg.accessKey, cfg.accessSecret, timestamp);

    const form = new FormData();
    form.append('sample', sample, { filename: 'sample.audio', contentType: 'audio/mpeg' });
    form.append('sample_bytes', String(sample.length));
    form.append('access_key', cfg.accessKey);
    form.append('data_type', 'audio');
    form.append('signature_version', '1');
    form.append('timestamp', String(timestamp));
    form.append('signature', signature);

    const url = `https://${cfg.host}/v1/identify`;
    const resp = await axios.post(url, form, {
      headers: form.getHeaders(),
      timeout: 8000,
      maxContentLength: 10 * 1024 * 1024,
      validateStatus: () => true, // 自己处理非 2xx
    });

    if (resp.status < 200 || resp.status >= 300) {
      console.warn('[identifyTrack] ACRCloud HTTP', resp.status, resp.data);
      return null;
    }
    const body = resp.data || {};
    const code: number = body?.status?.code ?? -1;
    // 0 = 命中；1001 = 未识别；其它 = 错误
    if (code !== 0) {
      if (code !== 1001) console.warn('[identifyTrack] ACRCloud status', body?.status);
      return null;
    }
    const music: any[] = Array.isArray(body?.metadata?.music) ? body.metadata.music : [];
    if (music.length === 0) return null;

    // 取 score 最高的一首
    music.sort((a: any, b: any) => (b?.score || 0) - (a?.score || 0));
    const best = music[0] || {};
    const artists = Array.isArray(best.artists) ? best.artists : [];
    const artistName = artists
      .map((a: any) => (a?.name || '').toString().trim())
      .filter((s: string) => s)
      .join(' / ');
    const ext = best.external_metadata || {};

    return {
      title: (best.title || '').toString().trim(),
      artist: artistName,
      album: (best.album?.name || '').toString().trim(),
      spotifyId: (ext?.spotify?.track?.id || '').toString().trim(),
      isrc: (ext?.isrc || '').toString().trim(),
      score: Number(best.score || 0),
    };
  } catch (err) {
    console.warn('[identifyTrack] 异常：', (err as Error).message);
    return null;
  }
}

/**
 * 根据识别出的曲目反查 BPM。目前做两层：
 *   1) 本地曲库按 title + artist 模糊匹配（最稳、零成本）
 *   2) TODO：接 Spotify Audio Features / GetSongBPM 补齐冷门歌（后续迭代）
 * 查不到返回 0，让上层走 BPM 检测 fallback。
 *
 * 这里只做占位声明，真正实现放在控制器里通过 TrackRepository 查，避免服务层反向依赖。
 */
export function isRecognizeEnabled(): boolean {
  return loadConfig() != null;
}
