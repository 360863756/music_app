import 'reflect-metadata';
import dotenv from 'dotenv';
import { AppDataSource } from '../config/database';
import { TrackEntity } from '../infrastructure/persistence/Track.entity';
import { classifyBpm } from '../domain/motion/BpmClassification';

dotenv.config();

const SAMPLE: Array<{
  title: string;
  artist: string;
  album?: string;
  bpm: number;
  language: string;
  genre: string;
}> = [
  { title: '倔强', artist: '五月天', bpm: 142, language: 'zh', genre: '流行' },
  { title: '离开地球表面', artist: '五月天', bpm: 155, language: 'zh', genre: '摇滚' },
  { title: '晴天', artist: '周杰伦', bpm: 138, language: 'zh', genre: '流行' },
  { title: '稻香', artist: '周杰伦', bpm: 90, language: 'zh', genre: '流行' },
  { title: '夜曲', artist: '周杰伦', bpm: 95, language: 'zh', genre: '流行' },
  { title: '七里香', artist: '周杰伦', bpm: 118, language: 'zh', genre: '流行' },
  { title: '光年之外', artist: 'G.E.M.邓紫棋', bpm: 132, language: 'zh', genre: '流行' },
  { title: '泡沫', artist: 'G.E.M.邓紫棋', bpm: 108, language: 'zh', genre: '流行' },
  { title: 'Blinding Lights', artist: 'The Weeknd', bpm: 171, language: 'en', genre: '电子' },
  { title: 'Levitating', artist: 'Dua Lipa', bpm: 103, language: 'en', genre: '流行' },
  { title: 'Shape of You', artist: 'Ed Sheeran', bpm: 96, language: 'en', genre: '流行' },
  { title: 'Uptown Funk', artist: 'Mark Ronson ft. Bruno Mars', bpm: 115, language: 'en', genre: 'Funk' },
  { title: 'Rolling in the Deep', artist: 'Adele', bpm: 105, language: 'en', genre: '流行' },
  { title: 'Bad Guy', artist: 'Billie Eilish', bpm: 135, language: 'en', genre: '流行' },
  { title: 'Believer', artist: 'Imagine Dragons', bpm: 125, language: 'en', genre: '摇滚' },
  { title: 'Thunder', artist: 'Imagine Dragons', bpm: 168, language: 'en', genre: '摇滚' },
  { title: 'Sugar', artist: 'Maroon 5', bpm: 120, language: 'en', genre: '流行' },
  { title: 'Counting Stars', artist: 'OneRepublic', bpm: 122, language: 'en', genre: '流行' },
  { title: 'Viva La Vida', artist: 'Coldplay', bpm: 138, language: 'en', genre: '摇滚' },
  { title: 'Something Just Like This', artist: 'The Chainsmokers', bpm: 103, language: 'en', genre: '电子' },
  { title: 'Lemon', artist: '米津玄師', bpm: 87, language: 'ja', genre: '流行' },
  { title: 'Pretender', artist: 'Official髭男dism', bpm: 96, language: 'ja', genre: '流行' },
  { title: '夜に駆ける', artist: 'YOASOBI', bpm: 130, language: 'ja', genre: '流行' },
  { title: '群青', artist: 'YOASOBI', bpm: 135, language: 'ja', genre: '流行' },
  { title: '红日', artist: '李克勤', bpm: 132, language: 'zh', genre: '流行' },
  { title: '海阔天空', artist: 'Beyond', bpm: 76, language: 'zh', genre: '摇滚' },
  { title: '光辉岁月', artist: 'Beyond', bpm: 130, language: 'zh', genre: '摇滚' },
  { title: '真的爱你', artist: 'Beyond', bpm: 127, language: 'zh', genre: '摇滚' },
  { title: '平凡之路', artist: '朴树', bpm: 138, language: 'zh', genre: '民谣' },
  { title: '那些花儿', artist: '朴树', bpm: 98, language: 'zh', genre: '民谣' },
  { title: '成都', artist: '赵雷', bpm: 95, language: 'zh', genre: '民谣' },
  { title: '理想', artist: '赵雷', bpm: 112, language: 'zh', genre: '民谣' },
  { title: '卡路里', artist: '火箭少女101', bpm: 140, language: 'zh', genre: '流行' },
  { title: '孤勇者', artist: '陈奕迅', bpm: 92, language: 'zh', genre: '流行' },
  { title: '十年', artist: '陈奕迅', bpm: 72, language: 'zh', genre: '流行' },
  { title: '演员', artist: '薛之谦', bpm: 128, language: 'zh', genre: '流行' },
  { title: '像我这样的人', artist: '毛不易', bpm: 88, language: 'zh', genre: '民谣' },
  { title: '消愁', artist: '毛不易', bpm: 82, language: 'zh', genre: '民谣' },
  { title: '起风了', artist: '买辣椒也用券', bpm: 89, language: 'zh', genre: '流行' },
  { title: '漠河舞厅', artist: '柳爽', bpm: 118, language: 'zh', genre: '民谣' },
];

