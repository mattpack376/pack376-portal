"use client";

import { useState } from "react";

/*
 * Tabled along with its page (see src/app/raffle-preview/page.tsx): nothing
 * renders this while the page is switched off.
 *
 * The unlisted preview of a public 50/50 raffle page (/raffle-preview), drawn
 * from a real raffle's board. The page hands this component only what a
 * visitor may see: which box numbers are taken and whether they're paid for,
 * the price, the winner's share, the drawing date and the winning number. No
 * buyer names and no payment records ever reach the browser.
 *
 * What it shows is deliberately little: the board, the boxes you've picked,
 * how you'll pay, and one figure — what the prize stands at. No pot, no
 * count of boxes sold, nothing about what the pack takes in.
 *
 * Picking boxes and sending a request is still a mock: it changes only what
 * this page shows. Nothing is saved, sent or held on the real raffle.
 */

export type RafflePublicBoard = {
  boxCount: number;
  priceCents: number;
  prizePercent: number;
  /** "Saturday, October 10, 2026", or null when no date is set. */
  drawing: string | null;
  taken: { number: number; paid: boolean }[];
  winningBox: number | null;
  /** The prize as fixed at the drawing; null before it. */
  prizeCents: number | null;
  prizePaid: boolean;
};

type Status = "open" | "picked" | "hold" | "sold" | "unsold" | "winner";

const STATUS_SAYS: Record<Status, string> = {
  open: "open, tap to pick",
  picked: "picked, tap to put back",
  hold: "on hold",
  sold: "sold",
  unsold: "not sold",
  winner: "the winning box",
};

