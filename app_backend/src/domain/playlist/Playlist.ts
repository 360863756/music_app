import type { MotionForm } from '../motion/MotionForm';

export interface PlaylistTrackRef {
  trackId: number;
  sortOrder: number;
}

export interface PlaylistProps {
  id: number;
  userId: number;
  name: string;
  description?: string | null;
  motionForm?: MotionForm | null;
  items: PlaylistTrackRef[];
  createdAt: Date;
  updatedAt: Date;
}

export class Playlist {
  constructor(private readonly props: PlaylistProps) {}

  get id(): number {
    return this.props.id;
  }
  get userId(): number {
    return this.props.userId;
  }
  get name(): string {
    return this.props.name;
  }
  get description(): string | null | undefined {
    return this.props.description;
  }
  get motionForm(): MotionForm | null | undefined {
    return this.props.motionForm ?? undefined;
  }
  get items(): PlaylistTrackRef[] {
    return [...this.props.items].sort((a, b) => a.sortOrder - b.sortOrder);
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get updatedAt(): Date {
    return this.props.updatedAt;
  }
}
