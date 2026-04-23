import { classifyBpm } from '../../domain/motion/BpmClassification';

export class ClassifyBpmUseCase {
  execute(bpm: number) {
    return classifyBpm(bpm);
  }
}
