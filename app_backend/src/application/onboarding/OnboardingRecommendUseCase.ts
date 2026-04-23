import type { ITrackRepository } from '../../domain/track/ITrackRepository';
import { compareBpm } from '../../domain/motion/BpmClassification';

export type PaceFeedback = 'too_fast' | 'too_slow' | 'ok';

/** 根据参照 BPM 与用户反馈，推荐相近 BPM 曲目 */
export class OnboardingRecommendUseCase {
  constructor(private readonly tracks: ITrackRepository) {}

  async execute(referenceBpm: number, feedback: PaceFeedback) {
    const ref = Math.round(Math.max(60, Math.min(200, referenceBpm)));
    let center = ref;
    if (feedback === 'too_fast') center = Math.max(70, ref - 12);
    if (feedback === 'too_slow') center = Math.min(195, ref + 12);

    const bpmMin = Math.max(40, center - 8);
    const bpmMax = Math.min(220, center + 8);

    const { items } = await this.tracks.search({ bpmMin, bpmMax, limit: 15 });
    const enriched = items.map((t) => ({
      ...t.toJSON(),
      speedCompare: compareBpm(t.bpm, ref),
      hint:
        feedback === 'ok'
          ? '与参照音乐速度差不多'
          : feedback === 'too_fast'
            ? '已为你推荐更慢一些的节拍'
            : '已为你推荐更快一些的节拍',
    }));

    return {
      referenceBpm: ref,
      targetBpmRange: { min: bpmMin, max: bpmMax },
      tracks: enriched,
    };
  }
}
