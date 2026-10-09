export function reportPostCommitFailure(
  message: string,
  log: (message: unknown) => void = console.error,
) {
  try {
    log(message);
  } catch {
    // 기록 장치의 실패가 이미 커밋한 쓰기를 실패 응답으로 바꾸지 않게 한다.
  }
}
