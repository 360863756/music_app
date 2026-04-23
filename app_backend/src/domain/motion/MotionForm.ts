export type MotionForm = 'run' | 'walk';

export const MotionFormValues: MotionForm[] = ['run', 'walk'];

export function parseMotionForm(v: string | undefined): MotionForm | undefined {
  if (v === 'run' || v === 'walk') return v;
  return undefined;
}
