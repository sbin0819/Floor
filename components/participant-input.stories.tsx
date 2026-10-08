import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { BookingParticipantDraft } from "@/features/bookings/participants";
import { ParticipantInput } from "./participant-input";

const people: BookingParticipantDraft[] = [
  {
    userId: "first",
    name: "이서연",
    avatar: { color: "blue" as const, photoUrl: null },
    sharedTeamNames: ["디자인팀"],
    maskedEmail: "se•••@floor.example",
  },
  {
    userId: "second",
    name: "김하은",
    avatar: { color: "blue" as const, photoUrl: null },
    sharedTeamNames: [],
    maskedEmail: "ha•••@floor.example",
    email: "haneul@floor.example",
  },
];
const meta = {
  title: "컴포넌트/ParticipantInput",
  component: ParticipantInput,
  tags: ["autodocs"],
  args: {
    value: [],
    onChange: () => {},
    maxParticipants: 7,
    search: async () =>
      people.map(({ userId, name, avatar, sharedTeamNames, maskedEmail }) => ({
        userId,
        name,
        avatar,
        sharedTeamNames,
        maskedEmail,
      })),
  },
  render: function Example(args) {
    const [client] = useState(() => new QueryClient());
    const [value, onChange] = useState(args.value);
    return (
      <QueryClientProvider client={client}>
        <div className="w-96 max-w-full rounded-xl border border-border bg-card p-4">
          <ParticipantInput {...args} value={value} onChange={onChange} />
        </div>
      </QueryClientProvider>
    );
  },
} satisfies Meta<typeof ParticipantInput>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Empty: Story = {};
export const TwoParticipants: Story = { args: { value: people } };
export const Results: Story = { args: { defaultQuery: "이서" } };
export const Loading: Story = {
  args: { defaultQuery: "이서", search: () => new Promise(() => {}) },
};
export const NotFound: Story = {
  args: { defaultQuery: "없는 이름", search: async () => [] },
};
export const AtCapacity: Story = {
  args: { value: people, maxParticipants: 2 },
};
