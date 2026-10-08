import type { StorybookConfig } from "@storybook/nextjs-vite";
import { fileURLToPath } from "node:url";

const actionModules = [
  "features/settings/actions",
  "features/calls/actions",
  "features/chat/actions",
  "features/chat/upload-actions",
  "features/chat/space-actions",
  "features/people/actions",
  "features/notifications/actions",
  "features/bookings/actions",
  "features/bookings/create-booking-actions",
  "features/bookings/cancel-booking-action",
  "features/bookings/create-desk-booking-action",
  "features/bookings/leave-booking-action",
  "features/admin/actions",
  "features/admin/manage-actions",
  "features/admin/access-actions",
  "features/teams/actions",
  "features/teams/manage-actions",
  "features/teams/create-team-action",
  "features/teams/join-request-actions",
  "features/teams/invite-management-actions",
  "features/teams/invite-response-actions",
];

const config: StorybookConfig = {
  stories: ["../stories/**/*.stories.tsx", "../components/**/*.stories.tsx"],
  addons: ["@storybook/addon-docs"],
  framework: "@storybook/nextjs-vite",
  staticDirs: ["../public"],
  viteFinal(config) {
    const aliases = config.resolve?.alias;
    const replacement = fileURLToPath(
      new URL("./mocks/server-actions.ts", import.meta.url),
    );
    return {
      ...config,
      resolve: {
        ...config.resolve,
        // Storybook은 서버 액션 모듈 자체를 대체해 DB·인증 코드도 평가하지 않는다.
        // 앱의 번들 설정은 바꾸지 않고 모든 미리보기의 쓰기는 거절한다.
        alias: [
          ...actionModules.flatMap((path) => [
            { find: `@/${path}`, replacement },
            {
              find: fileURLToPath(new URL(`../${path}.ts`, import.meta.url)),
              replacement,
            },
          ]),
          ...(Array.isArray(aliases)
            ? aliases
            : Object.entries(aliases ?? {}).map(([find, replacement]) => ({
                find,
                replacement,
              }))),
        ],
      },
    };
  },
};
export default config;
