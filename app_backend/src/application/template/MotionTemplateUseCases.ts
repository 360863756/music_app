import { randomBytes } from 'crypto';
import type { IMotionTemplateRepository, CreateMotionTemplateInput } from '../../domain/template/IMotionTemplateRepository';
import type { ITrackRepository } from '../../domain/track/ITrackRepository';
import { compareBpm } from '../../domain/motion/BpmClassification';

function makeShareCode(): string {
  return randomBytes(8).toString('base64url').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) || randomBytes(6).toString('hex');
}

export class CreateMotionTemplateUseCase {
  constructor(private readonly templates: IMotionTemplateRepository) {}

  async execute(input: CreateMotionTemplateInput) {
    let code = makeShareCode();
    for (let i = 0; i < 5; i++) {
      const existing = await this.templates.findByShareCode(code);
      if (!existing) break;
      code = makeShareCode();
    }
    return this.templates.create(input, code);
  }
}

export class GetMotionTemplateByShareCodeUseCase {
  constructor(
    private readonly templates: IMotionTemplateRepository,
    private readonly tracks: ITrackRepository
  ) {}

  async execute(shareCode: string, referenceBpm?: number) {
    const tpl = await this.templates.findByShareCode(shareCode.trim());
    if (!tpl) return null;
    const { items } = await this.tracks.search({
      bpmMin: tpl.bpmMin,
      bpmMax: tpl.bpmMax,
      motionForm: tpl.motionForm,
      limit: 20,
    });
    const suggested = items.map((t) => {
      const base = t.toJSON();
      if (referenceBpm != null && Number.isFinite(referenceBpm)) {
        return { ...base, speedCompare: compareBpm(t.bpm, referenceBpm) };
      }
      return base;
    });
    return {
      template: {
        shareCode: tpl.shareCode,
        title: tpl.title,
        description: tpl.description,
        motionForm: tpl.motionForm,
        bpmMin: tpl.bpmMin,
        bpmMax: tpl.bpmMax,
        speedFeel: tpl.speedFeel,
        refTrackTitle: tpl.refTrackTitle,
        refTrackArtist: tpl.refTrackArtist,
        refBpm: tpl.refBpm,
        createdAt: tpl.createdAt,
      },
      suggestedTracks: suggested,
    };
  }
}

export class ListRecentTemplatesUseCase {
  constructor(private readonly templates: IMotionTemplateRepository) {}
  execute(limit: number) {
    return this.templates.listRecent(limit);
  }
}
