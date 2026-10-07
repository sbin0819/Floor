import type { EmailMessage } from "./types";

type LinkMessage = { to: string; url: string };

export function verificationEmail({ to, url }: LinkMessage): EmailMessage {
  return {
    to,
    subject: "Floor 이메일을 인증해 주세요",
    text: `아래 링크를 눌러 이메일 인증을 마쳐 주세요. 인증 뒤 로그인해 주세요.\n\n${url}\n\n가입한 적이 없으면 링크를 누르지 마세요.`,
  };
}

export function passwordResetEmail({ to, url }: LinkMessage): EmailMessage {
  return {
    to,
    subject: "Floor 비밀번호를 다시 설정해 주세요",
    text: `아래 링크에서 새 비밀번호를 정해 주세요.\n\n${url}\n\n직접 요청하지 않았다면 이 메일을 무시해 주세요.`,
  };
}

export function existingAccountEmail({ to, url }: LinkMessage): EmailMessage {
  return {
    to,
    subject: "Floor에 이미 가입된 이메일이에요",
    text: `이 이메일로 가입된 계정이 있어요. 아래 주소에서 로그인해 주세요. 비밀번호를 잊었다면 재설정을 요청할 수 있어요.\n\n${url}\n\n직접 요청하지 않았다면 이 메일을 무시해 주세요.`,
  };
}

export function socialAccountLinkedEmail({
  to,
  url,
  provider,
}: LinkMessage & { provider: string }): EmailMessage {
  return {
    to,
    subject: "Floor에 소셜 로그인이 연결됐어요",
    text: `${provider} 로그인이 연결됐어요. 계정을 안전하게 보호하기 위해 이전 비밀번호와 로그인 세션을 해제했어요.\n\n비밀번호로도 로그인하려면 아래 주소에서 새 비밀번호를 정해 주세요.\n\n${url}`,
  };
}
