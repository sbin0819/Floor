import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { ViewportMap } from "storybook/viewport";
import {
  Bell,
  CalendarDays,
  ChevronsUpDown,
  House,
  LayoutGrid,
  Users,
} from "lucide-react";
import { AppShellFrame } from "./app-shell-frame";
import { TooltipProvider } from "./ui/tooltip";

const viewports = {
  mobile390: {
    name: "모바일 · 390px",
    styles: { width: "390px", height: "844px" },
    type: "mobile",
  },
  tablet1024: {
    name: "태블릿 · 1024px",
    styles: { width: "1024px", height: "900px" },
    type: "tablet",
  },
  desktop1440: {
    name: "데스크톱 · 1440px",
    styles: { width: "1440px", height: "900px" },
    type: "desktop",
  },
} satisfies ViewportMap;

function ExampleMenu() {
  return (
    <nav aria-label="회원 메뉴" className="flex flex-col gap-1">
      {[
        { href: "/", label: "홈", Icon: House },
        { href: "/booking", label: "공간 예약", Icon: LayoutGrid },
        { href: "/bookings", label: "내 예약", Icon: CalendarDays },
        { href: "/teams", label: "팀", Icon: Users },
      ].map(({ href, label, Icon }) => (
        <a
          key={href}
          href={href}
          onClick={(event) => event.preventDefault()}
          aria-current={href === "/" ? "page" : undefined}
          className="relative inline-flex h-11 items-center gap-2 rounded-lg px-3 text-sm text-muted-foreground hover:bg-sidebar-accent/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-[current=page]:bg-sidebar-accent aria-[current=page]:font-semibold aria-[current=page]:text-sidebar-accent-foreground"
        >
          <Icon aria-hidden="true" className="size-5" />
          {label}
        </a>
      ))}
    </nav>
  );
}

const meta = {
  title: "앱의 틀/회원 화면",
  component: AppShellFrame,
  parameters: {
    layout: "fullscreen",
    nextjs: { appDirectory: true, navigation: { pathname: "/" } },
    viewport: { options: viewports },
  },
  decorators: [
    (Story) => (
      <TooltipProvider>
        {/* 공통 preview의 p-6만 상쇄해 실제 viewport 너비로 틀을 확인한다. */}
        <div className="-m-6">
          <Story />
        </div>
      </TooltipProvider>
    ),
  ],
  args: {
    menu: <ExampleMenu />,
    accountCard: (
      <button
        type="button"
        aria-label="김하은님 사용자 메뉴"
        className="flex h-14 w-full items-center gap-3 rounded-lg px-3 focus-visible:outline-2 focus-visible:outline-ring"
      >
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm"
        >
          김
        </span>
        <span className="min-w-0 flex-1 truncate text-left text-sm font-semibold">
          김하은
        </span>
        <ChevronsUpDown aria-hidden="true" className="size-4 shrink-0" />
      </button>
    ),
    accountAvatar: (
      <button
        type="button"
        aria-label="김하은님 사용자 메뉴"
        className="flex size-11 items-center justify-center rounded-full bg-muted text-sm focus-visible:outline-2 focus-visible:outline-ring"
      >
        김
      </button>
    ),
    notifications: (
      <button
        type="button"
        aria-label="알림"
        className="flex size-11 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-ring"
      >
        <Bell aria-hidden="true" className="size-5" />
      </button>
    ),
    children: (
      <main className="mx-auto max-w-[1184px] space-y-6 px-4 py-8 md:px-8">
        <h1 className="text-[26px] font-bold tracking-tight">
          안녕하세요, 김하은 님
        </h1>
        <p className="text-sm text-muted-foreground">
          조회 없이 가짜 조각으로 그린 앱의 틀이에요.
        </p>
        <section
          aria-label="예시 본문"
          className="min-h-96 rounded-xl border border-border bg-card p-5 shadow-card"
        >
          <h2 className="text-sm font-semibold">화면 내용</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            메뉴 서랍과 화면 폭에 따른 배치를 확인해 보세요.
          </p>
        </section>
      </main>
    ),
  },
} satisfies Meta<typeof AppShellFrame>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Mobile390: Story = {
  name: "모바일 · 390px",
  globals: { viewport: { value: "mobile390", isRotated: false } },
};

export const Tablet1024: Story = {
  name: "태블릿 · 1024px",
  globals: { viewport: { value: "tablet1024", isRotated: false } },
};

export const Desktop1440: Story = {
  name: "데스크톱 · 1440px",
  globals: { viewport: { value: "desktop1440", isRotated: false } },
};
