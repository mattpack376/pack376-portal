"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { assignBoxesAction } from "@/lib/actions/raffles";
import { RAFFLE_METHODS, RAFFLE_METHOD_LABELS, formatRaffleMoney } from "@/lib/raffleMath";

export type RaffleBoardBox = { number: number; buyer: string; paid: boolean };

type Props = {
  raffleId: string;
  boxCount: number;
  priceCents: number;
  boxes: RaffleBoardBox[];
  winningBox: number | null;
  /** Admin, on an open raffle whose winner isn't recorded yet. Everyone else gets the board to look at. */
  canAssign: boolean;
  /** Buyers already on this raffle with their boxes, so typing one of their names says "adding to…". */
  currentBuyers: { name: string; boxNumbers: number[] }[];
  /** Everyone who has bought in any raffle, offered while typing. */
  buyerNames: string[];
  payerNames: string[];
};

type AssignState = { error?: string; saved: number };

/**
 * The numbered board. Tap open boxes to pick them, name the buyer, and they're
 * sold — with the payment recorded in the same step if the money changed
 * hands. Tapping a box that's taken shows whose it is.
 */
export default function RaffleBoard(props: Props) {
  const [state, formAction, pending] = useActionState(
    async (previous: AssignState, formData: FormData): Promise<AssignState> => {
      const result = await assignBoxesAction(formData);
      return result.error ? { error: result.error, saved: previous.saved } : { saved: previous.saved + 1 };
    },
    { saved: 0 }
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="raffleId" value={props.raffleId} />
      {/*
       * A new key after each sale remounts the board's own state, which is
       * what clears the picked boxes and the name for the next buyer. A
       * refusal keeps the key, so the picks stay to be corrected.
       */}
      <BoardFields key={state.saved} {...props} error={state.error} pending={pending} />
    </form>
  );
}

function BoardFields({
  raffleId,
  boxCount,
  priceCents,
  boxes,
  winningBox,
  canAssign,
  currentBuyers,
  buyerNames,
  payerNames,
  error,
  pending,
}: Props & { error?: string; pending: boolean }) {
  const [selected, setSelected] = useState<number[]>([]);
  const [focused, setFocused] = useState<number | null>(null);
  const [name, setName] = useState("");

  const taken = new Map(boxes.map((box) => [box.number, box]));
  const columns = boxCount <= 30 ? 5 : 10;
  const focusedBox = focused === null ? undefined : taken.get(focused);

  // A box picked here can be sold by someone else before this form is sent;
  // the refreshed board then shows it taken, and it drops out of the picks.
  const picks = selected.filter((number) => !taken.has(number));

  const typed = name.trim().toLowerCase();
  const match = typed ? currentBuyers.find((buyer) => buyer.name.trim().toLowerCase() === typed) : undefined;
  const suggestions = [...new Set([...currentBuyers.map((buyer) => buyer.name), ...buyerNames])];

  function toggle(number: number) {
    setFocused(null);
    setSelected((current) =>
      current.includes(number) ? current.filter((n) => n !== number) : [...current, number].sort((a, b) => a - b)
    );
  }

  return (
    <>
      <div className="raffle-board" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {Array.from({ length: boxCount }, (_, index) => {
          const number = index + 1;
          const box = taken.get(number);
          const winner = number === winningBox ? " is-winner" : "";

          if (box) {
            return (
              <button
                key={number}
                type="button"
                className={`raffle-box ${box.paid ? "is-paid" : "is-owes"}${winner}${focused === number ? " is-focused" : ""}`}
                aria-label={`Box ${number}, ${box.buyer}, ${box.paid ? "paid" : "not paid yet"}${winner ? ", winning box" : ""}`}
                onClick={() => setFocused(focused === number ? null : number)}
              >
                {number}
              </button>
            );
          }
          if (!canAssign) {
            return (
              <span key={number} className="raffle-box" aria-label={`Box ${number}, available`}>
                {number}
              </span>
            );
          }
          const isPicked = picks.includes(number);
          return (
            <button
              key={number}
              type="button"
              className={`raffle-box${isPicked ? " is-selected" : ""}`}
              aria-pressed={isPicked}
              aria-label={`Box ${number}, available${isPicked ? ", picked" : ""}`}
              onClick={() => toggle(number)}
            >
              {number}
            </button>
          );
        })}
      </div>

      <div className="raffle-legend" aria-hidden="true">
        <span>
          <span className="raffle-box" /> Available
        </span>
        <span>
          <span className="raffle-box is-owes" /> Taken, not paid yet
        </span>
        <span>
          <span className="raffle-box is-paid" /> Paid
        </span>
        {canAssign && (
          <span>
            <span className="raffle-box is-selected" /> Picked
          </span>
        )}
        {winningBox !== null && (
          <span>
            <span className="raffle-box is-winner" /> Winning box
          </span>
        )}
      </div>

      {focusedBox && (
        <p className="raffle-selection" aria-live="polite">
          Box {focusedBox.number}: {focusedBox.buyer} — {focusedBox.paid ? "paid" : "not paid yet"}.{" "}
          <Link className="text-link" href={`/portal/admin/raffles/${raffleId}?tab=buyers&q=${focusedBox.number}`}>
            Open this buyer →
          </Link>
        </p>
      )}

      {canAssign && (
        <div className="info-card">
          <h3>Sell Boxes</h3>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <p className="raffle-selection" aria-live="polite">
            {picks.length === 0
              ? "Tap the open boxes above to pick them."
              : `Picked: ${picks.join(", ")} — ${picks.length} × ${formatRaffleMoney(priceCents)} = ${formatRaffleMoney(picks.length * priceCents)}`}
          </p>
          <input type="hidden" name="boxes" value={picks.join(",")} />
          <div className="form-row">
            <div className="form-field">
              <label htmlFor="board-name">Buyer</label>
              <input
                id="board-name"
                name="name"
                list="board-buyer-names"
                autoComplete="off"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Name"
              />
              <datalist id="board-buyer-names">
                {suggestions.map((suggestion) => (
                  <option key={suggestion} value={suggestion} />
                ))}
              </datalist>
            </div>
            <div className="form-field">
              <label htmlFor="board-paid">Paid?</label>
              <select id="board-paid" name="paid" defaultValue="">
                <option value="">Not yet — owes it</option>
                {RAFFLE_METHODS.map((method) => (
                  <option key={method} value={method}>
                    Yes — {RAFFLE_METHOD_LABELS[method]}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="board-payer">Paid by someone else? (optional)</label>
              <input
                id="board-payer"
                name="payerName"
                list="board-payer-names"
                autoComplete="off"
                placeholder="Name on the Zelle"
              />
              <datalist id="board-payer-names">
                {payerNames.map((payer) => (
                  <option key={payer} value={payer} />
                ))}
              </datalist>
            </div>
          </div>
          {typed && (
            <p className="form-note" style={{ marginTop: 0, marginBottom: 14 }}>
              {match
                ? `Adding to ${match.name}, who already has ${match.boxNumbers.length === 1 ? "box" : "boxes"} ${match.boxNumbers.join(", ")}.`
                : "New buyer on this raffle."}
            </p>
          )}
          <button type="submit" className="btn btn-primary" disabled={pending || picks.length === 0 || !typed}>
            {pending ? "Saving…" : picks.length > 1 ? `Sell ${picks.length} Boxes` : "Sell Box"}
          </button>
        </div>
      )}
    </>
  );
}
