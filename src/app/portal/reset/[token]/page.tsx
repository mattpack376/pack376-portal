import Image from "next/image";
import { resetLinkStatus } from "@/lib/resetTokens";
import SetPasswordForm, { DeadLinkNotice } from "@/components/SetPasswordForm";

export default async function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // Read-only: looking at the page never spends the link.
  const status = await resetLinkStatus(token);

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="brand">
          <Image src="/cub-scout-emblem.png" alt="Pack 376 Cub Scouts emblem" width={48} height={48} />
          <span className="brand-text">
            <span className="pack-name">Pack 376</span>
          </span>
        </div>
        {/* Each view brings its own heading: the form's changes with it if a
            submit finds the link dead, to the same view a dead link gets here. */}
        {status === "usable" ? <SetPasswordForm token={token} /> : <DeadLinkNotice reason={status} />}
      </div>
    </div>
  );
}
