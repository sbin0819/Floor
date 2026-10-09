"use client";

import { SignOutButton } from "@/components/sign-out-button";
import { requestAdminNavigation } from "../admin-navigation-guard";

export function AdminSignOutButton() {
  return <SignOutButton beforeSignOut={requestAdminNavigation} />;
}
