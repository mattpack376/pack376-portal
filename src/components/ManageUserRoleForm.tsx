"use client";

import { useActionState } from "react";
import { updateUserRoleAction, type UpdateUserRoleState } from "@/lib/actions/users";
import type { AssignableRole } from "@/lib/roleLabels";

const initialState: UpdateUserRoleState = {};

export default function ManageUserRoleForm({
  userId,
  role,
}: {
  userId: string;
  role: AssignableRole;
}) {
  const [state, formAction, pending] = useActionState(updateUserRoleAction, initialState);

  return (
    <form action={formAction}>
      <input type="hidden" name="userId" value={userId} />
      <div className="form-field">
        <label htmlFor="role">Permission Level</label>
        <select id="role" name="role" defaultValue={role}>
          <option value="ADMIN">Admin — Full Privileges</option>
          <option value="JUNIOR_ADMIN">Junior Admin — attendance, advancement, all dens (no albums)</option>
          <option value="ATTENDANCE_ADMIN">Attendance Only — attendance for all dens</option>
          <option value="PHOTOGRAPHER">Photographer — add/edit albums only (no delete)</option>
          <option value="DEN">Den Leader — advancement & attendance for their assigned den(s)</option>
        </select>
      </div>
      {state?.error && <p className="form-error">{state.error}</p>}
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Saving…" : "Save Permission Level"}
      </button>
    </form>
  );
}
