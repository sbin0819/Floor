import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { AuthCard } from "@/features/auth/components/auth-card";
import {
  AuthFeedback,
  AuthField,
} from "@/features/auth/components/auth-fields";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

const meta = {
  title: "Auth/Foundation",
  component: AuthCard,
  parameters: { layout: "centered", nextjs: { appDirectory: true } },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="w-[min(400px,90vw)]">
        <Story />
      </div>
    ),
  ],
  args: { title: "Floor에 로그인" },
} satisfies Meta<typeof AuthCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Login: Story = {
  args: {
    children: (
      <div className="space-y-4">
        <Button variant="outline" className="w-full">
          Google로 계속하기
        </Button>
        <Separator />
        <AuthField
          label="이메일"
          name="email"
          type="email"
          autoComplete="email"
        />
        <AuthField
          label="비밀번호"
          name="password"
          type="password"
          autoComplete="current-password"
        />
        <Button className="w-full">로그인</Button>
      </div>
    ),
  },
};
export const Feedback: Story = {
  args: {
    title: "가입 정보 확인",
    children: (
      <div className="space-y-4">
        <AuthFeedback message="요청을 처리하지 못했어요. 잠시 뒤 다시 시도해 주세요" />
        <AuthField
          label="이메일"
          name="email"
          type="email"
          defaultValue="invalid"
          error="이메일 형식으로 입력해 주세요"
        />
      </div>
    ),
  },
};
