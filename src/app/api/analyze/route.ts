// src/app/api/analyze/route.ts
import { NextResponse } from "next/server";
import { RekognitionClient, DetectFacesCommand, type FaceDetail } from "@aws-sdk/client-rekognition";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";               // existsSync 등 동기용
import fsp from "node:fs/promises";     // writeFile/mkdir 등 비동기용
import ffmpeg from "fluent-ffmpeg";
import ffmpegBin from "ffmpeg-static";
import ffprobeBin from "ffprobe-static";
import { extractFrameAt, ffprobeDurationSec, makeTimestamps } from "@/lib/ff";
import { expressionOverall } from "@/lib/score";

export const runtime = "nodejs";
export const maxDuration = 60;

// ── 진단 로그 ──────────────────────────────────────────────────────────────
console.log("[analyze] ffmpegBin =", ffmpegBin);
console.log("[analyze] ffprobeBin.path =", (ffprobeBin as any)?.path || ffprobeBin);
console.log("[analyze] region =", process.env.AWS_REGION);
console.log("[analyze] has accessKey =", !!process.env.AWS_ACCESS_KEY_ID);
console.log("[analyze] has secretKey =", !!process.env.AWS_SECRET_ACCESS_KEY);

// ⚠️ Turbopack dev에서 /ROOT/... 경로는 ENOENT 날 수 있음.
// 정적 경로가 '실존'할 때만 설정하고, 아니면 시스템 ffmpeg/ffprobe를 사용하도록 둔다.
if (typeof ffmpegBin === "string" && fs.existsSync(ffmpegBin)) {
  try { ffmpeg.setFfmpegPath(ffmpegBin); } catch {}
}
const probePath = (ffprobeBin as any)?.path as string | undefined;
if (probePath && fs.existsSync(probePath)) {
  try { ffmpeg.setFfprobePath(probePath); } catch {}
}

// ── AWS Rekognition 클라이언트 ────────────────────────────────────────────
const rekog = new RekognitionClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
  },
});

// ── 유틸: 메인 얼굴 선택/감정 맵 변환 ─────────────────────────────────────
function pickMainFace(faces: FaceDetail[] | undefined): FaceDetail | null {
  if (!faces || faces.length === 0) return null;
  return faces.reduce((best, cur) => {
    const areaCur = (cur.BoundingBox?.Width ?? 0) * (cur.BoundingBox?.Height ?? 0);
    const areaBest = (best.BoundingBox?.Width ?? 0) * (best.BoundingBox?.Height ?? 0);
    return areaCur > areaBest ? cur : best;
  });
}

function toEmotionsMap(main: FaceDetail): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of main.Emotions || []) {
    if (e?.Type) out[e.Type] = Number(e.Confidence || 0);
  }
  return out;
}

// ── 핸들러 ────────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("video") as File | null;

    console.log(
      "[analyze] has file =",
      !!file,
      "name =",
      file?.name,
      "type =",
      file?.type,
      "size =",
      file?.size
    );

    if (!file) {
      return NextResponse.json(
        { ok: false, msg: "video 파일이 필요합니다 (field: video)" },
        { status: 400 }
      );
    }
    if (!file.type?.startsWith("video/")) {
      return NextResponse.json(
        { ok: false, msg: `video 타입 아님: ${file.type}` },
        { status: 400 }
      );
    }

    // tmp 디렉토리 생성 및 업로드 파일 저장
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "vid-"));
    const videoPath = path.join(tmpDir, "input.mp4");
    await fsp.writeFile(videoPath, Buffer.from(await file.arrayBuffer()));
    console.log("[analyze] saved tmp =", videoPath);

    // 길이 조회(ffprobe) – lib/ff.ts에서 시스템/정적 경로 백업 처리
    let duration = 0;
    try {
      duration = await ffprobeDurationSec(videoPath);
      console.log("[analyze] duration =", duration);
      if (!duration || !isFinite(duration)) throw new Error("invalid duration");
    } catch (e: any) {
      console.error("[analyze] ffprobe error:", e?.message);
      return NextResponse.json(
        { ok: false, step: "ffprobe", msg: e?.message || "unknown" },
        { status: 500 }
      );
    }

    // 추출 타임스탬프 계획
    const plan = makeTimestamps(duration, 10);
    console.log(
      "[analyze] timestamps =",
      plan.map((p) => `${p.label}:${p.t.toFixed(2)}s`).join(", ")
    );

    const framesDir = path.join(tmpDir, "frames");
    await fsp.mkdir(framesDir);

    const results: Array<{
      label: string;
      t: number;
      ok: boolean;
      msg?: string;
      emotions?: Record<string, number>;
      dominant?: { type?: string; conf: number } | null;
      overall?: number;
    }> = [];

    for (const { label, t } of plan) {
      const outJpg = path.join(framesDir, `${label}.jpg`);
      try {
        // 프레임 추출 (ffmpeg) – lib/ff.ts 내부에서 ffmpeg 경로 처리
        await extractFrameAt(videoPath, t, outJpg);

        // 이미지 읽어 Rekognition에 전송
        const img = await fsp.readFile(outJpg);
        const resp = await rekog.send(
          new DetectFacesCommand({ Image: { Bytes: img }, Attributes: ["ALL"] })
        );

        const main = pickMainFace(resp.FaceDetails);
        if (!main) {
          results.push({ label, t, ok: false, msg: "no face" });
          continue;
        }

        const emotions = toEmotionsMap(main);
        const dom = (main.Emotions || [])
          .slice()
          .sort(
            (a, b) =>
              Number(b.Confidence || 0) - Number(a.Confidence || 0)
          )[0] as { Type?: string; Confidence?: number } | undefined;

        results.push({
          label,
          t,
          ok: true,
          emotions,
          dominant: dom ? { type: dom.Type, conf: Number(dom.Confidence || 0) } : null,
          overall: expressionOverall(emotions),
        });
      } catch (e: any) {
        console.error(`[analyze] frame ${label} @${t.toFixed(2)}s error:`, e?.message);
        results.push({ label, t, ok: false, msg: e?.message || "frame/error" });
      }
    }

    return NextResponse.json({ ok: true, duration, frames: results });
  } catch (e: any) {
    console.error("[analyze] fatal:", e);
    return NextResponse.json(
      { ok: false, msg: e?.message || "server error" },
      { status: 500 }
    );
  }
}