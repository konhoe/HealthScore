// src/app/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Title from "@/component/Title";
import { expressionOverallFromFrames } from "@/lib/score";

const MAX_MB = 200;

export default function HomePage() {
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const router = useRouter();

  // 파일 검증
  const validate = (f: File) => {
    setErr("");
    if (!f.type?.startsWith("video/")) {
      setErr("영상 파일만 업로드해주세요.");
      return false;
    }
    if (f.size > MAX_MB * 1024 * 1024) {
      setErr(`파일 용량이 ${MAX_MB}MB를 초과했습니다.`);
      return false;
    }
    return true;
  };

  // 파일 선택
  const onSelect = (f?: File) => {
    if (!f) return;

    // 이전 URL/세션 정리 (videoUrl은 새로 세팅)
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    try {
      sessionStorage.removeItem("lastVideoResult");
      sessionStorage.removeItem("poseResult");
      sessionStorage.removeItem("poseComments");
      sessionStorage.removeItem("expressionScore");
      sessionStorage.removeItem("videoUrl");
    } catch {}

    if (!validate(f)) {
      setFile(null);
      return;
    }

    setFile(f);

    // 새 미리보기 URL + 세션 저장 (Detail의 PosePlayer가 사용)
    const url = URL.createObjectURL(f);
    setPreviewUrl(url);
    try {
      sessionStorage.setItem("videoUrl", url);
    } catch {}
    setErr("");
  };

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    onSelect(e.target.files?.[0]);

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    onSelect(e.dataTransfer.files?.[0]);
  };

  const canAnalyze = useMemo(() => !!file && !loading && !err, [file, loading, err]);

  // 분석 실행
  const analyze = async () => {
    if (!file || loading) return;

    // 이전 요청 취소
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setErr("");

    try {
      // 결과 초기화 (videoUrl은 유지)
      sessionStorage.removeItem("lastVideoResult");
      sessionStorage.removeItem("poseResult");
      sessionStorage.removeItem("poseComments");
      sessionStorage.removeItem("expressionScore");

      // 1) 표정 분석 호출
      const form = new FormData();
      form.append("video", file);
      const res = await fetch("/api/analyze", {
        method: "POST",
        body: form,
        signal: controller.signal,
      });

      if (!res.ok) {
        let msg = `분석 API 오류 (HTTP ${res.status})`;
        try {
          const j = await res.json();
          if (j?.msg) msg = `분석 실패: ${j.msg}`;
        } catch {}
        throw new Error(msg);
      }

      const json = await res.json();
      if (!json?.ok) throw new Error(json?.msg || "분석 실패(알 수 없는 오류)");
      sessionStorage.setItem("lastVideoResult", JSON.stringify(json));

      // 2) 표정 종합 점수 저장 (서버가 주면 그대로, 아니면 로컬 집계)
      let exprScore: number | null = null;
      if (typeof json.expressionScore === "number") {
        exprScore = json.expressionScore;
      } else {
        const emoFrames = (json.frames || [])
          .filter((f: any) => f.ok && f.emotions)
          .map((f: any) => f.emotions);
        exprScore = expressionOverallFromFrames(emoFrames);
      }
      sessionStorage.setItem("expressionScore", String(exprScore));

      // 3) 디테일 페이지로 이동
      //   포즈 점수는 Detail의 PosePlayer가 Mediapipe → /api/pose로 배치 전송하며 갱신
      router.push("/results");
    } catch (e: any) {
      if (e?.name === "AbortError") setErr("요청이 취소되었습니다.");
      else setErr(e?.message || "분석 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  // 언마운트 시: 요청만 취소 (ObjectURL은 Detail에서 사용하므로 유지)
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      // 라우팅 후에도 videoUrl이 Detail에서 필요하므로 revoke하지 않음.
    };
  }, []);

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center p-6">
      <Title />

      <div
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        className="w-[720px] max-w-[92vw] min-h-[220px] border-2 border-dashed border-gray-300 rounded-xl bg-white shadow-sm grid place-items-center hover:border-gray-400 transition p-4"
      >
        <label className="flex flex-col items-center gap-3 cursor-pointer">
          <img src="/file.svg" alt="upload" className="w-14 h-14 opacity-90" />
          <p className="text-gray-700">클릭 혹은 영상을 이곳에 드롭하세요.</p>
          <p className="text-xs text-gray-400">MP4 권장 · 최대 {MAX_MB}MB</p>
          <input type="file" accept="video/*" onChange={onChange} className="hidden" />
        </label>

        {previewUrl && (
          <div className="w-full mt-4">
            <video
              src={previewUrl}
              className="w-full max-h-64 rounded-lg border"
              controls
            />
          </div>
        )}
      </div>

      <p className="mt-3 text-sm text-gray-600">
        파일 선택: <span className="font-medium">{file ? file.name : "선택된 파일 없음"}</span>
      </p>
      {err && <p className="mt-1 text-sm text-red-600">{err}</p>}

      <div className="mt-6 flex items-center gap-3">
        <button
          onClick={analyze}
          disabled={!canAnalyze}
          className={`px-6 py-2 rounded-lg font-medium text-white transition ${
            !canAnalyze ? "bg-gray-400 cursor-not-allowed" : "bg-orange-500 hover:bg-orange-600"
          }`}
        >
          {loading ? "분석 중..." : "분석 시작"}
        </button>

        {loading && (
          <button
            onClick={() => abortRef.current?.abort()}
            className="px-4 py-2 rounded-lg border text-sm"
          >
            취소
          </button>
        )}
      </div>
    </main>
  );
}