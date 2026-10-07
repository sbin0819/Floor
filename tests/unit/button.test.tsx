import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { Button } from "@/components/ui/button";

it("키보드로 버튼을 실행하고 비활성 버튼은 실행하지 않아요", async () => {
  const click = vi.fn();
  const user = userEvent.setup();
  render(
    <>
      <Button onClick={click}>예약하기</Button>
      <Button disabled onClick={click}>
        취소하기
      </Button>
    </>,
  );
  await user.tab();
  expect(screen.getByRole("button", { name: "예약하기" })).toHaveFocus();
  await user.keyboard("{Enter}");
  expect(click).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "취소하기" }));
  expect(click).toHaveBeenCalledTimes(1);
});
