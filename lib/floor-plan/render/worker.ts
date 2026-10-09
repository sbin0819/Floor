import { preprocessPlan, type PlanSceneRequest } from "./preprocess";

globalThis.onmessage = ({ data }: MessageEvent<PlanSceneRequest>) => {
  globalThis.postMessage(preprocessPlan(data));
};
// 번들러의 비동기 부트스트랩 전에 보낸 첫 메시지가 유실되지 않도록 알린다.
globalThis.postMessage({ type: "ready" });
