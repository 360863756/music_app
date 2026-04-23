/**
 * BPM 检测服务。
 *
 * 流水线：上传的音频 buffer → 通过 ffmpeg 解码成 32-bit float mono PCM（单声道
 * 44.1kHz）→ 扔给 music-tempo 做自相关分析得出 tempo → 半/倍速修正到合理区间。
 *
 * 为什么选 ffmpeg + music-tempo：
 *  - ffmpeg 什么格式都能吃（MP3 / AAC / M4A / WAV / OGG / WebM…）
 *  - music-tempo 是纯 JS，不用编译原生插件；精度对跑步/健身音乐够用
 *  - 避免引入 Python/librosa 带来的 Docker 镜像膨胀
 *
 * 注意事项：
 *  - 依赖系统的 ffmpeg 二进制（Dockerfile 里 apk add ffmpeg）
 *  - music-tempo 没官方 d.ts，用 require + any，避免强塞类型
 *  - 长音频会很慢（CPU 密集），建议前端录 8~15 秒就够
 */

import { spawn } from 'child_process';

// music-tempo 没发布类型声明，用 require 拿，避免 import 触发 ts 报错
// eslint-disable-next-line @typescript-eslint/no-var-requires
const MusicTempo = require('music-tempo');

export type BpmDetectionResult = {
  /** 最终推荐的 BPM（已做半/倍速修正） */
  bpm: number;
  /** 原始检测到的 BPM（修正前），方便日志 / 调试 */
  rawBpm: number;
  /** 对结果的可信度 0~1；music-tempo 没提供，按检测时长粗估 */
  confidence: number;
  /** 检测耗时（毫秒） */
  elapsedMs: number;
};

/** ffmpeg 把任意音频 buffer 解成 32-bit float mono PCM。
 *  返回 Float32Array（宿主机字节序，小端，node 默认 LE，安全） */
function decodeToFloat32Pcm(
  input: Buffer,
  sampleRate: number,
): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    // -f f32le: raw 32-bit float little-endian
    // -ac 1:   单声道
    // -ar N:   重采样
    // pipe:0 / pipe:1 标识从 stdin 读、stdout 输出
    const ff = spawn('ffmpeg', [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', 'pipe:0',
      '-f', 'f32le',
      '-ac', '1',
      '-ar', String(sampleRate),
      'pipe:1',
    ]);

    const chunks: Buffer[] = [];
    let stderr = '';

    ff.stdout.on('data', (c: Buffer) => chunks.push(c));
    ff.stderr.on('data', (c: Buffer) => { stderr += c.toString(); });

    ff.on('error', (err) => {
      // ffmpeg 二进制不存在、或 spawn 本身失败
      reject(new Error(`ffmpeg 启动失败：${err.message}`));
    });

    ff.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg 解码失败 (exit=${code})：${stderr.trim()}`));
        return;
      }
      const raw = Buffer.concat(chunks);
      // Node Buffer 底层是 Uint8Array，需要对齐到 Float32（4 字节）的 byteOffset
      // 直接 new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)
      // 在某些 Node 版本上 byteOffset 不是 0，必须显式传；拷一份最安全
      const aligned = new Uint8Array(raw);
      const f32 = new Float32Array(aligned.buffer, aligned.byteOffset, Math.floor(aligned.byteLength / 4));
      resolve(f32);
    });

    ff.stdin.on('error', (err) => {
      // write 到已关闭的 stdin（非零 exit 时常见），ignore
      if ((err as NodeJS.ErrnoException).code === 'EPIPE') return;
      reject(err);
    });

    ff.stdin.end(input);
  });
}

/**
 * 半/倍速修正：music-tempo（和大部分 BPM 检测算法）常把 128 BPM 识别成
 * 64 或 256。跑步/健身/流行音乐 99% 落在 70-180 区间，越界就尝试 ×2 / ÷2。
 * 仍在区间外就原样返回（让调用方自己决定怎么处理）。
 */
function normalizeBpm(bpm: number): number {
  if (!isFinite(bpm) || bpm <= 0) return 0;
  let v = bpm;
  // 连续翻倍到下限之上
  while (v < 70 && v > 0) v *= 2;
  // 连续减半到上限之下
  while (v > 180) v /= 2;
  // 保留 1 位小数
  return Math.round(v * 10) / 10;
}

/**
 * 从音频 buffer 检测 BPM。
 * @param audioBuffer 上传的原始音频字节（任何 ffmpeg 能解的格式）
 * @param sampleRate 重采样目标；默认 44100；采样率越低越快但误差也会增大，一般别改
 */
export async function detectBpm(
  audioBuffer: Buffer,
  sampleRate: number = 44100,
): Promise<BpmDetectionResult> {
  if (!audioBuffer || audioBuffer.length === 0) {
    throw new Error('音频为空');
  }
  const t0 = Date.now();

  const pcm = await decodeToFloat32Pcm(audioBuffer, sampleRate);
  if (pcm.length === 0) {
    throw new Error('音频解码结果为空');
  }

  // music-tempo 要求输入是 plain array；Float32Array 在 v8 引擎里 .slice() 很快，
  // 但它的构造函数要普通数组。用 Array.from 在大样本下会慢（N 次分配），
  // 直接循环 push 也没更快——改成一次性 new Array(N) 再赋值。
  const samples: number[] = new Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) samples[i] = pcm[i];

  const mt = new MusicTempo(samples);
  const raw = Number(mt.tempo);

  const bpm = normalizeBpm(raw);
  const elapsedMs = Date.now() - t0;

  // 粗略估算可信度：音频越长越可信（>=8s 满值），短于 4s 可信度低
  const durationSec = pcm.length / sampleRate;
  let confidence: number;
  if (durationSec >= 8) confidence = 0.9;
  else if (durationSec >= 5) confidence = 0.7;
  else if (durationSec >= 3) confidence = 0.5;
  else confidence = 0.3;

  return { bpm, rawBpm: raw, confidence, elapsedMs };
}
