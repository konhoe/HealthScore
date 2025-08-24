// src/component/CommentsPanel.tsx
type PoseBreakdown = {
  overall: number;
  depth?: number;
  balance?: number;
  back_angle?: number;
  knee_valgus?: number;
};

type Props = {
  pose: PoseBreakdown;
  comments?: string[]; // ⬅️ 추가
};

export default function CommentsPanel({ pose, comments }: Props) {
  // 서버에서 온 comments 우선, 없으면 로컬 휴리스틱
  const tips = comments && comments.length ? comments : makeComments(pose);

  return (
    <div className="rounded-2xl bg-white p-6 shadow">
      <h3 className="text-lg font-semibold mb-3">운동 자세 코멘트</h3>
      <ul className="list-disc pl-5 space-y-2 text-gray-700">
        {tips.map((t, i) => <li key={i}>{t}</li>)}
      </ul>
    </div>
  );
}

// 기존 휴리스틱 유지 (필요시 scorer.ts로 빼도 됨)
function makeComments(p: PoseBreakdown): string[] {
  const out: string[] = [];
  if ((p.overall ?? 0) >= 85) out.push("전반적으로 좋은 자세입니다. 현재 패턴을 유지하세요.");
  else if ((p.overall ?? 0) >= 70) out.push("기본 자세는 안정적입니다. 세부 요소 몇 가지만 보정하면 더 좋아져요.");
  else out.push("핵심 보정 포인트 중심으로 천천히 교정해 봅시다.");

  if ((p.depth ?? 100) < 70) out.push("스쿼트 깊이가 부족합니다. 엉덩이를 더 뒤로 보내고, 무릎-발끝 정렬을 유지하세요.");
  if ((p.knee_valgus ?? 100) < 70) out.push("무릎이 안쪽으로 모이는 경향이 있습니다. 발 아치 유지, 무릎은 두 번째 발가락 방향으로.");
  if ((p.back_angle ?? 100) < 70) out.push("허리 정렬이 무너집니다. 코어를 먼저 세팅하고 흉곽-골반 정렬을 유지하세요.");
  if ((p.balance ?? 100) < 70) out.push("무게중심이 흔들립니다. 발뒤꿈치-새끼발가락-엄지발가락 삼각 지지로 균형을 잡으세요.");

  return out;
}