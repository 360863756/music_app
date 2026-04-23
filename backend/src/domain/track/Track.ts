import type { MotionForm } from '../motion/MotionForm';
import type { SpeedFeel } from '../motion/SpeedFeel';

export interface TrackProps {
  id: number;
  title: string;
  artist: string;
  album?: string | null;
  coverUrl?: string | null;
  bpm: number;
  language: string;
  genre: string;
  motionForm: MotionForm;
  speedFeel: SpeedFeel;
  /** 是否为 onboarding 引导参照曲；默认 false */
  isReference?: boolean;
  /** 引导曲的音频地址（普通曲目为空） */
  audioUrl?: string | null;
}

export class Track {
  constructor(private readonly props: TrackProps) {}

  get id(): number {
    return this.props.id;
  }
  get title(): string {
    return this.props.title;
  }
  get artist(): string {
    return this.props.artist;
  }
  get album(): string | null | undefined {
    return this.props.album;
  }
  get coverUrl(): string | null | undefined {
    return this.props.coverUrl;
  }
  get bpm(): number {
    return this.props.bpm;
  }
  get language(): string {
    return this.props.language;
  }
  get genre(): string {
    return this.props.genre;
  }
  get motionForm(): MotionForm {
    return this.props.motionForm;
  }
  get speedFeel(): SpeedFeel {
    return this.props.speedFeel;
  }
  get isReference(): boolean {
    return this.props.isReference === true;
  }
  get audioUrl(): string | null | undefined {
    return this.props.audioUrl;
  }

  toJSON() {
    return { ...this.props };
  }
}
