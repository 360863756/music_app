import type { MotionForm } from '../motion/MotionForm';
import type { SpeedFeel } from '../motion/SpeedFeel';
import type { Track } from './Track';

export interface TrackSearchCriteria {
  keyword?: string;
  motionForm?: MotionForm;
  speedFeel?: SpeedFeel;
  language?: string;
  artist?: string;
  genre?: string;
  bpmMin?: number;
  bpmMax?: number;
  limit?: number;
  offset?: number;
  /** 是否包含引导参照曲；缺省 false（默认不返回） */
  includeReference?: boolean;
  /** 随机抽样：true 时从内存 id 池里随机挑，避免 ORDER BY RAND() 全表扫 */
  random?: boolean;
  /** 跳过 count(*) 查询；前端分页只在乎 items.length 时可以省一次扫表 */
  noCount?: boolean;
}

export interface ITrackRepository {
  findById(id: number): Promise<Track | null>;
  search(criteria: TrackSearchCriteria): Promise<{ items: Track[]; total: number }>;
  /** 按 motionForm 取引导参照曲（onboarding 用）；不存在则返回 null */
  findReferenceByMotionForm(motionForm: MotionForm): Promise<Track | null>;
}
