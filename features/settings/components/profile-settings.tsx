"use client";

import { useId, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { AVATAR_COLORS, type AvatarColor } from "@/lib/avatar";
import { UserAvatar, avatarColorClasses } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { UsernameForm } from "@/features/people/components/username-form";
import { PersonProfileContent } from "@/features/people/components/person-card";
import * as actions from "../actions";
import { updateNameSchema } from "../schema";
import type { ProfileSettings as ProfileSettingsData } from "../types";
import { SettingsCard } from "./settings-shell";

const colorNames: Record<AvatarColor, string> = {
  blue: "파랑",
  green: "초록",
  orange: "주황",
  purple: "보라",
  pink: "분홍",
  teal: "청록",
  yellow: "노랑",
  gray: "회색",
};
export function ProfileSettings({
  data,
  saveName = actions.updateName,
  saveAvatar = actions.updateAvatar,
}: {
  data: ProfileSettingsData;
  saveName?: typeof actions.updateName;
  saveAvatar?: typeof actions.updateAvatar;
}) {
  const router = useRouter();
  const id = useId();
  const [name, setName] = useState(data.name);
  const [input, setInput] = useState(data.name);
  const [avatar, setAvatar] = useState(data.avatar);
  const [photo, setPhoto] = useState(data.photo);
  const [username, setUsername] = useState(data.preview.username);
  const [nameError, setNameError] = useState("");
  const [avatarError, setAvatarError] = useState("");
  const nameLock = useRef(false);
  const avatarLock = useRef(false);
  const nameMutation = useMutation({
    mutationFn: (input: unknown) => saveName(input),
    retry: false,
  });
  const avatarMutation = useMutation({
    mutationFn: (input: unknown) => saveAvatar(input),
    retry: false,
  });
  async function changeAvatar(input: { color?: AvatarColor; photo?: boolean }) {
    if (avatarLock.current) return;
    avatarLock.current = true;
    const previous = { avatar, photo };
    setAvatarError("");
    setAvatar({
      color: input.color ?? avatar.color,
      photoUrl:
        input.photo === undefined
          ? avatar.photoUrl
          : input.photo
            ? data.photoUrl
            : null,
    });
    setPhoto(input.photo ?? photo);
    try {
      const result = await avatarMutation.mutateAsync(input);
      if (!result.ok) throw new Error("Profile save failed.");
      setAvatar(result.data.avatar);
      setPhoto(result.data.photo);
      toast.success("저장했어요");
      router.refresh();
    } catch {
      setAvatar(previous.avatar);
      setPhoto(previous.photo);
      setAvatarError("저장하지 못했어요. 다시 시도해 주세요");
    } finally {
      avatarLock.current = false;
    }
  }
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="space-y-5">
        <SettingsCard title="아바타">
          <UserAvatar
            name={name}
            avatar={avatar}
            size={72}
            alt="내 아바타 미리보기"
          />
          <fieldset disabled={avatarMutation.isPending} className="space-y-2">
            <legend className="text-sm">아바타 색</legend>
            <div className="flex flex-wrap gap-2">
              {AVATAR_COLORS.map((color) => (
                <label
                  key={color}
                  className="relative flex size-11 cursor-pointer items-center justify-center rounded-full has-focus-visible:outline-2 has-focus-visible:outline-ring"
                >
                  <input
                    className="peer sr-only"
                    type="radio"
                    name={`${id}-color`}
                    value={color}
                    checked={avatar.color === color}
                    onChange={() => void changeAvatar({ color })}
                    aria-label={colorNames[color]}
                  />
                  <span
                    className={`flex size-9 items-center justify-center rounded-full ${avatarColorClasses[color]}`}
                  >
                    {avatar.color === color && (
                      <Check aria-hidden="true" className="size-4" />
                    )}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          {data.photoProvider && (
            <div className="flex min-h-11 items-center justify-between gap-4">
              <Label htmlFor={`${id}-photo`}>
                {data.photoProvider === "google" ? "Google" : "GitHub"} 프로필
                사진 쓰기
              </Label>
              <Switch
                id={`${id}-photo`}
                checked={photo}
                disabled={avatarMutation.isPending}
                onCheckedChange={(value) => void changeAvatar({ photo: value })}
              />
            </div>
          )}
          {avatarError && (
            <p role="alert" className="text-sm text-destructive">
              {avatarError}
            </p>
          )}
        </SettingsCard>
        <SettingsCard title="이름">
          <form
            className="space-y-2"
            onSubmit={async (event) => {
              event.preventDefault();
              if (nameLock.current) return;
              const parsed = updateNameSchema.safeParse({ name: input });
              if (!parsed.success) {
                setNameError(parsed.error.issues[0]!.message);
                return;
              }
              nameLock.current = true;
              setNameError("");
              try {
                const result = await nameMutation.mutateAsync(parsed.data);
                if (!result.ok) {
                  setNameError(
                    result.fieldErrors?.name?.[0] ??
                      "저장하지 못했어요. 다시 시도해 주세요",
                  );
                  return;
                }
                setName(result.data.name);
                setInput(result.data.name);
                toast.success("저장했어요");
                router.refresh();
              } catch {
                setNameError("저장하지 못했어요. 다시 시도해 주세요");
              } finally {
                nameLock.current = false;
              }
            }}
          >
            <Label htmlFor={`${id}-name`}>이름</Label>
            <div className="flex gap-2">
              <Input
                id={`${id}-name`}
                value={input}
                disabled={nameMutation.isPending}
                onChange={(event) => setInput(event.target.value)}
                aria-invalid={Boolean(nameError)}
                aria-describedby={`${id}-hint${nameError ? ` ${id}-error` : ""}`}
              />
              <Button type="submit" disabled={nameMutation.isPending}>
                저장
              </Button>
            </div>
            <p id={`${id}-hint`} className="text-xs text-muted-foreground">
              예약, 채팅, 알림에 이 이름이 보여요. 다른 사람에게는 사용자 이름이
              함께 보여서 같은 이름이어도 구별돼요.
            </p>
            {nameError && (
              <p
                id={`${id}-error`}
                role="alert"
                className="text-sm text-destructive"
              >
                {nameError}
              </p>
            )}
          </form>
        </SettingsCard>
        <SettingsCard title="사용자 이름">
          <UsernameForm
            settings={data.usernameSettings}
            onSaved={setUsername}
          />
        </SettingsCard>
      </div>
      <SettingsCard title="다른 사람에게 이렇게 보여요">
        <PersonProfileContent
          person={{ ...data.preview, name, avatar, username }}
          preview
        />
        <p className="text-xs text-muted-foreground">
          직함은 팀마다 달라요. 팀 관리에서 바꿀 수 있어요.
        </p>
      </SettingsCard>
    </div>
  );
}
