import type { ITrackRepository } from '../../domain/track/ITrackRepository';
import { compareBpm } from '../../domain/motion/BpmClassification';

export class GetTrackUseCase {
  constructor(private readonly tracks: ITrackRepository) {}

  async execute(id: number, referenceBpm?: number) {
    const t = await this.tracks.findById(id);
    if (!t) return null;
    const base = t.toJSON();
    if (referenceBpm != null && Number.isFinite(referenceBpm)) {
      return { ...base, speedCompare: compareBpm(t.bpm, referenceBpm) };
    }
    return base;
  }
}
