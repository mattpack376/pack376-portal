import Link from "next/link";
import { notFound } from "next/navigation";
import { isMasterAdminSession, requireRafflesViewSession } from "@/lib/authorize";
import { getPayerHistory, getRaffleDetail, getRaffleNameSuggestions } from "@/lib/raffleData";
import { formatCents } from "@/lib/duesData";
import { formatLongDate, todayDateOnlyString } from "@/lib/dateOnly";
import { reopenRaffleAction } from "@/lib/actions/raffles";
import ConfirmSubmitButton from "@/components/ConfirmSubmitButton";
import RaffleBoard from "@/components/RaffleBoard";
import SegmentedNav from "@/components/SegmentedNav";
import BuyersTab from "./BuyersTab";
import CloseoutTab from "./CloseoutTab";
import PaymentsTab from "./PaymentsTab";

const TABS = [
  { key: "board", label: "Board" },
  { key: "buyers", label: "Buyers" },
  { key: "payments", label: "Payments" },
  { key: "closeout", label: "Drawing & Close-Out" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default async function AdminRafflePage({
  params,
  searchParams,
}: {
  params: Promise<{ raffleId: string }>;
  searchParams: Promise<{ tab?: string; q?: string }>;
}) {
  // Junior Admin sees the board, the buyers and every total; the forms are Admin-only.
  const session = await requireRafflesViewSession();
  const isAdmin = session.role === "ADMIN";
  const { raffleId } = await params;
  const { tab: requestedTab, q } = await searchParams;

  const raffle = await getRaffleDetail(raffleId);
  if (!raffle) notFound();

  const tab: TabKey = TABS.find((t) => t.key === requestedTab)?.key ?? "board";
  const isOpen = raffle.status === "OPEN";
  const canEdit = isAdmin && isOpen;
  const boardLocked = raffle.winningBox !== null;
  const s = raffle.summary;
  const base = `/portal/admin/raffles/${raffle.id}`;
  const today = todayDateOnlyString();

  // Suggestions only feed the forms, so a read-only view skips the queries.
  const names = canEdit ? await getRaffleNameSuggestions() : { buyerNames: [], payerNames: [] };

  return (
    <>
      <div className="page-head" style={{ marginBottom: 24 }}>
        <div>
          <div className="eyebrow">
            <Link href="/portal/admin/raffles">← 50/50 Raffles</Link>
          </div>
          <h2>{raffle.name}</h2>
          <p style={{ fontSize: 17 }}>
            {raffle.drawingDate ? `Drawing ${formatLongDate(raffle.drawingDate)}` : "Drawing date not set"} · {raffle.boxCount} boxes at{" "}
            {formatCents(raffle.priceCents)} · Winner gets {raffle.prizePercent}%
          </p>
          {raffle.notes && <p style={{ fontSize: 16 }}>{raffle.notes}</p>}
          <span className={`badge-pill ${isOpen ? "badge-attendance" : "badge-pending"}`}>{isOpen ? "Open" : "Closed"}</span>
        </div>
        {isAdmin && !isOpen && (
          <form action={reopenRaffleAction}>
            <input type="hidden" name="raffleId" value={raffle.id} />
            <ConfirmSubmitButton
              className="btn btn-quiet btn-small"
              pendingLabel="Reopening…"
              message={`Reopen “${raffle.name}”? It moves back to Open Raffles and can be changed again.`}
            >
              Reopen Raffle
            </ConfirmSubmitButton>
          </form>
        )}
      </div>

      {!isOpen && (
        <div className="form-success">
          This raffle is closed, so it&apos;s a read-only record.{isAdmin && " Reopen it to change anything."}
        </div>
      )}

      <div className="raffle-stats">
        <div className="raffle-stat">
          <div className="raffle-stat-label">Boxes Sold</div>
          <div className="raffle-stat-value">
            {s.soldBoxes} of {s.boxCount}
          </div>
          <div className="raffle-stat-note">{s.availableBoxes === 0 ? "Sold out" : `${s.availableBoxes} still open`}</div>
        </div>
        <div className="raffle-stat">
          <div className="raffle-stat-label">Collected</div>
          <div className="raffle-stat-value">{formatCents(s.collectedCents)}</div>
          <div className={`raffle-stat-note${s.outstandingCents > 0 ? " balance-negative" : ""}`}>
            {s.outstandingCents > 0
              ? `${formatCents(s.outstandingCents)} still owed`
              : s.soldBoxes === 0
                ? "Nothing sold yet"
                : "Everyone has paid"}
          </div>
        </div>
        <div className="raffle-stat">
          <div className="raffle-stat-label">{s.prizeIsFinal ? "Prize" : "Prize So Far"}</div>
          <div className="raffle-stat-value">{formatCents(s.prizeCents)}</div>
          <div className="raffle-stat-note">
            {s.prizeIsFinal
              ? `Box ${raffle.winningBox} · ${raffle.winnerName} · ${raffle.prizePaid ? "paid" : "not paid yet"}`
              : `${raffle.prizePercent}% of boxes sold`}
          </div>
        </div>
        <div className="raffle-stat">
          <div className="raffle-stat-label">Pack Keeps</div>
          <div className="raffle-stat-value">{formatCents(s.packShareCents)}</div>
          <div className="raffle-stat-note">
            {s.outstandingCents > 0 ? `${formatCents(s.netCents)} in hand after the prize` : "After the prize"}
          </div>
        </div>
      </div>

      <SegmentedNav
        active={tab}
        items={TABS.map((t) => ({ key: t.key, label: t.label, href: t.key === "board" ? base : `${base}?tab=${t.key}` }))}
      />

      {tab === "board" && (
        <>
          {isAdmin && isOpen && boardLocked && (
            <p className="form-note" style={{ marginTop: 0, marginBottom: 14, fontSize: 14 }}>
              The winner is recorded, so the board is locked. Payments can still be recorded on the Buyers and
              Payments tabs.
            </p>
          )}
          <RaffleBoard
            raffleId={raffle.id}
            boxCount={raffle.boxCount}
            priceCents={raffle.priceCents}
            boxes={raffle.entries.flatMap((entry) =>
              entry.boxNumbers.map((number) => ({ number, buyer: entry.name, paid: entry.remainingCents <= 0 }))
            )}
            winningBox={raffle.winningBox}
            canAssign={canEdit && !boardLocked}
            currentBuyers={raffle.entries.map((entry) => ({ name: entry.name, boxNumbers: entry.boxNumbers }))}
            buyerNames={names.buyerNames}
            payerNames={names.payerNames}
          />
        </>
      )}

      {tab === "buyers" && (
        <BuyersTab
          raffle={raffle}
          canEdit={canEdit}
          boardLocked={boardLocked}
          query={q ?? ""}
          today={today}
          buyerNames={names.buyerNames}
          payerNames={names.payerNames}
        />
      )}

      {tab === "payments" && (
        <PaymentsTab
          raffle={raffle}
          canEdit={canEdit}
          today={today}
          payerNames={names.payerNames}
          payerHistory={await getPayerHistory(
            raffle.payments.flatMap((payment) => (!payment.voidedAt && !payment.entryId && payment.payerName ? [payment.payerName] : []))
          )}
        />
      )}

      {tab === "closeout" && (
        <CloseoutTab raffle={raffle} isAdmin={isAdmin} isMasterAdmin={await isMasterAdminSession(session)} today={today} />
      )}
    </>
  );
}
