export type AdminMenu = "dashboard" | "bookings" | "spaces" | "maintenance";

export type AdminShellBranch = {
  id: string;
  name: string;
  menus: AdminMenu[];
  maintenanceCount?: number;
};

export type AdminShellData = {
  branchId: string;
  branches: AdminShellBranch[];
  user: { name: string };
};
