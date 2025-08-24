// src/app/results/detail/page.tsx
"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import PosePlayer from "@/component/PosePlayer";
import CommentsPanel from "@/component/CommentsPanel";

type FrameResult = {
  label: string; t: number; ok: boolean;
  overall?: number;
  dominant?: { type: string; conf: number } | null;
  emotions?: Record<string, number>;
  msg?: string;
};
type VideoResult = { ok: boolean; duration?: number; frames?: FrameResult[] };
type PoseBreakdown = { depth?: number; balance?: number; back_angle?: number; knee_valgus?: number };
type PoseResult = { ok: boolean; overall: number; breakdown?: PoseBreakdown };

const EMO_KEYS = ["HAPPY","CALM","SURPRISED","SAD","ANGRY","CONFUSED","DISGUSTED","FEAR"] as const;

export default function DetailPage() {
  const [video, setVideo] = useState<VideoResult | null>(null);
  const [pose, setPose] = useState<PoseResult | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [comments, setComments] = useState<string[] | null>(null);

  // --- NEW: landmarks 배치 전송을 위한 ref/state ---
  const batchRef = useRef<{ ts: number; points: any[] }[]>([]);
  const sendingRef = useRef(false);

  async function flushBatch() {
    if (sendingRef.current) return;
    const frames = batchRef.current.splice(0);
    if (!frames.length) return;
    sendingRef.current = true;
    try {
      const res = await fetch("/api/pose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frames }),
      });
      const json = await res.json();
      if (json?.ok) {
        const next: PoseResult = { ok: true, overall: json.overall, breakdown: json.breakdown };
        setPose(next);
        setComments(Array.isArray(json.comments) ? json.comments : null);
        // 세션에 저장(요약 화면 등에서도 사용)
        sessionStorage.setItem("poseResult", JSON.stringify(next));
        if (json.comments) sessionStorage.setItem("poseComments", JSON.stringify(json.comments));
        // 다른 페이지가 듣도록 커스텀 이벤트도 발행(선택)
        window.dispatchEvent(new CustomEvent("pose:scored", { detail: json }));
      }
    } catch (e) {
      console.warn("pose batch send failed", e);
    } finally {
      sendingRef.current = false;
    }
  }

  useEffect(() => {
    const vr = sessionStorage.getItem("lastVideoResult");
    const pr = sessionStorage.getItem("poseResult");
    const vu = sessionStorage.getItem("videoUrl");
    const pc = sessionStorage.getItem("poseComments");
    if (vr) setVideo(JSON.parse(vr));
    if (pr) setPose(JSON.parse(pr));
    if (vu) setVideoUrl(vu);
    if (pc) setComments(JSON.parse(pc));

    // 페이지 이탈 시 남은 배치 전송
    const beforeUnload = () => { flushBatch(); };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      flushBatch(); // 언마운트 시도
    };
  }, []);

  // 표정 평균 (우측 바)
  const emotionAvg = useMemo(() => {
    const out = Object.fromEntries(EMO_KEYS.map((k) => [k, 0])) as Record<(typeof EMO_KEYS)[number], number>;
    const frames = video?.frames?.filter((f) => f.ok && f.emotions) || [];
    if (!frames.length) return out;
    for (const f of frames) for (const k of EMO_KEYS) out[k] += Math.round(f.emotions?.[k] || 0);
    for (const k of EMO_KEYS) out[k] = Math.round(out[k] / frames.length);
    return out;
  }, [video]);

  const bd = pose?.breakdown || {};

  return (
    <main className="min-h-dvh p-6 bg-gray-50">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-black">세부 분석</h1>
          <div className="flex items-center gap-4">
            <Link href="/results" className="text-sm text-black hover:text-gray-700 underline">결과로</Link>
            <Link href="/" className="text-sm text-black hover:text-gray-700 underline">홈으로</Link>
          </div>
        </header>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* LEFT */}
          <section className="bg-white rounded-2xl shadow p-6">
            <h2 className="text-lg font-semibold text-black">자세 점수 (Pose)</h2>

            {pose?.ok ? (
              <>
                <div className="mt-3 border rounded-xl p-4">
                  <p className="text-xs text-gray-500">Overall</p>
                  <p className="text-3xl font-bold text-black">{Math.round(pose.overall)}</p>
                </div>

                <div className="mt-4 grid sm:grid-cols-2 gap-3">
                  {Object.entries(bd).map(([k, v]) => (
                    <div key={k} className="border rounded-xl p-3">
                      <p className="text-xs text-gray-500">{k}</p>
                      <p className="text-xl font-semibold text-black">{Math.round(v as number)}</p>
                    </div>
                  ))}
                  {!Object.keys(bd).length && (
                    <p className="text-sm text-gray-500 mt-2">
                      세부 지표가 없습니다. (depth, back_angle, knee_valgus 등 추가 가능)
                    </p>
                  )}
                </div>

                <div className="mt-6">
                  <h3 className="text-base font-semibold text-black mb-2">포즈 추정 영상</h3>
                  {videoUrl ? (
                    <div className="w-full max-w-[560px] aspect-video mx-auto overflow-hidden rounded-xl border">
                      <PosePlayer
                        videoUrl={videoUrl}
                        // ⬇️ 여기서 landmarks 수집하여 배치화
                        onLandmarks={(ts, pts) => {
                          const last = batchRef.current.at(-1);
                          // ~10fps로 샘플링
                          if (!last || ts - last.ts >= 100) {
                            batchRef.current.push({ ts, points: pts });
                          }
                          // 12프레임 쌓이면 전송
                          if (batchRef.current.length >= 12) {
                            flushBatch();
                          }
                        }}
                      className="w-full h-full" />
                    </div>
                  ) : (
                    <div className="text-sm text-gray-500 border rounded-xl p-4">
                      업로드된 영상이 없습니다. 이전 단계에서 영상을 업로드하고 분석을 실행해 주세요.
                    </div>
                  )}
                </div>
              </>
            ) : (
              <p className="text-sm text-gray-600 mt-3">자세 데이터가 없습니다.</p>
            )}
          </section>

          {/* RIGHT */}
          <section className="bg-white rounded-2xl shadow p-6">
            <h2 className="text-lg font-semibold text-black">표정 점수 (Expression)</h2>

            <div className="mt-4 space-y-2">
              {EMO_KEYS.map((k) => (
                <div key={k}>
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span>{k}</span><span>{emotionAvg[k]}%</span>
                  </div>
                  <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div className="h-full bg-orange-500" style={{ width: `${emotionAvg[k]}%` }} />
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6">
              <CommentsPanel
                pose={{
                  overall: pose?.overall ?? 0,
                  depth: bd.depth,
                  balance: bd.balance,
                  back_angle: bd.back_angle,
                  knee_valgus: bd.knee_valgus,
                }}
                comments={comments || undefined}
              />
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}