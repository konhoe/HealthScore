// src/lib/ff.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

const execFileP = promisify(execFile);

function ensureExec(p?: string | null) {
  if (!p) return;
  try {
    const real = fs.realpathSync(p);
    fs.chmodSync(real, 0o755);
  } catch {
    // ignore
  }
}

const ffmpegPath = (ffmpegStatic as unknown as string) || "";
const maybeProbePath =
  (ffprobeStatic as any)?.path || (ffprobeStatic as unknown as string) || "";

const hasStaticFfmpeg = !!(ffmpegPath && fs.existsSync(ffmpegPath));
const hasStaticFfprobe = !!(maybeProbePath && fs.existsSync(maybeProbePath));

if (hasStaticFfmpeg) {
  ensureExec(ffmpegPath);
  ffmpeg.setFfmpegPath(ffmpegPath);
}
if (hasStaticFfprobe) {
  ensureExec(maybeProbePath);
  ffmpeg.setFfprobePath(maybeProbePath);
}

// 유틸: 실행 가능한 ffprobe 커맨드 문자열 고르기
function pickFfprobeCmd(): string {
  if (hasStaticFfprobe) return maybeProbePath;
  // 정적 경로가 없으면 시스템 PATH의 ffprobe 시도 (brew 설치)
  return "ffprobe";
}

export async function ffprobeDurationSec(videoPath: string): Promise<number> {
  // 1차: fluent-ffmpeg의 ffprobe (내부적으로 set된 경로 사용)
  try {
    const duration = await new Promise<number>((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err: any, data: any) => {
        if (err) return reject(err);
        const sec = Number(data?.format?.duration ?? 0);
        resolve(sec || 0);
      });
    });
    if (duration > 0) return duration;
  } catch {
    // fallthrough
  }

  // 2차: 직접 ffprobe 실행 (정적 경로 or 시스템 PATH)
  const probe = pickFfprobeCmd();
  const args = [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    videoPath,
  ];
  const { stdout } = await execFileP(probe, args);
  const v = parseFloat(stdout.trim());
  if (!isFinite(v) || v <= 0) throw new Error("ffprobe returned invalid duration");
  return v;
}

export function extractFrameAt(
  videoPath: string,
  tSec: number,
  outPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
    } catch {}

    ffmpeg(videoPath)
      .inputOptions([`-ss ${Math.max(0, tSec)}`])
      .outputOptions(["-frames:v 1", "-q:v 2"])
      .output(outPath)
      .on("end", () => resolve())
      .on("error", (e) => reject(e))
      .run();
  });
}

export function makeTimestamps(duration: number, tailCount = 10) {
  const start = Math.max(0.1, Math.min(0.5, duration * 0.01));
  const mid = duration / 2;
  const end = Math.max(0.05, duration - 0.05);
  const tails = Array.from({ length: tailCount }, (_, i) => {
    const ratio = (i + 1) / (tailCount + 1);
    return mid + ratio * (end - mid);
  });
  return [
    { label: "start", t: start },
    { label: "middle", t: mid },
    ...tails.map((t, i) => ({
      label: `tail_${String(i + 1).padStart(2, "0")}`,
      t,
    })),
  ];
}