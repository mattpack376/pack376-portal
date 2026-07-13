import Image from "next/image";
import { peekResetToken } from "@/lib/resetTokens";
import SetPasswordForm from "@/components/SetPasswordForm";

export default async function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const valid = await peekResetToken(token);

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="brand">
          <Image src="/cub-scout-emblem.png" alt="Pack 376 Cub Scouts emblem" width={48} height={48} />
          <span className="brand-text">
            <span className="pack-name">Pack 376</span>
          </span>
        </div>
        <h1>{valid ? "Set Your Password" : "Link Invalid"}</h1>

        {valid ? (
          <>
            <p className="sub">Choose a password for your Pack 376 Portal account.</p>
            <SetPasswordForm token={token} />
          </>
        ) : (
          <div className="form-error">
            This link is invalid, expired, or has already been used. Ask an admin to send you a new one.
          </div>
        )}
      </div>
    </div>
  );
}
