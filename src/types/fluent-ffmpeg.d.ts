// src/types/fluent-ffmpeg.d.ts

declare function ffmpeg(input?: string): ffmpeg.FfmpegCommand;

declare namespace ffmpeg {
  interface FfmpegCommand {
    input(file: string): FfmpegCommand;
    inputOptions(opts: string[] | string): FfmpegCommand;
    output(file: string): FfmpegCommand;
    outputOptions(opts: string[] | string): FfmpegCommand;
    frames(n: number): FfmpegCommand;
    on(event: string, cb: (...args: any[]) => void): FfmpegCommand;
    run(): void;
    // 인스턴스 메서드로 ffprobe를 쓰는 경우도 있어서 시그니처 하나 더 둡니다.
    ffprobe(callback: (err: Error | null, data: any) => void): void;
  }

  /** 🔹 정적 유틸들 (여기가 중요!) */
  function setFfmpegPath(path: string): void;
  function setFfprobePath(path: string): void;
  function ffprobe(
    path: string,
    callback: (err: Error | null, data: any) => void
  ): void;
}

export = ffmpeg;