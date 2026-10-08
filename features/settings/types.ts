import type { Avatar } from "@/lib/avatar";
import type { PersonProfile, UsernameSettings } from "@/features/people/types";
import type { Preferences } from "./schema";

export type ProfileSettings = {
  userId: string;
  name: string;
  avatar: Avatar;
  photo: boolean;
  photoProvider: "google" | "github" | null;
  photoUrl: string | null;
  usernameSettings: UsernameSettings;
  preview: PersonProfile;
};
export type AccountSettings = {
  email: string;
  emailVerified: boolean;
  providers: ("credential" | "google" | "github")[];
  sessions: {
    id: string;
    browser: string;
    os: string;
    device: "mobile" | "desktop";
    createdAt: string;
    updatedAt: string;
    current: boolean;
  }[];
};
export type PreferenceSettings = Preferences & {
  defaultBranchId: string | null;
  branches: { id: string; name: string }[];
};
