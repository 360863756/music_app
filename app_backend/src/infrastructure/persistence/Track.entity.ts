import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * 索引策略（14W+ 行级别下的搜索 / 热门必要项）：
 *  - (motionForm, isReference) 复合：首页/搜索默认 WHERE isReference=false AND motionForm=?
 *  - (bpm) 单列：按 BPM 区间过滤 / 参照 BPM 排序
 *  - (language) 单列：语言筛选
 *  - (isReference) 单列：onboarding 参照曲查询
 *  - (artist) 单列：按歌手 LIKE 'xxx%' 时能跑前缀扫描（LIKE '%xxx%' 则不吃索引）
 */
@Entity('tracks')
@Index('idx_tracks_mf_ref', ['motionForm', 'isReference'])
@Index('idx_tracks_bpm', ['bpm'])
@Index('idx_tracks_language', ['language'])
@Index('idx_tracks_is_reference', ['isReference'])
@Index('idx_tracks_artist', ['artist'])
export class TrackEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 300 })
  title!: string;

  @Column({ type: 'varchar', length: 200 })
  artist!: string;

  @Column({ type: 'varchar', length: 300, nullable: true })
  album?: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  coverUrl?: string | null;

  @Column({ type: 'int' })
  bpm!: number;

  @Column({ type: 'varchar', length: 50 })
  language!: string;

  @Column({ type: 'varchar', length: 80 })
  genre!: string;

  @Column({ type: 'varchar', length: 10 })
  motionForm!: string;

  @Column({ type: 'varchar', length: 10 })
  speedFeel!: string;

  /** 是否为引导参照曲：仅用于 onboarding 试听；默认不出现在搜索 / 热门列表 */
  @Column({ type: 'boolean', default: false })
  isReference!: boolean;

  /** 音频外链或相对 URL（引导参照曲用；普通曲目此字段留空） */
  @Column({ type: 'varchar', length: 500, nullable: true })
  audioUrl?: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
