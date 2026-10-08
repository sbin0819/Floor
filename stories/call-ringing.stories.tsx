import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { CallRingingCard } from "@/features/calls/components/call-ringing";
import { CallingStatusMessage } from "@/features/calls/components/calling-status";

const meta = {
  title: "Calls/Ringing and waiting",
  parameters: { layout: "centered" },
  render: () => (
    <div className="w-80">
      <CallRingingCard
        name="이서연"
        onAccept={async () => {}}
        onDecline={async () => true}
      />
    </div>
  ),
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const Incoming: Story = {};
export const DeclineFailure: Story = {
  render: () => (
    <div className="w-80">
      <CallRingingCard
        name="이서연"
        onAccept={async () => {}}
        onDecline={async () => false}
      />
    </div>
  ),
};
export const Waiting: Story = {
  render: () => <CallingStatusMessage name="이서연" unanswered={false} />,
};
export const Unanswered: Story = {
  render: () => <CallingStatusMessage name="이서연" unanswered />,
};
