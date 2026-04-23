import { Repository, DataSource } from 'typeorm';
import type { ITrackRepository, TrackSearchCriteria } from '../../domain/track/ITrackRepository';
import { Track } from '../../domain/track/Track';
import type { MotionForm } from '../../domain/motion/MotionForm';
import type { SpeedFeel } from '../../domain/motion/SpeedFeel';
import { TrackEntity } from '../persistence/Track.entity';

function toDomain(e: TrackEntity): Track {
  return new Track({
    id: e.id,
    title: e.title,
    artist: e.artist,
    album: e.album,
    coverUrl: e.coverUrl,
    bpm: e.bpm,
    language: e.language,
    genre: e.genre,
    motionForm: e.motionForm as MotionForm,
    speedFeel: e.speedFeel as SpeedFeel,
    isReference: e.isReference === true,
    audioUrl: e.audioUrl,
  });
}

/**
 * 随机池缓存：首次被命中时一次性把符合条件的 id 全部读出来（只是 int[]，内存很便宜），
 * 之后每次 random=true 都从这个池里 shuffle-pick，避免 ORDER BY RAND() 全表扫。
 * TTL 5 分钟，后台有新数据（seed / 手工插入）5 分钟内会"过期"自动重建。
 */
const RANDOM_POOL_TTL_MS = 5 * 60 * 1000;
type PoolKey = string;
type Pool = { ids: number[]; expireAt: number };

export class TypeOrmTrackRepository implements ITrackRepository {
  private randomPools = new Map<PoolKey, Pool>();

  constructor(private readonly repo: Repository<TrackEntity>) {}

  static fromDataSource(ds: DataSource): TypeOrmTrackRepository {
    return new TypeOrmTrackRepository(ds.getRepository(TrackEntity));
  }

  async findById(id: number): Promise<Track | null> {
    const e = await this.repo.findOne({ where: { id } });
    return e ? toDomain(e) : null;
  }

  async findReferenceByMotionForm(motionForm: MotionForm): Promise<Track | null> {
    const e = await this.repo.findOne({
      where: { motionForm, isReference: true },
      order: { updatedAt: 'DESC' },
    });
    return e ? toDomain(e) : null;
  }

  /** 随机池 key：只按影响 id 集的常见维度分桶 */
  private buildPoolKey(criteria: TrackSearchCriteria): PoolKey {
    const parts = [
      `mf=${criteria.motionForm ?? ''}`,
      `sf=${criteria.speedFeel ?? ''}`,
      `lang=${criteria.language ?? ''}`,
      `ref=${criteria.includeReference === true ? '1' : '0'}`,
      `bmin=${criteria.bpmMin ?? ''}`,
      `bmax=${criteria.bpmMax ?? ''}`,
    ];
    return parts.join('|');
  }

  private async loadRandomPool(criteria: TrackSearchCriteria): Promise<number[]> {
    const key = this.buildPoolKey(criteria);
    const now = Date.now();
    const cached = this.randomPools.get(key);
    if (cached && cached.expireAt > now) return cached.ids;

    const qb = this.repo.createQueryBuilder('t').select('t.id', 'id');
    if (criteria.includeReference !== true) {
      qb.andWhere('t.isReference = :isRef', { isRef: false });
    }
    if (criteria.motionForm) qb.andWhere('t.motionForm = :mf', { mf: criteria.motionForm });
    if (criteria.speedFeel) qb.andWhere('t.speedFeel = :sf', { sf: criteria.speedFeel });
    if (criteria.language?.trim()) qb.andWhere('t.language = :lang', { lang: criteria.language.trim() });
    if (criteria.bpmMin != null) qb.andWhere('t.bpm >= :bmin', { bmin: criteria.bpmMin });
    if (criteria.bpmMax != null) qb.andWhere('t.bpm <= :bmax', { bmax: criteria.bpmMax });
    const raws = await qb.getRawMany<{ id: number }>();
    const ids = raws.map((r) => r.id);
    this.randomPools.set(key, { ids, expireAt: now + RANDOM_POOL_TTL_MS });
    return ids;
  }

  /** Fisher–Yates 部分采样：O(k) 不需要打乱整个数组 */
  private sampleWithoutReplacement(pool: number[], k: number): number[] {
    const n = pool.length;
    if (k >= n) return [...pool];
    const arr = pool.slice();
    const picked: number[] = [];
    for (let i = 0; i < k; i++) {
      const j = i + Math.floor(Math.random() * (n - i));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
      picked.push(arr[i]);
    }
    return picked;
  }

  async search(criteria: TrackSearchCriteria): Promise<{ items: Track[]; total: number }> {
    const limit = Math.min(100, Math.max(1, criteria.limit ?? 30));
    const offset = Math.max(0, criteria.offset ?? 0);

    // 随机采样分支：从内存 id 池抽 k 个再 IN 查询；比 ORDER BY RAND() 在大表上快一两个数量级
    if (criteria.random === true) {
      const pool = await this.loadRandomPool(criteria);
      if (pool.length === 0) return { items: [], total: 0 };
      const ids = this.sampleWithoutReplacement(pool, limit);
      const rows = await this.repo
        .createQueryBuilder('t')
        .where('t.id IN (:...ids)', { ids })
        .getMany();
      // 按抽到的顺序返回，避免默认的 id 升序打破随机感
      const indexMap = new Map<number, number>();
      ids.forEach((id, i) => indexMap.set(id, i));
      rows.sort((a, b) => (indexMap.get(a.id) ?? 0) - (indexMap.get(b.id) ?? 0));
      return { items: rows.map(toDomain), total: rows.length };
    }

    const qb = this.repo.createQueryBuilder('t');
    // 默认排除引导参照曲，避免它们出现在热门 / 搜索结果里
    if (criteria.includeReference !== true) {
      qb.andWhere('t.isReference = :isRef', { isRef: false });
    }
    if (criteria.keyword?.trim()) {
      const kw = `%${criteria.keyword.trim()}%`;
      qb.andWhere('(t.title LIKE :kw OR t.artist LIKE :kw)', { kw });
    }
    if (criteria.motionForm) {
      qb.andWhere('t.motionForm = :mf', { mf: criteria.motionForm });
    }
    if (criteria.speedFeel) {
      qb.andWhere('t.speedFeel = :sf', { sf: criteria.speedFeel });
    }
    if (criteria.language?.trim()) {
      qb.andWhere('t.language = :lang', { lang: criteria.language.trim() });
    }
    if (criteria.artist?.trim()) {
      qb.andWhere('t.artist LIKE :art', { art: `%${criteria.artist.trim()}%` });
    }
    if (criteria.genre?.trim()) {
      qb.andWhere('t.genre = :genre', { genre: criteria.genre.trim() });
    }
    if (criteria.bpmMin != null) {
      qb.andWhere('t.bpm >= :bmin', { bmin: criteria.bpmMin });
    }
    if (criteria.bpmMax != null) {
      qb.andWhere('t.bpm <= :bmax', { bmax: criteria.bpmMax });
    }

    qb.orderBy('t.bpm', 'ASC').skip(offset).take(limit);

    // noCount 时跳过全表 count，给分页/触底加载明显提速
    if (criteria.noCount === true) {
      const rows = await qb.getMany();
      return { items: rows.map(toDomain), total: rows.length };
    }
    const [rows, total] = await qb.getManyAndCount();
    return { items: rows.map(toDomain), total };
  }
}
