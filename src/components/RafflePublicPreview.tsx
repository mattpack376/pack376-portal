"use client";

import { useState } from "react";

/*
 * The design preview of a public 50/50 raffle page (/raffle-preview). It is a
 * mock: the board is a fixed sample, and picking boxes and sending a request
 * only change what this page shows — nothing is saved, sent or reserved. It
 * exists so the layout can be judged on a real phone before a live version is
 * built on the portal's raffle data.
 *
 * The sample is the October 2026 board with no names: the 16 boxes that were
 * never sold, and the 11 that were promised but not yet paid partway through
 * the sale.
 */

const PRICE = 10;
const TOTAL = 100;
const WINNER = 28;
const NEVER_SOLD = [30, 34, 39, 59, 62, 64, 68, 70, 74, 89, 90, 91, 92, 93, 96, 97];
const PROMISED = [3, 9, 15, 22, 27, 32, 69, 73, 76, 83, 94];

type Status = "open" | "picked" | "hold" | "sold" | "unsold" | "winner";

const STATUS_SAYS: Record<Status, string> = {
  open: "open, tap to pick",
  picked: "picked, tap to put back",
  hold: "on hold",
  sold: "sold",
  unsold: "not sold",
  winner: "the winning box",
};

const money = (dollars: number) => `$${dollars.toLocaleString("en-US")}`;
const listed = (numbers: number[]) =>
  numbers.length < 2 ? numbers.join("") : `${numbers.slice(0, -1).join(", ")} and ${numbers[numbers.length - 1]}`;

type Sent = { boxes: number[]; buyer: string; pay: "cash" | "zelle" };

export default function RafflePublicPreview({ drawn }: { drawn: boolean }) {
  const [picked, setPicked] = useState<number[]>([]);
  const [held, setHeld] = useState<number[]>([]);
  const [buyer, setBuyer] = useState("");
  const [contact, setContact] = useState("");
  const [pay, setPay] = useState<"cash" | "zelle">("cash");
  const [sent, setSent] = useState<Sent | null>(null);

  function statusOf(number: number): Status {
    if (drawn) return number === WINNER ? "winner" : NEVER_SOLD.includes(number) ? "unsold" : "sold";
    if (picked.includes(number)) return "picked";
    if (held.includes(number) || PROMISED.includes(number)) return "hold";
    return NEVER_SOLD.includes(number) ? "open" : "sold";
  }

  function toggle(number: number) {
    setPicked((current) =>
      current.includes(number) ? current.filter((n) => n !== number) : [...current, number].sort((a, b) => a - b)
    );
  }

  const left = NEVER_SOLD.filter((number) => !held.includes(number)).length;
  const pot = (TOTAL - left) * PRICE;
  const stats = drawn
    ? [
        { label: "Winning box", value: String(WINNER), note: "Drawn October 10, 2026" },
        { label: "Boxes sold", value: "84", note: "Of 100. 16 were not sold" },
        { label: "Final pot", value: "$840", note: "84 boxes at $10" },
        { label: "Raised for the pack", value: "$420", note: "The other half of the pot" },
      ]
    : [
        { label: "Price per box", value: money(PRICE), note: "Cash or Zelle" },
        { label: "Boxes left", value: String(left), note: `Of ${TOTAL}, open right now` },
        { label: "Pot so far", value: money(pot), note: "Grows with every box" },
        { label: "Winner gets", value: money(pot / 2), note: "Half the pot" },
      ];

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
          {drawn && (
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
                <div className="rp-winner-title">Box {WINNER} won $420</div>
                <p>Drawn Saturday, October 10, 2026. The winner has been paid. Thank you to everyone who took a box.</p>
              </div>
            </div>
          )}

          <div className="rp-stats">
            {stats.map((stat) => (
              <div className="rp-stat" key={stat.label}>
                <div className="rp-stat-label">{stat.label}</div>
                <div className="rp-stat-value">{stat.value}</div>
                <div className="rp-stat-note">{stat.note}</div>
              </div>
            ))}
          </div>

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
                {Array.from({ length: TOTAL }, (_, index) => {
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
                    <div className="rp-finals">
                      <div>
                        <span>Boxes sold</span>
                        <strong>84 of 100</strong>
                      </div>
                      <div>
                        <span>Final pot</span>
                        <strong>$840</strong>
                      </div>
                      <div>
                        <span>Winner&apos;s prize</span>
                        <strong>$420</strong>
                      </div>
                      <div>
                        <span>Raised for the pack</span>
                        <strong>$420</strong>
                      </div>
                    </div>
                    <p className="rp-fine">The next raffle will show up here when it opens.</p>
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
                        ? `Bring ${money(sent.boxes.length * PRICE)} in cash to the next pack meeting. A leader will mark your boxes paid.`
                        : `Send ${money(sent.boxes.length * PRICE)} by Zelle to the pack. A leader will mark your boxes paid once it arrives.`}
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
                          {picked.length} {picked.length === 1 ? "box" : "boxes"} · {money(picked.length * PRICE)}
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
              <p>Tap any open box. Each one is $10, and you can take as many as you like.</p>
            </div>
            <div className="info-card">
              <div className="rp-step-num">2</div>
              <h3>Pay a pack leader</h3>
              <p>Cash at a meeting, or Zelle. Your boxes stay on hold until then, and a leader marks them paid.</p>
            </div>
            <div className="info-card">
              <div className="rp-step-num">3</div>
              <h3>Watch the drawing</h3>
              <p>One box is drawn on drawing day. The winner takes half the pot. The other half goes to the pack.</p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
