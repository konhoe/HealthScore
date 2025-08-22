// src/app/api/pose/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** 
 * 임시 스텁: 나중에 MediaPipe/모델 결과를 받아서 실제 계산.
 * 지금은 { overall: number, breakdown: {...} } 형태로 세션 저장을 돕기 위한 용도.
 */
export async function POST(req: Request) {
  try {
    const data = await req.json().catch(() => ({}));
    // 넘어온 값이 있으면 그대로, 없으면 샘플
    const result = data?.overall
      ? data
      : {
          ok: true,
          overall: 72,
          breakdown: { depth: 80, balance: 70, back_angle: 68, knee_valgus: 60 },
        };
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, msg: e?.message || "server error" }, { status: 500 });
  }
}