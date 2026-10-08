import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { MessageAttachments } from "@/features/chat/components/message-attachments";
import { AttachmentStrip } from "@/features/chat/components/attachment-strip";
import { MessageComposer } from "@/features/chat/components/message-composer";
import { UploadDropArea } from "@/features/chat/components/upload-drop-area";
import {
  createUploadController,
  uploadErrors,
} from "@/features/chat/upload-controller";
import type { ChatAttachment } from "@/features/chat/types";

const image: ChatAttachment = {
  id: "image-one",
  name: "회의실 리뷰 사진.webp",
  size: 2516582,
  kind: "image",
  width: 1200,
  height: 800,
};
const tall: ChatAttachment = {
  ...image,
  id: "image-two",
  name: "세로로 긴 참고 그림.webp",
  width: 120,
  height: 1200,
};
const file: ChatAttachment = {
  ...image,
  id: "document",
  name: "디자인 리뷰 자료와 긴 파일 이름.pdf",
  kind: "file",
  width: null,
  height: null,
  size: 830 * 1024,
};
const fileUrl = (id: string) =>
  id === "image-two"
    ? "/seed/photos/phone-booth-sage.webp"
    : "/seed/photos/meeting-small-oak.webp";
const meta = {
  title: "Chat/Attachments",
  component: MessageAttachments,
  args: { attachments: [image], fileUrl },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-3xl p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MessageAttachments>;
export default meta;
type Story = StoryObj<typeof meta>;
export const SingleImage: Story = {};
export const MultipleImagesAndFile: Story = {
  args: { attachments: [image, tall, file] },
};
export const TallImage: Story = { args: { attachments: [tall] } };
export const FileCard: Story = { args: { attachments: [file] } };
export const Disabled: Story = {
  args: { attachments: [image, file], enabled: false },
};
export const UploadStates: Story = {
  render: () => (
    <AttachmentStrip
      items={[
        {
          id: "progress",
          file: new File(["sample"], image.name),
          name: image.name,
          size: image.size,
          previewUrl: fileUrl(image.id),
          status: "uploading",
          progress: 64,
        },
        {
          id: "failed",
          file: new File(["sample"], file.name),
          name: file.name,
          size: file.size,
          previewUrl: null,
          status: "failed",
          progress: 0,
          error: uploadErrors.failed,
        },
        {
          id: "ready",
          file: new File(["sample"], file.name),
          name: "완료한 자료.pdf",
          size: file.size,
          previewUrl: null,
          status: "ready",
          progress: 100,
          attachment: file,
        },
      ]}
      onRemove={() => undefined}
      onRetry={() => undefined}
    />
  ),
};

function MockUploadComposer() {
  const [sent, setSent] = useState<ChatAttachment[]>([]);
  const [notice, setNotice] = useState("");
  const [uploads] = useState(() => {
    const data = new Map<string, { name: string; size: number }>();
    return createUploadController({
      roomId: "story-room",
      actions: {
        create: async ({ files }) => ({
          ok: true,
          data: files.map((entry) => {
            const id = crypto.randomUUID();
            data.set(id, entry);
            return {
              attachmentId: id,
              uploadUrl: "/storybook-upload-only",
              method: "PUT",
              headers: {},
            };
          }),
        }),
        complete: async ({ attachmentIds }) => ({
          ok: true,
          data: attachmentIds.map((attachmentId) => ({
            attachmentId,
            ok: true,
            ...data.get(attachmentId)!,
            kind: "file",
            width: null,
            height: null,
          })),
        }),
        discard: async () => ({ ok: true, data: {} }),
      },
      upload: async (_url, _file, { onProgress, signal }) =>
        new Promise<void>((resolve, reject) => {
          let progress = 0;
          const timer = setInterval(() => {
            progress += 20;
            onProgress(progress);
            if (progress >= 100) {
              clearInterval(timer);
              signal.removeEventListener("abort", abort);
              resolve();
            }
          }, 120);
          const abort = () => {
            clearInterval(timer);
            reject(new DOMException("Aborted", "AbortError"));
          };
          signal.addEventListener("abort", abort, { once: true });
        }),
      objectUrls: {
        create: (file) => URL.createObjectURL(file),
        revoke: (url) => URL.revokeObjectURL(url),
      },
      notify: setNotice,
    });
  });
  useEffect(() => {
    uploads.activate();
    return () => uploads.dispose();
  }, [uploads]);
  return (
    <UploadDropArea uploads={uploads}>
      <div className="min-h-48 space-y-3 p-4">
        <p>가짜 업로드예요. 실제 서버로 파일을 보내지 않아요.</p>
        {notice && <p role="alert">{notice}</p>}
        <MessageAttachments attachments={sent} fileUrl={fileUrl} />
      </div>
      <MessageComposer
        channelName="일반"
        uploads={uploads}
        uploadUnavailable={null}
        onSend={(_body, _reply, attachments) => setSent(attachments ?? [])}
      />
    </UploadDropArea>
  );
}
export const UploadInteraction: Story = {
  render: () => <MockUploadComposer />,
};
