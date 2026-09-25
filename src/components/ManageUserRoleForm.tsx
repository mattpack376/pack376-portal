"use client";

import { useActionState } from "react";
import { updateUserRoleAction, type UpdateUserRoleState } from "@/lib/actions/users";
import { ASSIGNABLE_ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS, type AssignableRole } from "@/lib/roleLabels";

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
          {/* Every assignable role, including the account's current one —
              a missing option would leave the browser showing the first
              (Admin), and saving would silently promote the account. */}
          {ASSIGNABLE_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]} — {ROLE_DESCRIPTIONS[r]}
            </option>
          ))}
        </select>
      </div>
      {state?.error && <p className="form-error">{state.error}</p>}
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Saving…" : "Save Permission Level"}
      </button>
    </form>
  );
}
