// lib/score.ts
export type Emotions = Record<string, number>; // e.g. { HAPPY: 12, CALM: 80, ... }

export function expressionOverall(em: Emotions) {
  const g = (k: string) => em[k] || 0;
  const score =
    0.7 * g("HAPPY") +
    0.3 * g("SURPRISED") +
    0.2 * g("CALM") -
    0.2 * (g("ANGRY") + g("DISGUSTED"));
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function finalScore(pose: number, expr: number, poseW = 0.7, exprW = 0.3) {
  return Math.round(poseW * pose + exprW * expr);
}