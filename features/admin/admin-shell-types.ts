export type AdminMenu = "dashboard" | "bookings" | "spaces";

export type AdminShellBranch = {
  id: string;
  name: string;
  menus: AdminMenu[];
};

export type AdminShellData = {
  branchId: string;
  branches: AdminShellBranch[];
  user: { name: string };
};
