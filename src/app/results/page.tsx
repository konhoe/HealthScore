// src/app/results/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { finalScore } from "@/lib/score";
import PosePlayer from "@/component/PosePlayer";

// Stored result types
type FrameResult = { label: string; t: number; ok: boolean; overall?: number };
type VideoResult = { ok: boolean; duration?: number; frames?: FrameResult[] };
type PoseResult = { ok: boolean; overall: number; breakdown?: Record<string, number> };

const POSE_W = 0.7;
const EXPR_W = 0.3;

export default function ResultsPage() {
  const [video, setVideo] = useState<VideoResult | null>(null);
  const [pose, setPose] = useState<PoseResult | null>(null);
  const [expr, setExpr] = useState<number>(0);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  // ---- 배치 전송용 ----
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
        const next = { ok: true, overall: json.overall, breakdown: json.breakdown };
        setPose(next);
        try {
          sessionStorage.setItem("poseResult", JSON.stringify(next));
          if (json.comments) sessionStorage.setItem("poseComments", JSON.stringify(json.comments));
        } catch {}
        // 다른 페이지 동기화용 이벤트(선택)
        window.dispatchEvent(new CustomEvent("pose:scored", { detail: json }));
      }
    } catch (e) {
      console.warn("pose batch send failed", e);
    } finally {
      sendingRef.current = false;
    }
  }

  // 초기 로드: 세션에서 값
  useEffect(() => {
    try {
      const vr = sessionStorage.getItem("lastVideoResult");
      const pr = sessionStorage.getItem("poseResult");
      const es = sessionStorage.getItem("expressionScore");
      const vu = sessionStorage.getItem("videoUrl");
      if (vr) setVideo(JSON.parse(vr));
      if (pr) setPose(JSON.parse(pr));
      if (es && !Number.isNaN(Number(es))) setExpr(Number(es));
      if (vu) setVideoUrl(vu);
    } catch {}
    return () => { flushBatch(); };
  }, []);

  // 디테일에서 갱신되면 요약도 반영
  useEffect(() => {
    const onScored = (e: Event) => {
      const d = (e as CustomEvent).detail as { ok: true; overall: number; breakdown: Record<string, number> };
      setPose({ ok: true, overall: d.overall, breakdown: d.breakdown });
      try {
        sessionStorage.setItem("poseResult", JSON.stringify({ ok: true, overall: d.overall, breakdown: d.breakdown }));
      } catch {}
    };
    window.addEventListener("pose:scored", onScored as EventListener);
    return () => window.removeEventListener("pose:scored", onScored as EventListener);
  }, []);

  // 표정 점수 (서버 계산값이 세션에 없을 때 프레임 평균 백업)
  const exprFallback = useMemo(() => {
    if (!video?.ok || !video.frames?.length) return 0;
    const oks = video.frames.filter((f) => f.ok && typeof f.overall === "number");
    if (!oks.length) return 0;
    return Math.round(oks.reduce((s, f) => s + (f.overall || 0), 0) / oks.length);
  }, [video]);
  const exprScore = expr || exprFallback;

  // 포즈는 평균/전체 하나만 노출
  const poseScore = Math.round(pose?.ok ? pose.overall || 0 : 0);
  const total = finalScore(poseScore, exprScore, POSE_W, EXPR_W);

  return (
    <main className="min-h-dvh p-6 bg-gray-50">
      <div className="mx-auto max-w-5xl relative">
        <header className="mb-8 flex items-center justify-between">
          <h1 className="text-2xl sm:text-3xl font-bold text-black">최종 분석 결과</h1>
          <Link href="/" className="text-sm text-black hover:text-gray-700 underline">Home</Link>
        </header>

        <section className="bg-white rounded-2xl shadow p-6 sm:p-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
            <div>
              <p className="text-gray-800 text-sm">Final Score</p>
              <p className="text-6xl font-extrabold tracking-tight text-orange-600">{total}</p>
              <p className="text-xs text-gray-400 mt-1">
                가중치: 포즈 {Math.round(POSE_W * 100)}% / 표정 {Math.round(EXPR_W * 100)}%
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="border rounded-xl p-4">
                <p className="text-xs text-gray-500">Pose</p>
                <p className="text-2xl font-semibold text-gray-700">{poseScore}</p>
              </div>
              <div className="border rounded-xl p-4">
                <p className="text-xs text-gray-500">Expression</p>
                <p className="text-2xl font-semibold text-gray-700">{exprScore}</p>
              </div>
            </div>
          </div>

          <div className="mt-6 flex items-center gap-3">
            <Link
              href="/results/detail"
              className="inline-flex items-center justify-center px-6 py-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-medium transition"
            >
              세부사항 보러가기
            </Link>
            <Link
              href="/"
              className="inline-flex items-center justify-center px-4 py-2 rounded-lg border text-sm"
            >
              새 영상 업로드
            </Link>
          </div>

          {/* ⛔ 화면 노출 없이 백그라운드 추론만 수행 */}
          {videoUrl && (
            <div
              aria-hidden
              style={{
                position: "absolute",
                width: 1,
                height: 1,
                opacity: 0,
                pointerEvents: "none",
                overflow: "hidden",
                top: 0,
                left: 0,
              }}
            >
              <PosePlayer
                videoUrl={videoUrl}
                onLandmarks={(ts, pts) => {
                  const last = batchRef.current.at(-1);
                  // ~8~10fps 샘플링
                  if (!last || ts - last.ts >= 120) {
                    batchRef.current.push({ ts, points: pts });
                  }
                  if (batchRef.current.length >= 12) {
                    flushBatch();
                  }
                }}
              />
            </div>
          )}
        </section>
      </div>
    </main>
  );
}