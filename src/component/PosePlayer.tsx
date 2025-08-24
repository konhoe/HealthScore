// src/app/component/PosePlayer.tsx
"use client";

import { useEffect, useRef, useState } from "react";

type Landmark = { x: number; y: number; z: number; visibility?: number };
type BatchItem = { ts: number; points: Landmark[] };

type Props = {
  videoUrl: string;
  className?: string; // 부모에서 크기/정렬 제어 (e.g. "w-full max-w-[420px] mx-auto")
  /**
   * 점수 계산 결과를 상위로 전달하고 싶을 때 사용 (선택)
   * - next: { ok: true, overall: number, breakdown: { ... }, comments?: string[] }
   */
  onScored?: (next: { ok: true; overall: number; breakdown: Record<string, number>; comments?: string[] }) => void;
  /**
   * landmarks 원자료가 필요하면 각 프레임마다 콜백 (선택)
   */
  onLandmarks?: (tsMs: number, points: Landmark[]) => void;
  /**
   * 샘플링 간격(ms). 기본 100ms ≈ 10fps
   */
  sampleMs?: number;
  /**
   * 배치 전송 프레임 수. 기본 12프레임마다 전송
   */
  batchSize?: number;
};

export default function PosePlayer({
  videoUrl,
  className,
  onScored,
  onLandmarks,
  sampleMs = 100,
  batchSize = 12,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsTap, setNeedsTap] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 전송 버퍼/상태
  const batchRef = useRef<BatchItem[]>([]);
  const sendingRef = useRef(false);
  const lastPushTsRef = useRef<number>(-1);

  // ====== 배치 전송 ======
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
        const next = { ok: true as const, overall: json.overall, breakdown: json.breakdown as Record<string, number>, comments: json.comments as string[] | undefined };
        // 세션 저장 (Detail 페이지에서 바로 읽어 렌더)
        try {
          sessionStorage.setItem("poseResult", JSON.stringify({ ok: true, overall: next.overall, breakdown: next.breakdown }));
          if (next.comments?.length) sessionStorage.setItem("poseComments", JSON.stringify(next.comments));
        } catch {}
        // 상위 콜백 알림(선택)
        onScored?.(next);
        // 커스텀 이벤트로도 브로드캐스트(필요 시)
        try {
          window.dispatchEvent(new CustomEvent("pose:scored", { detail: next }));
        } catch {}
      }
    } catch (e) {
      console.warn("pose batch send failed", e);
    } finally {
      sendingRef.current = false;
    }
  }

  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let landmarker: any = null; // PoseLandmarker
    let drawer: any = null;     // DrawingUtils

    async function boot() {
      try {
        setLoading(true);
        setError(null);

        // 1) 동적 import (SSR 안전)
        const visionMod = await import("@mediapipe/tasks-vision");
        const { FilesetResolver, PoseLandmarker, DrawingUtils } = visionMod as any;

        // 2) WASM 로더 (버전 고정 권장)
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.17/wasm"
        );

        // 3) 모델 로드 (버전 고정 권장)
        landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
          },
          runningMode: "VIDEO",
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

        if (cancelled) return;

        const video = videoRef.current!;
        const canvas = canvasRef.current!;
        const ctx = canvas.getContext("2d")!;
        drawer = new DrawingUtils(ctx);

        // 4) 메타 로드 → 캔버스 픽셀 사이즈 = 원본, 표시 크기 = CSS (비율 유지)
        video.onloadedmetadata = () => {
          const vw = video.videoWidth || 640;
          const vh = video.videoHeight || 360;
          canvas.width = vw;
          canvas.height = vh;
          setLoading(false);

          // 자동재생 시도
          video.muted = true;
          video.playsInline = true;
          video
            .play()
            .then(() => {
              setNeedsTap(false);
              startLoop();
            })
            .catch(() => {
              // 사용자 제스처 필요
              setNeedsTap(true);
            });
        };

        // 5) 렌더 루프
        const startLoop = () => {
          cancelAnimationFrame(raf);

          const render = () => {
            if (cancelled) return;
            const nowMs = video.currentTime * 1000;

            // 원본 프레임 그리기
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            // 추론
            const res = landmarker.detectForVideo(video, nowMs);
            if (res?.landmarks?.[0]) {
              const lms = res.landmarks[0];
              // 스켈레톤
              drawer.drawConnectors(
                lms,
                (window as any).PoseLandmarker?.POSE_CONNECTIONS ?? (visionMod as any).PoseLandmarker.POSE_CONNECTIONS,
                { lineWidth: 2 }
              );
              drawer.drawLandmarks(lms, { radius: 2 });

              // (선택) 프레임별 landmarks 콜백
              onLandmarks?.(nowMs, lms);

              // 샘플링 간격 충족 시에만 배치에 push
              const lastTs = lastPushTsRef.current;
              if (lastTs < 0 || nowMs - lastTs >= sampleMs) {
                lastPushTsRef.current = nowMs;
                // JSON 전송 크기 최소화를 위해 필요한 필드만 담기
                const light = lms.map((p: any) => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility }));
                batchRef.current.push({ ts: nowMs, points: light });
                if (batchRef.current.length >= batchSize) {
                  // 비동기 전송
                  void flushBatch();
                }
              }
            }

            raf = requestAnimationFrame(render);
          };

          // 비디오 이벤트 연동
          video.onplay = () => {
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(render);
          };
          video.onpause = () => cancelAnimationFrame(raf);
          video.onended = () => {
            cancelAnimationFrame(raf);
            // 남은 배치 마지막 전송
            void flushBatch();
          };

          raf = requestAnimationFrame(render);
        };

        // src 지정 후 로드 트리거
        video.src = videoUrl;
        video.load();
      } catch (e: any) {
        console.error(e);
        setError(e?.message ?? "모델/wasm 로드 중 오류");
        setLoading(false);
      }
    }

    boot();

    // 언마운트 시 정리 + 배치 마지막 전송
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      try {
        // 남은 배치 전송(비동기, 완료까지 대기하지 않음)
        void flushBatch();
      } catch {}
      try {
        (landmarker as any)?.close?.();
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoUrl, sampleMs, batchSize]); // onLandmarks/onScored는 외부 콜백이라 의존성에서 제외 (재바인딩 원치 않으면 메모이즈해서 전달)

  const handleUserStart = () => {
    const v = videoRef.current;
    if (!v) return;
    v
      .play()
      .then(() => setNeedsTap(false))
      .catch((e) => setError(e?.message ?? "재생 실패"));
  };

  return (
    <div className={`relative overflow-hidden ${className ?? ""}`}>
      {/* 비디오는 숨김 (drawImage로 캔버스에만 표시) */}
      <video ref={videoRef} className="hidden" playsInline muted preload="auto" controls={false} />

      {/* 캔버스: 원본 비율 유지. 부모가 가로폭을 제한하면 자동으로 축소됨 */}
      <canvas ref={canvasRef} className="w-full h-full object-contain rounded-xl shadow" />

      {/* 오버레이 UI */}
      {loading && (
        <div className="absolute inset-0 grid place-items-center text-sm text-gray-500">
          모델 불러오는 중...
        </div>
      )}
      {needsTap && !loading && (
        <button
          onClick={handleUserStart}
          className="absolute inset-0 m-auto h-10 w-32 rounded-lg bg-black/80 text-white"
        >
          탭해서 시작
        </button>
      )}
      {error && (
        <div className="absolute bottom-2 left-2 right-2 text-xs text-red-600 bg-white/80 rounded px-2 py-1">
          {error}
        </div>
      )}
    </div>
  );
}