import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createUploadController,
  uploadErrors,
  type UploadActions,
} from "@/features/chat/upload-controller";
import { UploadHttpError, type UploadFile } from "@/features/chat/upload-file";
import { MAX_UPLOAD_BYTES } from "@/features/chat/upload-types";

const roomId = "10000000-0000-4000-8000-000000000001";
const file = (name = "자료.txt", type = "text/plain") =>
  new File(["abc"], name, { type });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};
function setup(upload: UploadFile = async () => undefined) {
  const actions = {
    create: vi
      .fn<UploadActions["create"]>()
      .mockImplementation(async ({ files }) => ({
        ok: true,
        data: files.map(() => ({
          attachmentId: crypto.randomUUID(),
          uploadUrl: "/upload",
          method: "PUT",
          headers: {},
        })),
      })),
    complete: vi
      .fn<UploadActions["complete"]>()
      .mockImplementation(async ({ attachmentIds }) => ({
        ok: true,
        data: attachmentIds.map((attachmentId) => ({
          attachmentId,
          ok: true,
          name: "자료.txt",
          size: 3,
          kind: "file",
          width: null,
          height: null,
        })),
      })),
    discard: vi
      .fn<UploadActions["discard"]>()
      .mockResolvedValue({ ok: true, data: {} }),
  };
  const notify = vi.fn();
  const objectUrls = { create: vi.fn(() => "blob:preview"), revoke: vi.fn() };
  const controller = createUploadController({
    roomId,
    actions,
    upload,
    notify,
    objectUrls,
  });
  return { controller, actions, notify, objectUrls };
}

