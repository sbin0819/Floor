export type AdminMenu =
  | "dashboard"
  | "bookings"
  | "spaces"
  | "maintenance"
  | "roles"
  | "plans"
  | "announcements"
  | "reports";

export type AdminShellBranch = {
  id: string;
  name: string;
  menus: AdminMenu[];
  maintenanceCount?: number;
  reportSummary?: ReportSummary | null;
};

export type AdminShellData = {
  branchId: string;
  branches: AdminShellBranch[];
  user: { name: string };
};
import type { ReportSummary } from "./reports-types";