/** Whole dollars read as "$420", anything else as "$12.50". */
const money = (cents: number) =>
  cents % 100 === 0
    ? `$${(cents / 100).toLocaleString("en-US")}`
    : (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

const listed = (numbers: number[]) =>
  numbers.length < 2 ? numbers.join("") : `${numbers.slice(0, -1).join(", ")} and ${numbers[numbers.length - 1]}`;

type Sent = { boxes: number[]; buyer: string; pay: "cash" | "zelle" };

export default function RafflePublicPreview({ board, drawn }: { board: RafflePublicBoard; drawn: boolean }) {
  const [picked, setPicked] = useState<number[]>([]);
  const [held, setHeld] = useState<number[]>([]);
  const [buyer, setBuyer] = useState("");
  const [contact, setContact] = useState("");
  const [pay, setPay] = useState<"cash" | "zelle">("cash");
  const [sent, setSent] = useState<Sent | null>(null);

  const taken = new Map(board.taken.map((box) => [box.number, box]));

  function statusOf(number: number): Status {
    const box = taken.get(number);
    if (drawn) return number === board.winningBox ? "winner" : box ? "sold" : "unsold";
    if (box) return box.paid ? "sold" : "hold";
    if (held.includes(number)) return "hold";
    return picked.includes(number) ? "picked" : "open";
  }

  function toggle(number: number) {
    setPicked((current) =>
      current.includes(number) ? current.filter((n) => n !== number) : [...current, number].sort((a, b) => a - b)
    );
  }

  // The winner's share of every box taken so far, the requests made on this page included.
  const prizeNow = Math.round(((board.taken.length + held.length) * board.priceCents * board.prizePercent) / 100);

  const legend: { status: Status; text: string }[] = drawn
    ? [
        { status: "winner", text: "Winning box" },
        { status: "sold", text: "Sold" },
        { status: "unsold", text: "Not sold" },
      ]
    : [
        { status: "open", text: "Open" },
        { status: "picked", text: "Your pick" },
        { status: "hold", text: "On hold, not paid yet" },
        { status: "sold", text: "Sold" },
      ];

  const named = buyer.trim() !== "" && contact.trim() !== "";
  const cannotSend = picked.length === 0 || !named;
  const sendHint = picked.length === 0 ? "Pick at least one box first." : !named ? "Add your name and a phone or email." : "";

  function send(event: React.FormEvent) {
    event.preventDefault();
    if (cannotSend) return;
    setSent({ boxes: picked, buyer: buyer.trim(), pay });
    setHeld((current) => [...current, ...picked]);
    setPicked([]);
  }

  return (
    <>
      <section style={{ paddingTop: 40, paddingBottom: 24 }}>
        <div className="container">
          {drawn ? (
            <div className="rp-winner">
              <svg
                viewBox="0 0 24 24"
                width="48"
                height="48"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 3l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 16.9 6.6 19.8l1.1-6.1L3.2 9.4l6.1-.8z" />
              </svg>
              <div>
                <div className="rp-winner-title">
                  Box {board.winningBox} won {money(board.prizeCents ?? 0)}
                </div>
                <p>
                  {board.drawing ? `Drawn ${board.drawing}. ` : ""}
                  {board.prizePaid ? "The winner has been paid. " : ""}Thank you to everyone who took a box.
                </p>
              </div>
            </div>
          ) : (
            <div className="rp-prize" aria-live="polite">
              <div className="rp-prize-label">Total prize is now at</div>
              <div className="rp-prize-value">{money(prizeNow)}</div>
              <p>It grows every time a box is taken.</p>
            </div>
          )}

          <div className="rp-layout">
            <div className="rp-board-col">
              <h2>{drawn ? "The Final Board" : "Pick Your Boxes"}</h2>
              <p>
                {drawn
                  ? "Every box as it stood when the winner was drawn."
                  : "Open boxes are yours to take. Tap one to pick it, tap again to put it back."}
              </p>
              <div className="rp-legend" aria-hidden="true">
                {legend.map((key) => (
                  <span key={key.status}>
                    <span className={`rp-box rp-key is-${key.status}`} />
                    {key.text}
                  </span>
                ))}
              </div>
              <div className="rp-board">
                {Array.from({ length: board.boxCount }, (_, index) => {
                  const number = index + 1;
                  const status = statusOf(number);
                  const canTap = status === "open" || status === "picked";
                  return (
                    <button
                      key={number}
                      type="button"
                      className={`rp-box is-${status}`}
                      disabled={!canTap}
                      aria-pressed={canTap ? status === "picked" : undefined}
                      aria-label={`Box ${number}, ${STATUS_SAYS[status]}`}
                      onClick={() => toggle(number)}
                    >
                      {number}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rp-panel-col">
              <div className="info-card">
                {drawn ? (
                  <>
                    <h2>This Raffle Is Finished</h2>
                    <p style={{ marginBottom: 0 }}>The next raffle will show up here when it opens.</p>
                  </>
                ) : sent ? (
                  <div role="status">
                    <div className="rp-sent-mark">
                      <svg
                        viewBox="0 0 24 24"
                        width="28"
                        height="28"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M5 12.5l4.5 4.5L19 7.5" />
                      </svg>
                    </div>
                    <h2>Request Sent</h2>
                    <p style={{ color: "var(--ink)" }}>
                      {sent.boxes.length === 1 ? "Box" : "Boxes"} {listed(sent.boxes)} {sent.boxes.length === 1 ? "is" : "are"} on
                      hold for {sent.buyer}.
                    </p>
                    <p>
                      {sent.pay === "cash"
                        ? `Bring ${money(sent.boxes.length * board.priceCents)} in cash to the next pack meeting. A leader will mark your boxes paid.`
                        : `Send ${money(sent.boxes.length * board.priceCents)} by Zelle to the pack. A leader will mark your boxes paid once it arrives.`}
                    </p>
                    <button type="button" className="btn btn-quiet rp-wide" onClick={() => setSent(null)}>
                      Pick More Boxes
                    </button>
                  </div>
                ) : (
                  <>
                    <h2>Your Boxes</h2>
                    {picked.length === 0 ? (
                      <p>Tap any open box on the board to pick it. Take as many as you like.</p>
                    ) : (
                      <>
                        <div className="rp-chips">
                          {picked.map((number) => (
                            <button
                              key={number}
                              type="button"
                              className="rp-chip"
                              aria-label={`Put back box ${number}`}
                              onClick={() => toggle(number)}
                            >
                              {number}
                              <svg
                                viewBox="0 0 24 24"
                                width="16"
                                height="16"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="3"
                                strokeLinecap="round"
                                aria-hidden="true"
                              >
                                <path d="M6 6l12 12M18 6L6 18" />
                              </svg>
                            </button>
                          ))}
                        </div>
                        <p className="rp-total">
                          {picked.length} {picked.length === 1 ? "box" : "boxes"} · {money(picked.length * board.priceCents)}
                        </p>
                      </>
                    )}

                    <form onSubmit={send}>
                      <div className="form-field">
                        <label htmlFor="rp-buyer">Your name</label>
                        <input id="rp-buyer" value={buyer} onChange={(event) => setBuyer(event.target.value)} autoComplete="name" />
                      </div>
                      <div className="form-field">
                        <label htmlFor="rp-contact">Phone or email</label>
                        <input id="rp-contact" value={contact} onChange={(event) => setContact(event.target.value)} />
                      </div>
                      <fieldset className="rp-pay">
                        <legend>How will you pay?</legend>
                        <label>
                          <input type="radio" name="rp-pay" checked={pay === "cash"} onChange={() => setPay("cash")} />
                          Cash at a pack meeting
                        </label>
                        <label>
                          <input type="radio" name="rp-pay" checked={pay === "zelle"} onChange={() => setPay("zelle")} />
                          Zelle
                        </label>
                      </fieldset>
                      <button type="submit" className="btn btn-primary rp-wide" disabled={cannotSend}>
                        Request These Boxes
                      </button>
                    </form>
                    {sendHint && <p className="rp-hint">{sendHint}</p>}
                    <p className="rp-fine">
                      This holds your boxes for you. It isn&apos;t a purchase and nothing is charged on this page. A pack
                      leader confirms your boxes once you&apos;ve paid in cash or by Zelle.
                    </p>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section style={{ paddingTop: 24 }}>
        <div className="container">
          <h2>How It Works</h2>
          <div className="rp-steps">
            <div className="info-card">
              <div className="rp-step-num">1</div>
              <h3>Pick your boxes</h3>
              <p>Tap any open box. Take as many as you like.</p>
            </div>
            <div className="info-card">
              <div className="rp-step-num">2</div>
              <h3>Pay a pack leader</h3>
              <p>Cash at a meeting, or Zelle. Your boxes stay on hold until then, and a leader marks them paid.</p>
            </div>
            <div className="info-card">
              <div className="rp-step-num">3</div>
              <h3>Watch the drawing</h3>
              <p>One box is drawn on drawing day. Whoever holds it wins the prize.</p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
