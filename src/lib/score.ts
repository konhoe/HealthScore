// src/lib/score.ts

/** 표정 키(대문자) 고정 셋 */
export const EMO_KEYS = [
  "HAPPY",
  "CALM",
  "SURPRISED",
  "SAD",
  "ANGRY",
  "CONFUSED",
  "DISGUSTED",
  "FEAR",
] as const;
export type EmotionKey = (typeof EMO_KEYS)[number];

/** 각 감정의 점수(%) 맵: 0~100 가정 */
export type Emotions = Partial<Record<EmotionKey, number>>;

/** 가중치 맵 (기본값은 너가 쓰던 수식과 동일한 의도) */
export type EmotionWeights = Partial<Record<EmotionKey, number>>;

/** 0~100 클램프 */
const clamp100 = (x: number) => Math.max(0, Math.min(100, Math.round(x)));

/** 안전 접근자: undefined → 0, 음수/초과값도 0~100으로 클램프 */
const g = (em: Emotions, k: EmotionKey) => {
  const v = em[k];
  return typeof v === "number" ? Math.max(0, Math.min(100, v)) : 0;
};

/**
 * 표정 종합 점수 (단일 프레임)
 * - 기본 가중치:
 *   + HAPPY 0.7
 *   + SURPRISED 0.3
 *   + CALM 0.2
 *   - ANGRY 0.2
 *   - DISGUSTED 0.2
 * - 필요시 weights로 커스터마이즈
 */
export function expressionOverall(
  em: Emotions,
  weights?: EmotionWeights
): number {
  // 기본 가중치
  const W: Required<EmotionWeights> = {
    HAPPY: 0.5,
    SURPRISED: 0.2,
    CALM: 0.5,
    SAD: 0,
    ANGRY: -0.2,
    CONFUSED: 0,
    DISGUSTED: -0.2,
    FEAR: 0,
    ...(weights || {}),
  } as any;

  let score = 0;
  for (const k of EMO_KEYS) score += (W[k] ?? 0) * g(em, k);
  return clamp100(score);
}

/**
 * 여러 프레임의 Emotions를 평균내는 유틸
 * - undefined/빈 프레임은 제외
 * - 각 키별 단순 평균(0~100로 클램프)
 */
export function averageEmotions(frames: Array<Emotions | undefined>): Emotions {
  const acc: Record<EmotionKey, number> = Object.create(null);
  const cnt: Record<EmotionKey, number> = Object.create(null);

  for (const k of EMO_KEYS) {
    acc[k] = 0;
    cnt[k] = 0;
  }

  for (const em of frames) {
    if (!em) continue;
    for (const k of EMO_KEYS) {
      if (typeof em[k] === "number") {
        acc[k] += g(em, k);
        cnt[k] += 1;
      }
    }
  }

  const out: Emotions = {};
  for (const k of EMO_KEYS) {
    out[k] = cnt[k] ? Math.round(acc[k] / cnt[k]) : 0;
  }
  return out;
}

/**
 * 여러 프레임(표정) → 종합 점수
 * - frames를 평균낸 후 expressionOverall 적용
 */
export function expressionOverallFromFrames(
  frames: Array<Emotions | undefined>,
  weights?: EmotionWeights
): number {
  const avg = averageEmotions(frames);
  return expressionOverall(avg, weights);
}

/**
 * 최종 점수 = poseW * pose + exprW * expr
 * - 기본 poseW=0.7, exprW=0.3
 * - 결과는 0~100로 클램프
 */
export function finalScore(
  pose: number,
  expr: number,
  poseW = 0.7,
  exprW = 0.3
): number {
  const p = Math.max(0, Math.min(100, pose || 0));
  const e = Math.max(0, Math.min(100, expr || 0));
  return clamp100(poseW * p + exprW * e);
}