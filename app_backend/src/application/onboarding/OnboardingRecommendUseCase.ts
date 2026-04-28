import type { ITrackRepository } from '../../domain/track/ITrackRepository';
import { compareBpm } from '../../domain/motion/BpmClassification';

export type PaceFeedback = 'too_fast' | 'too_slow' | 'ok';

/** 根据参照 BPM 与用户反馈，推荐相近 BPM 曲目 */
export class OnboardingRecommendUseCase {
  constructor(private readonly tracks: ITrackRepository) {}

  async execute(referenceBpm: number, feedback: PaceFeedback) {
    const ref = Math.round(Math.max(60, Math.min(200, referenceBpm)));
    // 用户给的窗口（散步参考 100、跑步参考 150 实测）：
    //   ok       → ref ± 2     （98-102 / 148-152）
    //   too_fast → ref-10 ~ ref-4  （比参考慢，覆盖用户写的 92-96 / 140-145）
    //   too_slow → ref+5  ~ ref+11 （比参考快，覆盖用户写的 106-110 / 158-162）
    // 比旧版（center ± 8、center 偏移 12）更窄、更贴近"听感差一点点"的体验。
    let lo = ref - 2;
    let hi = ref + 2;
    if (feedback === 'too_fast') {
      lo = ref - 10;
      hi = ref - 4;
    } else if (feedback === 'too_slow') {
      lo = ref + 5;
      hi = ref + 11;
    }
    const bpmMin = Math.max(40, lo);
    const bpmMax = Math.min(220, hi);

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
