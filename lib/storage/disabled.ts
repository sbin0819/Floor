import type { FileStorage } from "./types";

export const disabledFileStorage: FileStorage = {
  kind: "disabled",
  async createUploadTarget() {
    throw new Error("File storage is disabled.");
  },
  async readHead() {
    return new Uint8Array();
  },
  async stat() {
    return null;
  },
  async readStream() {
    return null;
  },
  async remove() {},
};
