"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateUserRoleAction } from "@/lib/actions/users";

export default function RoleSelect({
  userId,
  role,
}: {
  userId: string;
  role: "ADMIN" | "ATTENDANCE_ADMIN";
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as "ADMIN" | "ATTENDANCE_ADMIN";
    if (next === role) return;
    startTransition(async () => {
      const result = await updateUserRoleAction(userId, next);
      if (result.ok) {
        setError(null);
        router.refresh();
      } else {
        setError(result.error || "Something went wrong.");
      }
    });
  }

  return (
    <div>
      <select value={role} onChange={handleChange} disabled={isPending} style={{ padding: "6px 8px", fontSize: 13 }}>
        <option value="ADMIN">Full Admin</option>
        <option value="ATTENDANCE_ADMIN">Attendance Only</option>
      </select>
      {error && <p className="form-error" style={{ marginTop: 4, fontSize: 12 }}>{error}</p>}
    </div>
  );
}
