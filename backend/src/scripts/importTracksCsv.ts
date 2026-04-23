import 'reflect-metadata';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { parse } from 'csv-parse/sync';
import { AppDataSource } from '../config/database';
import { TrackEntity } from '../infrastructure/persistence/Track.entity';
import { classifyBpm } from '../domain/motion/BpmClassification';

dotenv.config();

/**
 * 从 `初步可用BPM数据/merged_dedup_all.csv` 批量导入曲目，同时清掉所有非引导（isReference=false）
 * 的旧曲目。playlist_tracks 通过 FK 的 ON DELETE CASCADE 自动清掉。引导曲（walk/run guide）不动。
 *
 * CSV 列：作者,歌名,BPM,拍号,热度
 * - BPM 可能是小数（155.5 / 108.02），统一四舍五入成整数。
 * - 歌名可能包含半角逗号（RFC4180 引号转义），走 csv-parse，不要自己切。
 * - language：title+artist 含 CJK → 'zh'；全 ASCII → 'en'；否则 'other'。
 * - genre：留空串（原 CSV 的"拍号"不是流派，不强塞进去）。
 * - motionForm / speedFeel 走 classifyBpm(bpm)。
 *
 * 环境变量：
 * - CSV_PATH：csv 绝对路径，默认 <repoRoot>/初步可用BPM数据/merged_dedup_all.csv
 * - IMPORT_BATCH_SIZE：单批插入行数，默认 1000
 * - IMPORT_KEEP_OLD：设为 '1' 则不删除旧曲目（追加模式）
 */

type CsvRow = {
  artist: string;
  title: string;
  bpm: number;
  heat: number | null;
};

const CSV_PATH =
  process.env.CSV_PATH ||
  path.resolve(process.cwd(), '..', '初步可用BPM数据', 'merged_dedup_all.csv');
const BATCH = Math.max(100, parseInt(process.env.IMPORT_BATCH_SIZE || '1000', 10));
const KEEP_OLD = process.env.IMPORT_KEEP_OLD === '1';

// 保留字段长度限制，和 Track.entity.ts 的 varchar 长度对齐
const MAX_TITLE = 300;
const MAX_ARTIST = 200;

const CJK_RE = /[\u3400-\u9fff\uac00-\ud7af\u3040-\u30ff]/;

function detectLanguage(s: string): string {
  if (!s) return 'other';
  if (CJK_RE.test(s)) {
    // 粗略：只要出现 CJK 就算 zh（日文假名也会落到这里但数量极少，可接受）
    if (/[\u3040-\u30ff]/.test(s)) return 'ja';
    if (/[\uac00-\ud7af]/.test(s)) return 'ko';
    return 'zh';
  }
  // 全 ASCII + 常见拉丁扩展
  if (/^[\x20-\x7e\u00a0-\u024f]+$/.test(s)) return 'en';
  return 'other';
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.substring(0, max);
}

function safeInt(n: any): number | null {
  const v = typeof n === 'number' ? n : parseFloat(`${n}`);
  if (!Number.isFinite(v)) return null;
  return Math.round(v);
}

function parseCsv(filePath: string): CsvRow[] {
  const buf = fs.readFileSync(filePath);
  // 有些 Windows 导出的 CSV 带 BOM，csv-parse 的 bom: true 会吃掉
  const records = parse(buf, {
    bom: true,
    columns: (header: string[]) => header.map((h) => h.trim()),
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Record<string, string>[];

  const rows: CsvRow[] = [];
  for (const r of records) {
    const artist = (r['作者'] || '').trim();
    const title = (r['歌名'] || '').trim();
    const bpm = safeInt(r['BPM']);
    const heatRaw = safeInt(r['热度']);
    if (!artist || !title || bpm == null) continue;
    if (bpm < 40 || bpm > 220) continue; // classifyBpm 之外的极端值直接丢
    rows.push({
      artist: truncate(artist, MAX_ARTIST),
      title: truncate(title, MAX_TITLE),
      bpm,
      heat: heatRaw,
    });
  }
  return rows;
}

async function deleteOldTracks() {
  const repo = AppDataSource.getRepository(TrackEntity);
  // 引导曲（isReference=true）保留；其他全部删。
  // 直接走 DELETE 子句而不是 find+remove，避免 14w 条数据一次装进内存。
  const result = await repo
    .createQueryBuilder()
    .delete()
    .from(TrackEntity)
    .where('isReference = :r', { r: false })
    .execute();
  console.log(`[clean] deleted ${result.affected ?? 0} non-reference tracks`);
}

async function insertInBatches(rows: CsvRow[]) {
  const repo = AppDataSource.getRepository(TrackEntity);
  const total = rows.length;
  let inserted = 0;
  const t0 = Date.now();
  for (let i = 0; i < total; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const values = slice.map((r) => {
      const c = classifyBpm(r.bpm);
      return {
        title: r.title,
        artist: r.artist,
        album: null,
        coverUrl: null,
        bpm: c.bpm,
        language: detectLanguage(`${r.artist} ${r.title}`),
        genre: '',
        motionForm: c.motionForm,
        speedFeel: c.speedFeel,
        isReference: false,
        audioUrl: null,
      };
    });
    await repo
      .createQueryBuilder()
      .insert()
      .into(TrackEntity)
      .values(values)
      .execute();
    inserted += slice.length;
    if (inserted % (BATCH * 10) === 0 || inserted === total) {
      const pct = ((inserted / total) * 100).toFixed(1);
      const sec = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`[import] ${inserted}/${total} (${pct}%) in ${sec}s`);
    }
  }
}

async function main() {
  console.log(`[import] csv = ${CSV_PATH}`);
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`CSV not found at: ${CSV_PATH}`);
    process.exit(1);
  }
  const t0 = Date.now();
  console.log('[import] parsing csv…');
  const rows = parseCsv(CSV_PATH);
  console.log(`[import] parsed ${rows.length} valid rows in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (rows.length === 0) {
    console.error('no valid rows to import');
    process.exit(1);
  }

  await AppDataSource.initialize();
  try {
    if (!KEEP_OLD) {
      await deleteOldTracks();
    } else {
      console.log('[clean] KEEP_OLD=1, skip deletion');
    }
    await insertInBatches(rows);
    const repo = AppDataSource.getRepository(TrackEntity);
    const total = await repo.count();
    const refs = await repo.count({ where: { isReference: true } });
    console.log(`[import] done. tracks total=${total}, reference=${refs}`);
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
