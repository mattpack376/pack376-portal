"use client";

import { useActionState } from "react";
import { updateUserRoleAction, type UpdateUserRoleState } from "@/lib/actions/users";

const initialState: UpdateUserRoleState = {};

export default function ManageUserRoleForm({
  userId,
  role,
}: {
  userId: string;
  role: "ADMIN" | "ATTENDANCE_ADMIN";
}) {
  const [state, formAction, pending] = useActionState(updateUserRoleAction, initialState);

  return (
    <form action={formAction}>
      <input type="hidden" name="userId" value={userId} />
      <div className="form-field">
        <label htmlFor="role">Permission Level</label>
        <select id="role" name="role" defaultValue={role}>
          <option value="ADMIN">Admin — Full Privileges</option>
          <option value="ATTENDANCE_ADMIN">Attendance/Photos — pack-wide attendance, add/edit albums</option>
        </select>
      </div>
      {state?.error && <p className="form-error">{state.error}</p>}
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Saving…" : "Save Permission Level"}
      </button>
    </form>
  );
}
