import { Repository, DataSource } from 'typeorm';
import type {
  CreateMotionTemplateInput,
  IMotionTemplateRepository,
} from '../../domain/template/IMotionTemplateRepository';
import { MotionTemplate } from '../../domain/template/MotionTemplate';
import type { MotionForm } from '../../domain/motion/MotionForm';
import type { SpeedFeel } from '../../domain/motion/SpeedFeel';
import { MotionTemplateEntity } from '../persistence/MotionTemplate.entity';

function toDomain(e: MotionTemplateEntity): MotionTemplate {
  return new MotionTemplate({
    id: e.id,
    shareCode: e.shareCode,
    title: e.title,
    description: e.description,
    motionForm: e.motionForm as MotionForm,
    bpmMin: e.bpmMin,
    bpmMax: e.bpmMax,
    speedFeel: e.speedFeel as SpeedFeel,
    refTrackTitle: e.refTrackTitle,
    refTrackArtist: e.refTrackArtist,
    refBpm: e.refBpm,
    userId: e.userId,
    createdAt: e.createdAt,
  });
}

export class TypeOrmMotionTemplateRepository implements IMotionTemplateRepository {
  constructor(private readonly repo: Repository<MotionTemplateEntity>) {}

  static fromDataSource(ds: DataSource): TypeOrmMotionTemplateRepository {
    return new TypeOrmMotionTemplateRepository(ds.getRepository(MotionTemplateEntity));
  }

  async create(input: CreateMotionTemplateInput, shareCode: string): Promise<MotionTemplate> {
    const row = this.repo.create({
      shareCode,
      title: input.title,
      description: input.description ?? null,
      motionForm: input.motionForm,
      bpmMin: input.bpmMin,
      bpmMax: input.bpmMax,
      speedFeel: input.speedFeel,
      refTrackTitle: input.refTrackTitle ?? null,
      refTrackArtist: input.refTrackArtist ?? null,
      refBpm: input.refBpm ?? null,
      userId: input.userId ?? null,
    });
    await this.repo.save(row);
    return toDomain(row);
  }

  async findByShareCode(shareCode: string): Promise<MotionTemplate | null> {
    const e = await this.repo.findOne({ where: { shareCode } });
    return e ? toDomain(e) : null;
  }

  async listRecent(limit: number): Promise<MotionTemplate[]> {
    const rows = await this.repo.find({
      order: { createdAt: 'DESC' },
      take: Math.min(50, Math.max(1, limit)),
    });
    return rows.map(toDomain);
  }
}
