// src/app/results/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { finalScore } from "@/lib/score";

// Types for the stored results
type FrameResult = { label: string; t: number; ok: boolean; overall?: number };
type VideoResult = { ok: boolean; duration?: number; frames?: FrameResult[] };
type PoseResult = { ok: boolean; overall: number };

const POSE_W = 0.7;
const EXPR_W = 0.3;

export default function ResultsPage() {
  const [video, setVideo] = useState<VideoResult | null>(null);
  const [pose, setPose] = useState<PoseResult | null>(null);

  useEffect(() => {
    try {
      const vr = sessionStorage.getItem("lastVideoResult");
      const pr = sessionStorage.getItem("poseResult");
      if (vr) setVideo(JSON.parse(vr));
      if (pr) setPose(JSON.parse(pr));
    } catch {}
  }, []);

  const exprScore = useMemo(() => {
    if (!video?.ok || !video.frames?.length) return 0;
    const oks = video.frames.filter((f) => f.ok && typeof f.overall === "number");
    if (!oks.length) return 0;
    return Math.round(oks.reduce((s, f) => s + (f.overall || 0), 0) / oks.length);
  }, [video]);

  const poseScore = Math.round(pose?.ok ? pose.overall || 0 : 0);
  const total = finalScore(poseScore, exprScore, POSE_W, EXPR_W);

  return (
    <main className="min-h-dvh p-6 bg-gray-50">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8 flex items-center justify-between">
          <h1 className="text-2xl sm:text-3xl font-bold text-black">최종 분석 결과</h1>
          <Link href="/" className="text-sm text-black-500 hover:text-gray-700 underline">
            Home
          </Link>
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
                <p className="text-2xl font-semibold text-gray-500">{poseScore}</p>
              </div>
              <div className="border rounded-xl p-4">
                <p className="text-xs text-gray-500">Expression</p>
                <p className="text-2xl font-semibold text-gray-500">{exprScore}</p>
              </div>
            </div>
          </div>

          <div className="mt-6">
            <Link
              href="/results/detail"
              className="inline-flex items-center justify-center px-6 py-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-medium transition"
            >
              세부사항 보러가기
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}