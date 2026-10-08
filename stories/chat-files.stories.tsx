import { useState, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FilePanel } from "@/features/chat/components/file-panel";
import type { ReadRoomFiles } from "@/features/chat/file-client";
import type { RoomFile } from "@/features/chat/file-types";

const files: RoomFile[] = [
  {
    id: "10000000-0000-4000-8000-000000000001",
    name: "회의 화면.jpg",
    kind: "image",
    width: 1280,
    height: 960,
    size: 2457600,
    uploaderName: "김하은",
    sentAt: "2026-10-08T03:20:00.000Z",
    messageId: "20000000-0000-4000-8000-000000000001",
    seq: 12,
  },
  {
    id: "10000000-0000-4000-8000-000000000002",
    name: "프로젝트 제안서.pdf",
    kind: "file",
    width: null,
    height: null,
    size: 849920,
    uploaderName: "박지훈",
    sentAt: "2026-10-08T02:10:00.000Z",
    messageId: "20000000-0000-4000-8000-000000000002",
    seq: 11,
  },
  {
    id: "10000000-0000-4000-8000-000000000003",
    name: "정리한 참고 자료.zip",
    kind: "file",
    width: null,
    height: null,
    size: 8000000,
    uploaderName: "이서연",
    sentAt: "2026-10-07T06:00:00.000Z",
    messageId: "20000000-0000-4000-8000-000000000003",
    seq: 10,
  },
];
const readFiles: ReadRoomFiles = async (_room, { kind }) => ({
  files: files.filter((file) => kind === "all" || file.kind === kind),
  hasMore: false,
  nextCursor: null,
});
const fileUrl = () => "/seed/photos/meeting-screen-clay.webp";
function Preview({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, refetchOnWindowFocus: false },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <div className="flex h-150 w-full max-w-100 flex-col rounded-xl border border-border bg-card">
          <h2 className="border-b border-border px-4 py-3 text-lg font-bold">
            공유한 파일
          </h2>
          {children}
        </div>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
function Example({ enabled = true }: { enabled?: boolean }) {
  const [jump, setJump] = useState<number | null>(null);
  return (
    <>
      <FilePanel
        roomId="30000000-0000-4000-8000-000000000001"
        filesEnabled={enabled}
        readFiles={readFiles}
        fileUrl={fileUrl}
        onJump={(seq) => setJump(seq)}
      />
      {jump !== null && (
        <p
          role="status"
          className="border-t border-border px-4 py-2 text-xs text-muted-foreground"
        >
          미리보기: 메시지 {jump}번으로 이동해요
        </p>
      )}
    </>
  );
}
const meta = {
  title: "Chat/File panel",
  component: FilePanel,
  decorators: [
    (Story) => (
      <Preview>
        <Story />
      </Preview>
    ),
  ],
  args: {
    roomId: "30000000-0000-4000-8000-000000000001",
    filesEnabled: true,
    onJump: () => {},
    readFiles,
    fileUrl,
  },
} satisfies Meta<typeof FilePanel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Files: Story = { render: () => <Example /> };
export const DisabledStorage: Story = {
  render: () => <Example enabled={false} />,
};
export const Empty: Story = {
  args: {
    readFiles: async () => ({ files: [], hasMore: false, nextCursor: null }),
  },
};
export const Loading: Story = {
  args: { readFiles: () => new Promise(() => {}) },
};
export const ReadError: Story = {
  args: {
    readFiles: async () => {
      throw new Error("Preview-only error");
    },
  },
};
