// src/app/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Title from "@/component/Title";

const MAX_MB = 200;

export default function HomePage() {
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const router = useRouter();
  const abortRef = useRef<AbortController | null>(null);

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

  // 파일 선택 핸들러
  const onSelect = (f?: File) => {
    if (!f) return;
    if (!validate(f)) {
      setFile(null);
      setPreviewUrl((p) => {
        if (p) URL.revokeObjectURL(p);
        return null;
      });
      return;
    }
    setFile(f);
    // 미리보기 URL
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(f);
    });
    // 에러/이전 결과 초기화
    setErr("");
    try {
      sessionStorage.removeItem("lastVideoResult");
      sessionStorage.removeItem("poseResult");
    } catch {}
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
      // 결과 초기화
      sessionStorage.removeItem("lastVideoResult");
      sessionStorage.removeItem("poseResult");

      // 1) 표정 분석(프레임 추출 + Rekognition)
      const form = new FormData();
      form.append("video", file);
      const res = await fetch("/api/analyze", {
        method: "POST",
        body: form,
        signal: controller.signal,
      });

      if (!res.ok) {
        // 서버에서 에러 메시지 내려주면 표시
        let msg = `분석 API 오류 (HTTP ${res.status})`;
        try {
          const j = await res.json();
          if (j?.msg) msg = `분석 실패: ${j.msg}`;
        } catch {}
        throw new Error(msg);
      }

      const json = await res.json();
      if (!json?.ok) {
        throw new Error(json?.msg || "분석 실패(알 수 없는 오류)");
      }
      sessionStorage.setItem("lastVideoResult", JSON.stringify(json));

      // 2) 포즈 점수(스텁/또는 실제 API)
      const poseRes = await fetch("/api/pose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        signal: controller.signal,
      });
      if (!poseRes.ok) {
        throw new Error(`포즈 API 오류 (HTTP ${poseRes.status})`);
      }
      const poseJson = await poseRes.json();
      sessionStorage.setItem("poseResult", JSON.stringify(poseJson));

      router.push("/results");
    } catch (e: any) {
      if (e?.name === "AbortError") {
        // 사용자가 취소한 경우
        setErr("요청이 취소되었습니다.");
      } else {
        setErr(e?.message || "분석 중 오류가 발생했습니다.");
      }
    } finally {
      setLoading(false);
    }
  };

  // 언마운트 시 preview URL 정리
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

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

        {/* 선택 시 미리보기 (선택사항) */}
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