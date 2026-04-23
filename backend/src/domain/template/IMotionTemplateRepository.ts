import type { MotionForm } from '../motion/MotionForm';
import type { SpeedFeel } from '../motion/SpeedFeel';
import type { MotionTemplate } from './MotionTemplate';

export interface CreateMotionTemplateInput {
  title: string;
  description?: string;
  motionForm: MotionForm;
  bpmMin: number;
  bpmMax: number;
  speedFeel: SpeedFeel;
  refTrackTitle?: string;
  refTrackArtist?: string;
  refBpm?: number;
  userId?: number;
}

export interface IMotionTemplateRepository {
  create(input: CreateMotionTemplateInput, shareCode: string): Promise<MotionTemplate>;
  findByShareCode(shareCode: string): Promise<MotionTemplate | null>;
  listRecent(limit: number): Promise<MotionTemplate[]>;
}
