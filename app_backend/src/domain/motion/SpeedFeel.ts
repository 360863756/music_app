export type SpeedFeel = 'fast' | 'medium' | 'slow';

export const SpeedFeelValues: SpeedFeel[] = ['fast', 'medium', 'slow'];

export function parseSpeedFeel(v: string | undefined): SpeedFeel | undefined {
  if (v === 'fast' || v === 'medium' || v === 'slow') return v;
  return undefined;
}
