import type { MotionForm } from './MotionForm';
import type { SpeedFeel } from './SpeedFeel';

export interface MotionInterpretation {
  motionForm: MotionForm;
  speedFeel: SpeedFeel;
  bpm: number;
  summary: string;
}

/** 领域规则：由 BPM 推断运动形式与速度感受（与需求文档示例对齐的可调启发式） */
export function classifyBpm(bpm: number): MotionInterpretation {
  const n = Math.round(Math.max(40, Math.min(220, bpm)));

  let motionForm: MotionForm;
  let speedFeel: SpeedFeel;

  if (n <= 120) {
    motionForm = 'walk';
    if (n < 100) speedFeel = 'slow';
    else if (n <= 112) speedFeel = 'medium';
    else speedFeel = 'fast';
  } else {
    motionForm = 'run';
    if (n < 135) speedFeel = 'slow';
    else if (n <= 155) speedFeel = 'medium';
    else speedFeel = 'fast';
  }

  const motionLabel = motionForm === 'run' ? '跑步' : '散步';
  const speedLabel =
    speedFeel === 'fast' ? '快' : speedFeel === 'medium' ? '中等' : '较慢';
  const verb = motionForm === 'run' ? '慢跑/节奏跑' : '快走/散步';

  const summary = `这首歌适合**${verb}**，速度**${speedLabel}**（BPM: ${n}）`;

  return { motionForm, speedFeel, bpm: n, summary };
}

/** 速度对比：相对参照 BPM，±5 为「差不多」 */
export type SpeedCompare = 'similar' | 'faster' | 'slower';

export function compareBpm(trackBpm: number, referenceBpm: number): {
  kind: SpeedCompare;
  delta: number;
  label: string;
} {
  const delta = Math.round(trackBpm) - Math.round(referenceBpm);
  if (Math.abs(delta) <= 5) {
    return { kind: 'similar', delta, label: '与参照音乐速度差不多' };
  }
  if (delta > 0) {
    return { kind: 'faster', delta, label: `比参照音乐更快（+${delta} BPM）` };
  }
  return { kind: 'slower', delta: Math.abs(delta), label: `比参照音乐更慢（${delta} BPM）` };
}
