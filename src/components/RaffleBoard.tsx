"use client";

import Link from "next/link";
import { useActionState, useRef, useState, useTransition } from "react";
import { assignBoxesAction, changeEntryBoxesAction } from "@/lib/actions/raffles";
import { RAFFLE_METHODS, RAFFLE_METHOD_LABELS, formatRaffleMoney } from "@/lib/raffleMath";
import { MAX_NAME_LENGTH } from "@/lib/formValues";

export type RaffleBoardBox = { number: number; entryId: string; buyer: string; paid: boolean };
export type RaffleBoardBuyer = { id: string; name: string; boxNumbers: number[] };

type Props = {
  raffleId: string;
  boxCount: number;
  priceCents: number;
  boxes: RaffleBoardBox[];
  winningBox: number | null;
  /** Admin, on an open raffle whose winner isn't recorded yet. Everyone else gets the board to look at. */
  canAssign: boolean;
  /** Buyers already on this raffle with their boxes — to pick from, and so a typed name says "adding to…". */
  currentBuyers: RaffleBoardBuyer[];
  /** Everyone who has bought in any raffle, offered while typing. */
  buyerNames: string[];
  payerNames: string[];
};

type AssignState = { error?: string; saved: number };

/**
 * The numbered board. Tap open boxes to pick them, name the buyer, and they're
 * sold — with the payment recorded in the same step if the money changed
 * hands. Tapping a box that's taken shows whose it is and, for an Admin,
 * offers to take it away from them or to give them more.
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

/** Buyers a half-typed or slightly different name probably means — "Peter" when "Peter W." is on the board. */
function similarBuyers(typed: string, buyers: RaffleBoardBuyer[]) {
  if (typed.length < 2) return [];
  const firstWord = typed.split(/\s+/)[0];
  return buyers
    .filter((buyer) => {
      const name = buyer.name.trim().toLowerCase();
      return name.includes(typed) || typed.includes(name) || (firstWord.length >= 3 && name.split(/\s+/)[0] === firstWord);
    })
    .slice(0, 4);
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
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [isRemoving, startRemoving] = useTransition();
  const sellRef = useRef<HTMLDivElement>(null);

  const taken = new Map(boxes.map((box) => [box.number, box]));
  const columns = boxCount <= 30 ? 5 : 10;
  const focusedBox = focused === null ? undefined : taken.get(focused);

  // A box picked here can be sold by someone else before this form is sent;
  // the refreshed board then shows it taken, and it drops out of the picks.
  const picks = selected.filter((number) => !taken.has(number));

  const typed = name.trim().toLowerCase();
  const match = typed ? currentBuyers.find((buyer) => buyer.name.trim().toLowerCase() === typed) : undefined;
  const lookalikes = match ? [] : similarBuyers(typed, currentBuyers);
  const suggestions = [...new Set([...currentBuyers.map((buyer) => buyer.name), ...buyerNames])];

  function toggle(number: number) {
    setFocused(null);
    setRemoveError(null);
    setSelected((current) =>
      current.includes(number) ? current.filter((n) => n !== number) : [...current, number].sort((a, b) => a - b)
    );
  }

  /** Points the Sell Boxes form at someone already on the raffle, so the next boxes go on their line. */
  function sellTo(buyerName: string) {
    setName(buyerName);
    setFocused(null);
    sellRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function takeAway(box: RaffleBoardBox) {
    if (!window.confirm(`Take box ${box.number} away from ${box.buyer}? It will be open again.`)) return;
    startRemoving(async () => {
      const formData = new FormData();
      formData.set("entryId", box.entryId);
      formData.append("remove", String(box.number));
      const result = await changeEntryBoxesAction(formData);
      setRemoveError(result.error ?? null);
      if (!result.error) setFocused(null);
    });
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
                onClick={() => {
                  setRemoveError(null);
                  setFocused(focused === number ? null : number);
                }}
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
        <div className="raffle-focus" aria-live="polite">
          <p className="raffle-selection">
            Box {focusedBox.number}: {focusedBox.buyer} — {focusedBox.paid ? "paid" : "not paid yet"}.
          </p>
          {removeError && (
            <div className="form-error" role="alert">
              {removeError}
            </div>
          )}
          <div className="raffle-focus-actions">
            {canAssign && (
              <>
                <button type="button" className="btn btn-quiet btn-small" onClick={() => sellTo(focusedBox.buyer)}>
                  Add More Boxes to {focusedBox.buyer}
                </button>
                <button
                  type="button"
                  className="btn btn-danger btn-small"
                  disabled={isRemoving}
                  onClick={() => takeAway(focusedBox)}
                >
                  {isRemoving ? "Removing…" : `Take Box ${focusedBox.number} Away`}
                </button>
              </>
            )}
            <Link
              className="btn btn-quiet btn-small"
              href={`/portal/admin/raffles/${raffleId}?tab=buyers&q=${focusedBox.number}`}
            >
              Open This Buyer
            </Link>
          </div>
        </div>
      )}

      {canAssign && (
        <div className="info-card" ref={sellRef}>
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
          {/* The price shown above: a paid sale is refused if the raffle's price has changed since (assignBoxesAction). */}
          <input type="hidden" name="priceCents" value={priceCents} />
          {currentBuyers.length > 0 && (
            <div className="form-field">
              <label htmlFor="board-existing">Already on this raffle?</label>
              {/*
               * A picker, not a field: it has no name, always shows its
               * prompt, and only fills in the Buyer box below. Being pinned
               * to "" also keeps it clear of React's reset of a submitted
               * form, which re-selects a controlled select's first option.
               */}
              <select id="board-existing" value="" onChange={(event) => event.target.value && sellTo(event.target.value)}>
                <option value="">Pick them to add boxes to their line…</option>
                {currentBuyers.map((buyer) => (
                  <option key={buyer.id} value={buyer.name}>
                    {buyer.name} — {buyer.boxNumbers.length === 1 ? "box" : "boxes"} {buyer.boxNumbers.join(", ")}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="form-row">
            <div className="form-field">
              <label htmlFor="board-name">Buyer</label>
              <input
                id="board-name"
                name="name"
                list="board-buyer-names"
                autoComplete="off"
                required
                maxLength={MAX_NAME_LENGTH}
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
                maxLength={MAX_NAME_LENGTH}
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
            <div style={{ marginBottom: 14 }}>
              <p className="form-note" style={{ marginTop: 0, marginBottom: lookalikes.length > 0 ? 8 : 0 }}>
                {match
                  ? `Adding to ${match.name}'s line — they already have ${match.boxNumbers.length === 1 ? "box" : "boxes"} ${match.boxNumbers.join(", ")}. A different person with the same name? Add a last name or initial to tell them apart.`
                  : lookalikes.length > 0
                    ? "This will start a new line. If you meant someone already on the raffle, tap their name:"
                    : "New buyer — this starts a new line."}
              </p>
              {lookalikes.length > 0 && (
                <div className="raffle-focus-actions">
                  {lookalikes.map((buyer) => (
                    <button key={buyer.id} type="button" className="btn btn-quiet btn-small" onClick={() => sellTo(buyer.name)}>
                      {buyer.name} ({buyer.boxNumbers.join(", ")})
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button type="submit" className="btn btn-primary" disabled={pending || picks.length === 0 || !typed}>
            {pending ? "Saving…" : picks.length > 1 ? `Sell ${picks.length} Boxes` : "Sell Box"}
          </button>
        </div>
      )}
    </>
  );
}
