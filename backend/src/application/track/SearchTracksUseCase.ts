import type { ITrackRepository, TrackSearchCriteria } from '../../domain/track/ITrackRepository';
import { compareBpm } from '../../domain/motion/BpmClassification';

export class SearchTracksUseCase {
  constructor(private readonly tracks: ITrackRepository) {}

  async execute(criteria: TrackSearchCriteria & { referenceBpm?: number }) {
    const { referenceBpm, ...rest } = criteria;
    const { items, total } = await this.tracks.search(rest);
    const enriched = items.map((t) => {
      const base = t.toJSON();
      if (referenceBpm != null && Number.isFinite(referenceBpm)) {
        return {
          ...base,
          speedCompare: compareBpm(t.bpm, referenceBpm),
        };
      }
      return base;
    });
    return { items: enriched, total };
  }
}