describe("room-scoped upload workflow", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("reserves one batch, allows three PUTs at once and batches completions for one second", async () => {
    const waiting = Array.from({ length: 5 }, () => deferred<void>());
    let index = 0;
    const upload = vi
      .fn<UploadFile>()
      .mockImplementation(async (_url, _file, { onProgress }) => {
        onProgress(40);
        return waiting[index++]!.promise;
      });
    const { controller, actions } = setup(upload);
    controller.add(Array.from({ length: 5 }, () => file()));
    await flush();
    expect(actions.create).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledTimes(3);
    expect(controller.getSnapshot().map((item) => item.status)).toEqual([
      "uploading",
      "uploading",
      "uploading",
      "queued",
      "queued",
    ]);
    expect(controller.getSnapshot()[0]?.progress).toBe(40);
    waiting[0]!.resolve();
    await flush();
    expect(upload).toHaveBeenCalledTimes(4);
    waiting.slice(1).forEach((value) => value.resolve());
    await flush();
    expect(upload).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(999);
    expect(actions.complete).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(actions.complete).toHaveBeenCalledTimes(1);
    expect(actions.complete.mock.calls[0]![0].attachmentIds).toHaveLength(5);
    expect(
      controller.getSnapshot().every((item) => item.status === "ready"),
    ).toBe(true);
    const taken = controller.take();
    expect(taken).toHaveLength(5);
    expect(controller.getSnapshot()).toEqual([]);
    controller.dispose();
    expect(actions.discard).not.toHaveBeenCalled();
  });
  it("checks names, sizes and total count before requesting reservations", async () => {
    const { controller, actions, notify } = setup();
    const large = file("big.txt");
    Object.defineProperty(large, "size", { value: MAX_UPLOAD_BYTES + 1 });
    controller.add([
      file("bad.exe. "),
      large,
      ...Array.from({ length: 11 }, () => file()),
    ]);
    await flush();
    expect(actions.create.mock.calls[0]![0].files).toHaveLength(10);
    expect(notify.mock.calls.map(([message]) => message)).toEqual([
      uploadErrors.blocked,
      uploadErrors.size,
      uploadErrors.count,
    ]);
    controller.add([file()]);
    expect(actions.create).toHaveBeenCalledTimes(1);
    controller.dispose();
  });
  it.each([uploadErrors.disabled, uploadErrors.request, uploadErrors.offline])(
    "does not begin unavailable uploads: %s",
    async (reason) => {
      const { controller, actions, notify } = setup();
      controller.setUnavailable(reason);
      controller.add([file()]);
      await flush();
      expect(notify).toHaveBeenCalledExactlyOnceWith(reason);
      expect(actions.create).not.toHaveBeenCalled();
      expect(controller.getSnapshot()).toEqual([]);
    },
  );
  it.each([
    [
      { ok: false, code: "LIMIT_EXCEEDED", message: "storage_quota" },
      uploadErrors.quota,
    ],
    [{ ok: false, code: "LIMIT_EXCEEDED" }, uploadErrors.rate],
    [{ ok: false, code: "FORBIDDEN" }, uploadErrors.request],
  ] as const)(
    "shows safe server reservation errors",
    async (result, expected) => {
      const { controller, actions, notify } = setup();
      actions.create.mockResolvedValueOnce(result);
      controller.add([file()]);
      await flush();
      expect(notify).toHaveBeenCalledExactlyOnceWith(expected);
      expect(controller.getSnapshot()[0]).toMatchObject({
        status: "failed",
        error: expected,
      });
      controller.dispose();
    },
  );
  it("aborts removal, discards only its reservation and revokes its local preview", async () => {
    const pending = deferred<void>();
    let signal: AbortSignal | undefined;
    const { controller, actions, objectUrls } = setup(
      async (_url, _file, options) => {
        signal = options.signal;
        return pending.promise;
      },
    );
    controller.add([file("사진.png", "image/png")]);
    await flush();
    const item = controller.getSnapshot()[0]!;
    controller.remove(item.id);
    expect(signal?.aborted).toBe(true);
    expect(actions.discard).toHaveBeenCalledExactlyOnceWith({
      attachmentIds: [item.target!.attachmentId],
    });
    expect(objectUrls.revoke).toHaveBeenCalledExactlyOnceWith("blob:preview");
    pending.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    expect(actions.complete).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toEqual([]);
  });
  it("discards late reservations after removal or leaving without resurrecting rows", async () => {
    const { controller, actions } = setup();
    const pending = deferred<Awaited<ReturnType<UploadActions["create"]>>>();
    actions.create.mockReturnValueOnce(pending.promise);
    controller.add([file()]);
    controller.dispose();
    const attachmentId = crypto.randomUUID();
    pending.resolve({
      ok: true,
      data: [
        { attachmentId, uploadUrl: "/upload", method: "PUT", headers: {} },
      ],
    });
    await flush();
    expect(actions.discard).toHaveBeenCalledExactlyOnceWith({
      attachmentIds: [attachmentId],
    });
    expect(controller.getSnapshot()).toEqual([]);
  });
  it("retries a still-pending target without making a second reservation", async () => {
    const upload = vi
      .fn<UploadFile>()
      .mockRejectedValueOnce(new UploadHttpError(0))
      .mockResolvedValue(undefined);
    const { controller, actions } = setup(upload);
    controller.add([file()]);
    await flush();
    const item = controller.getSnapshot()[0]!;
    expect(item.status).toBe("failed");
    controller.retry(item.id);
    await flush();
    expect(actions.create).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(controller.getSnapshot()[0]?.status).toBe("ready");
    controller.dispose();
  });
  it("makes a new reservation after a retired target and after blocked completion", async () => {
    const upload = vi
      .fn<UploadFile>()
      .mockRejectedValueOnce(new UploadHttpError(404))
      .mockResolvedValue(undefined);
    const { controller, actions } = setup(upload);
    controller.add([file()]);
    await flush();
    const id = controller.getSnapshot()[0]!.id;
    expect(controller.getSnapshot()[0]?.target).toBeUndefined();
    controller.retry(id);
    await flush();
    actions.complete.mockImplementationOnce(async ({ attachmentIds }) => ({
      ok: true,
      data: [
        { attachmentId: attachmentIds[0]!, ok: false, reason: "blocked_type" },
      ],
    }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(controller.getSnapshot()[0]).toMatchObject({
      status: "failed",
      error: uploadErrors.blocked,
      target: undefined,
    });
    controller.retry(id);
    await flush();
    expect(actions.create).toHaveBeenCalledTimes(3);
    controller.dispose();
  });
  it("confirms an immutable already-published object after HTTP 409 instead of retrying PUT", async () => {
    const upload = vi
      .fn<UploadFile>()
      .mockRejectedValue(new UploadHttpError(409));
    const { controller, actions } = setup(upload);
    controller.add([file()]);
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    expect(actions.complete).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot()[0]?.status).toBe("ready");
    controller.dispose();
  });
  it("keeps completion retries idempotent after a lost action response", async () => {
    const { controller, actions } = setup();
    actions.complete.mockRejectedValueOnce(new Error("network"));
    controller.add([file()]);
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    const id = controller.getSnapshot()[0]!.id;
    controller.retry(id);
    await vi.advanceTimersByTimeAsync(1000);
    expect(actions.create).toHaveBeenCalledTimes(1);
    expect(actions.complete).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot()[0]?.status).toBe("ready");
    controller.dispose();
  });
  it("does not transfer incomplete or failed attachments into messages", async () => {
    const { controller } = setup(async () => {
      throw new Error("network");
    });
    controller.add([file()]);
    expect(controller.take()).toEqual([]);
    await flush();
    expect(controller.take()).toEqual([]);
    expect(controller.getSnapshot()).toHaveLength(1);
    controller.dispose();
  });
});
