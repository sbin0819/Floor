"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateBranch } from "@/features/admin/actions";
import { updateBranchSchema } from "@/features/admin/schema";
import type { BranchDetails } from "@/features/bookings/types";
import { Field, fieldAria, FormMessage } from "./form-fields";
import { completeOpenHours, OpenHoursFields } from "./open-hours-fields";
import { useAdminMutation } from "./use-admin-mutation";

export function BranchForm({
  branch,
  canManage,
}: {
  branch: BranchDetails;
  canManage: boolean;
}) {
  const id = useId();
  const [name, setName] = useState(branch.name);
  const [address, setAddress] = useState(branch.address ?? "");
  const [openHours, setOpenHours] = useState(() =>
    completeOpenHours(branch.openHours),
  );
  const mutation = useAdminMutation({ action: updateBranch });
  const disabled = !canManage || mutation.pending;
  return (
    <form
      noValidate
      className="space-y-5 rounded-xl border bg-card p-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled)
          void mutation.submit(updateBranchSchema, {
            branchId: branch.id,
            name,
            address,
            openHours,
          });
      }}
    >
      <h2 className="text-lg font-semibold">지점 정보</h2>
      {!canManage && (
        <p className="text-muted-foreground">
          읽기 전용이에요. 지점 정보를 고칠 권한이 없어요
        </p>
      )}
      <Field id={`${id}-name`} label="지점 이름" error={mutation.errors.name}>
        <Input
          id={`${id}-name`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={disabled}
          maxLength={40}
          {...fieldAria(`${id}-name`, mutation.errors.name)}
        />
      </Field>
      <Field id={`${id}-address`} label="주소" error={mutation.errors.address}>
        <Input
          id={`${id}-address`}
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          disabled={disabled}
          maxLength={100}
          {...fieldAria(`${id}-address`, mutation.errors.address)}
        />
      </Field>
      <p className="text-muted-foreground">
        시간대: {branch.timezone} · 운영 시간을 바꿔도 이미 있는 예약은 유지돼요
      </p>
      <OpenHoursFields
        value={openHours}
        onChange={setOpenHours}
        disabled={disabled}
        errors={mutation.errors}
      />
      <FormMessage message={mutation.message} />
      <Button disabled={disabled} type="submit">
        {mutation.pending ? "저장하고 있어요" : "지점 정보 저장"}
      </Button>
    </form>
  );
}
