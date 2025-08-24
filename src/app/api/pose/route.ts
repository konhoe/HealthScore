import { NextResponse } from "next/server";
export const runtime = "nodejs";

/** 프론트에서 landmarks 배치(frames)를 받아 점수/코멘트 계산 */
export async function POST(req: Request) {
  try {
    if ((req.headers.get("content-type") || "").includes("multipart")) {
      return NextResponse.json({ ok: false, msg: "Use JSON" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    // payload:
    // { frames: [{ ts: number, points: [{x,y,z,visibility?}...] }, ...] }
    const frames = Array.isArray(body?.frames) ? body.frames : [];

    if (!frames.length) {
      // landmarks가 아직 없으면 데모 값 반환 (초기 렌더용)
      return NextResponse.json({
        ok: true,
        overall: 72,
        breakdown: { depth: 80, balance: 70, back_angle: 68, knee_valgus: 60 },
        comments: demoComments({ overall: 72, depth: 80, balance: 70, back_angle: 68, knee_valgus: 60 }),
      });
    }

    let sumDepth = 0, sumBalance = 0, sumBack = 0, sumValgus = 0, n = 0;

    for (const f of frames) {
      const lms: any[] = f.points || [];
      if (lms.length < 33) continue;

      const hipY = avg(lms[23]?.y, lms[24]?.y);
      const kneeY = avg(lms[25]?.y, lms[26]?.y);
      const ankleY = avg(lms[27]?.y, lms[28]?.y);
      const shoulder = mid(lms[11], lms[12]);
      const hip = mid(lms[23], lms[24]);

      // depth: 엉덩이가 무릎/발목 대비 얼마나 내려갔는지 (0~1)
      const depthScore = clamp01((kneeY - hipY) / Math.max(1e-6, kneeY - ankleY));

      // back_angle: 어깨-엉덩이 벡터가 수직(π/2)에 가까울수록 좋음 (0~1)
      const backVec = { x: shoulder.x - hip.x, y: shoulder.y - hip.y };
      const backAngle = Math.atan2(backVec.y, backVec.x);
      const uprightScore = 1 - Math.min(Math.abs(backAngle - Math.PI / 2) / (Math.PI / 2), 1);

      // knee_valgus: 무릎 간 거리 / 발목 간 거리 (작으면 모임) → 값이 작으면 감점
      const kneesX = Math.abs((lms[25]?.x ?? 0.5) - (lms[26]?.x ?? 0.5));
      const anklesX = Math.abs((lms[27]?.x ?? 0.5) - (lms[28]?.x ?? 0.5));
      const valgusScore = clamp01(kneesX / Math.max(anklesX, 1e-6)); // 1이 이상적
      const valgusAdj = clamp01(valgusScore * 1.2);

      // balance: 어깨/엉덩이 중앙의 x가 프레임 중앙(0.5)에 근접 (0~1)
      const centerX = 0.5;
      const comX = (shoulder.x + hip.x) / 2;
      const balanceScore = 1 - Math.min(Math.abs(comX - centerX) / 0.5, 1);

      sumDepth   += depthScore;
      sumBack    += uprightScore;
      sumValgus  += valgusAdj;
      sumBalance += balanceScore;
      n++;
    }

    const depth   = to100(sumDepth / Math.max(n, 1));
    const back    = to100(sumBack / Math.max(n, 1));
    const valgus  = to100(sumValgus / Math.max(n, 1));
    const balance = to100(sumBalance / Math.max(n, 1));

    const overall = Math.round(depth * 0.35 + balance * 0.25 + back * 0.2 + valgus * 0.2);

    return NextResponse.json({
      ok: true,
      overall,
      breakdown: { depth, balance, back_angle: back, knee_valgus: valgus },
      comments: demoComments({ overall, depth, balance, back_angle: back, knee_valgus: valgus }),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, msg: e?.message || "server error" }, { status: 500 });
  }
}

/* helpers */
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const to100 = (x: number) => Math.round(clamp01(x) * 100);
function avg(...vals: (number | undefined)[]) {
  const arr = vals.filter((v) => typeof v === "number") as number[];
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}
function mid(a?: any, b?: any) {
  if (!a || !b) return { x: 0.5, y: 0.5 };
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/* 간단 코멘트 생성 (원하면 협업자 규칙으로 교체) */
function demoComments(p: { overall: number; depth: number; balance: number; back_angle: number; knee_valgus: number; }) {
  const tips: string[] = [];
  if (p.overall >= 85) tips.push("전반적으로 좋은 자세입니다. 현재 패턴을 유지하세요.");
  else if (p.overall >= 70) tips.push("기본 자세는 안정적입니다. 세부 요소 몇 가지만 보정하면 더 좋아져요.");
  else tips.push("핵심 보정 포인트 중심으로 천천히 교정해 봅시다.");

  if (p.depth < 70) tips.push("스쿼트 깊이가 부족합니다. 엉덩이를 더 뒤로 보내고, 무릎-발끝 정렬을 유지하세요.");
  if (p.knee_valgus < 70) tips.push("무릎이 안쪽으로 모이는 경향이 있습니다. 발 아치 유지, 무릎은 두 번째 발가락 방향으로.");
  if (p.back_angle < 70) tips.push("허리 정렬이 무너집니다. 코어를 먼저 세팅하고 흉곽-골반 정렬을 유지하세요.");
  if (p.balance < 70) tips.push("무게중심이 흔들립니다. 발뒤꿈치-새끼발가락-엄지발가락 삼각 지지로 균형을 잡으세요.");

  tips.push("하강: 코어 세팅 → 엉덩이 뒤로/무릎 전방 동시 → 발전체로 지지");
  tips.push("상승: 발바닥 밀기 → 코어 유지 → 시선 정면/흉추 신전 유지");
  return tips;
}