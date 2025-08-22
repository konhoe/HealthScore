// src/app/results/detail/page.tsx
"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type FrameResult = {
  label: string; t: number; ok: boolean;
  overall?: number;
  dominant?: { type: string; conf: number } | null;
  emotions?: Record<string, number>;
  msg?: string;
};
type VideoResult = { ok: boolean; duration?: number; frames?: FrameResult[] };
type PoseResult = { ok: boolean; overall: number; breakdown?: Record<string, number> };

const EMO_KEYS = ["HAPPY","CALM","SURPRISED","SAD","ANGRY","CONFUSED","DISGUSTED","FEAR"] as const;

export default function DetailPage() {
  const [video, setVideo] = useState<VideoResult | null>(null);
  const [pose, setPose] = useState<PoseResult | null>(null);

  useEffect(() => {
    const vr = sessionStorage.getItem("lastVideoResult");
    const pr = sessionStorage.getItem("poseResult");
    if (vr) setVideo(JSON.parse(vr));
    if (pr) setPose(JSON.parse(pr));
  }, []);

  const emotionAvg = useMemo(() => {
    const out = Object.fromEntries(EMO_KEYS.map((k) => [k, 0])) as Record<(typeof EMO_KEYS)[number], number>;
    const frames = video?.frames?.filter((f) => f.ok && f.emotions) || [];
    if (!frames.length) return out;
    for (const f of frames) for (const k of EMO_KEYS) out[k] += Math.round(f.emotions?.[k] || 0);
    for (const k of EMO_KEYS) out[k] = Math.round(out[k] / frames.length);
    return out;
  }, [video]);

  const framesSorted = useMemo(() => (video?.frames || []).slice().sort((a,b)=>a.t-b.t), [video]);

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
          {/* LEFT: Pose */}
          <section className="bg-white rounded-2xl shadow p-6">
            <h2 className="text-lg font-semibold text-black">자세 점수 (Pose)</h2>
            {pose?.ok ? (
              <>
                <div className="mt-3 border rounded-xl p-4">
                  <p className="text-xs text-gray-500">Overall</p>
                  <p className="text-3xl font-bold text-black">{Math.round(pose.overall)}</p>
                </div>
                <div className="mt-4 grid sm:grid-cols-2 gap-3">
                  {Object.entries(pose.breakdown || {}).map(([k, v]) => (
                    <div key={k} className="border rounded-xl p-3">
                      <p className="text-xs text-gray-500">{k}</p>
                      <p className="text-xl font-semibold text-black">{Math.round(v as number)}</p>
                    </div>
                  ))}
                  {!pose?.breakdown && (
                    <p className="text-sm text-gray-500 mt-2">
                      세부 지표가 없습니다. (depth, back_angle, knee_valgus 등 추가 가능)
                    </p>
                  )}
                </div>
              </>
            ) : (
              <p className="text-sm text-gray-600 mt-3">자세 데이터가 없습니다.</p>
            )}
          </section>

          {/* RIGHT: Expression */}
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

            <div className="mt-6 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-700">
                    <th className="py-2 pr-4">label</th>
                    <th className="py-2 pr-4">time(s)</th>
                    <th className="py-2 pr-4">dominant</th>
                    <th className="py-2 pr-4">overall</th>
                  </tr>
                </thead>
                <tbody>
                  {framesSorted.map((f) => (
                    <tr key={f.label} className="border-t text-gray-500">
                      <td className="py-2 pr-4">{f.label}</td>
                      <td className="py-2 pr-4">{f.t.toFixed(2)}</td>
                      <td className="py-2 pr-4">{f.ok ? f.dominant?.type ?? "-" : "no face"}</td>
                      <td className="py-2 pr-4">{f.ok ? Math.round(f.overall || 0) : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}