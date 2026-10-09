import { ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
export function PhotoUploadProgress({
  progress,
  onCancel,
}: {
  progress: number;
  onCancel: () => void;
}) {
  return (
    <div
      className="flex aspect-[16/10] flex-col items-center justify-center gap-3 rounded-xl border bg-card p-4"
      aria-busy="true"
    >
      <ImagePlus aria-hidden="true" />
      <p>사진을 올리고 있어요</p>
      <progress
        aria-label="사진 업로드"
        value={progress}
        max={100}
        className="w-full"
      />
      <span className="tabular-nums">{progress}%</span>
      <Button variant="outline" onClick={onCancel}>
        업로드 취소
      </Button>
    </div>
  );
}