/**
 * Onboarding 引导参照曲：
 * - walk_guide.mp3 用于散步引导，默认 BPM=100（可通过 ONBOARDING_WALK_BPM 覆盖）
 * - run_guide.mp3 用于跑步引导，默认 BPM=150（可通过 ONBOARDING_RUN_BPM 覆盖）
 * 若 BPM 与真实音频不吻合，修改上面两个环境变量后重新运行本 seed 即可。
 */
const REFERENCE_TRACKS: Array<{
  title: string;
  artist: string;
  bpm: number;
  audioUrl: string;
  motionForm: 'walk' | 'run';
  language: string;
  genre: string;
}> = [
  {
    title: '散步引导（稳定版）',
    artist: 'App Onboarding',
    bpm: parseInt(process.env.ONBOARDING_WALK_BPM || '100', 10),
    audioUrl: '/static/audio/walk_guide.mp3',
    motionForm: 'walk',
    language: 'zh',
    genre: '引导',
  },
  {
    title: '跑步引导',
    artist: 'App Onboarding',
    bpm: parseInt(process.env.ONBOARDING_RUN_BPM || '150', 10),
    audioUrl: '/static/audio/run_guide.mp3',
    motionForm: 'run',
    language: 'zh',
    genre: '引导',
  },
];

async function upsertReferenceTracks(repo: ReturnType<typeof AppDataSource.getRepository<TrackEntity>>) {
  for (const r of REFERENCE_TRACKS) {
    const c = classifyBpm(r.bpm);
    const existing = await repo.findOne({
      where: { isReference: true, motionForm: r.motionForm },
    });
    if (existing) {
      existing.title = r.title;
      existing.artist = r.artist;
      existing.bpm = c.bpm;
      existing.language = r.language;
      existing.genre = r.genre;
      existing.motionForm = c.motionForm;
      existing.speedFeel = c.speedFeel;
      existing.audioUrl = r.audioUrl;
      existing.isReference = true;
      await repo.save(existing);
      console.log(`[ref] updated ${r.motionForm} reference track -> bpm=${c.bpm}`);
    } else {
      const row = repo.create({
        title: r.title,
        artist: r.artist,
        album: null,
        coverUrl: null,
        bpm: c.bpm,
        language: r.language,
        genre: r.genre,
        motionForm: c.motionForm,
        speedFeel: c.speedFeel,
        audioUrl: r.audioUrl,
        isReference: true,
      });
      await repo.save(row);
      console.log(`[ref] inserted ${r.motionForm} reference track -> bpm=${c.bpm}`);
    }
  }
}

async function main() {
  await AppDataSource.initialize();
  const repo = AppDataSource.getRepository(TrackEntity);

  // 参照曲始终走 upsert，BPM 改了重跑就生效
  await upsertReferenceTracks(repo);

  // 普通曲目只在空表时首次灌入
  const n = await repo.count({ where: { isReference: false } });
  if (n > 0) {
    console.log(`tracks already seeded (${n}), skip`);
    await AppDataSource.destroy();
    return;
  }
  const rows = SAMPLE.map((s) => {
    const c = classifyBpm(s.bpm);
    return repo.create({
      title: s.title,
      artist: s.artist,
      album: s.album ?? null,
      coverUrl: null,
      bpm: c.bpm,
      language: s.language,
      genre: s.genre,
      motionForm: c.motionForm,
      speedFeel: c.speedFeel,
      isReference: false,
    });
  });
  await repo.save(rows);
  console.log(`Seeded ${rows.length} tracks`);
  await AppDataSource.destroy();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
