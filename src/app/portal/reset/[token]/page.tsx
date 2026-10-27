import Image from "next/image";
import { resetLinkStatus } from "@/lib/resetTokens";
import SetPasswordForm from "@/components/SetPasswordForm";

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
        <h1>{status === "usable" ? "Set Your Password" : status === "inactive" ? "Account Inactive" : "Link Invalid"}</h1>

        {status === "usable" ? (
          <>
            <p className="sub">Choose a password for your Pack 376 Portal account.</p>
            <SetPasswordForm token={token} />
          </>
        ) : status === "inactive" ? (
          <div className="form-error" role="alert">
            This account is inactive. Ask an admin to make it active again, then request a new link.
          </div>
        ) : (
          <div className="form-error" role="alert">
            This link is invalid, expired, or has already been used. Ask an admin to send you a new one.
          </div>
        )}
      </div>
    </div>
  );
}
