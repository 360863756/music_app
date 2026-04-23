import type { MotionForm } from '../motion/MotionForm';
import type { SpeedFeel } from '../motion/SpeedFeel';

export interface MotionTemplateProps {
  id: number;
  shareCode: string;
  title: string;
  description?: string | null;
  motionForm: MotionForm;
  bpmMin: number;
  bpmMax: number;
  speedFeel: SpeedFeel;
  refTrackTitle?: string | null;
  refTrackArtist?: string | null;
  refBpm?: number | null;
  userId?: number | null;
  createdAt: Date;
}

export class MotionTemplate {
  constructor(private readonly props: MotionTemplateProps) {}

  get id(): number {
    return this.props.id;
  }
  get shareCode(): string {
    return this.props.shareCode;
  }
  get title(): string {
    return this.props.title;
  }
  get description(): string | null | undefined {
    return this.props.description;
  }
  get motionForm(): MotionForm {
    return this.props.motionForm;
  }
  get bpmMin(): number {
    return this.props.bpmMin;
  }
  get bpmMax(): number {
    return this.props.bpmMax;
  }
  get speedFeel(): SpeedFeel {
    return this.props.speedFeel;
  }
  get refTrackTitle(): string | null | undefined {
    return this.props.refTrackTitle;
  }
  get refTrackArtist(): string | null | undefined {
    return this.props.refTrackArtist;
  }
  get refBpm(): number | null | undefined {
    return this.props.refBpm;
  }
  get userId(): number | null | undefined {
    return this.props.userId;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
}
