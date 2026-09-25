import Link from "next/link";
import { requireAdminSession } from "@/lib/authorize";
import { getAdultLeaderRoster } from "@/lib/adultLeaderAttendanceData";
import { ADULT_LEADER_SECTIONS, ADULT_LEADER_SECTION_LABELS, formatPositions } from "@/lib/adultLeaderSections";
import {
  createAdultLeaderAction,
  updateAdultLeaderAction,
  setAdultLeaderActiveAction,
} from "@/lib/actions/adultLeaders";
import DeleteAdultLeaderButton from "@/components/DeleteAdultLeaderButton";
import type { AdultLeaderSection } from "@/generated/prisma/enums";

/** Name / positions / section inputs, shared by the Add form and each row's Edit popover. */
function LeaderFields({
  idPrefix,
  leader,
}: {
  idPrefix: string;
  leader?: { name: string; positions: string[]; section: AdultLeaderSection };
}) {
  return (
    <>
      <div className="form-field">
        <label htmlFor={`${idPrefix}-name`}>Name</label>
        <input
          id={`${idPrefix}-name`}
          name="name"
          required
          maxLength={100}
          defaultValue={leader?.name}
          placeholder="e.g. Jane Smith"
        />
      </div>
      <div className="form-field">
        <label htmlFor={`${idPrefix}-positions`}>Positions</label>
        <input
          id={`${idPrefix}-positions`}
          name="positions"
          defaultValue={leader?.positions.join(", ")}
          placeholder="e.g. Tiger Den Leader"
        />
        <p className="form-note">Separate more than one with commas — e.g. Cubmaster, Arrow of Light Den Leader.</p>
      </div>
      <div className="form-field">
        <label htmlFor={`${idPrefix}-section`}>Section</label>
        <select id={`${idPrefix}-section`} name="section" defaultValue={leader?.section ?? "LEADERS"}>
          {ADULT_LEADER_SECTIONS.map((section) => (
            <option key={section} value={section}>
              {ADULT_LEADER_SECTION_LABELS[section]}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}

export default async function ManageAdultLeadersPage() {
  await requireAdminSession();
  const roster = await getAdultLeaderRoster();
  const removed = roster.filter((l) => !l.active);

  return (
    <>
      <div className="section-head">
        <div className="eyebrow">
          <Link href="/portal/admin/attendance/leaders">← Leaders &amp; Committee</Link>
        </div>
        <h2>Manage Leaders &amp; Committee</h2>
        <p>
          Who&apos;s on the leader &amp; committee attendance tracker. Someone who holds more than one position is
          listed once with all of them, so their attendance is taken once per meeting.
        </p>
      </div>

      <div className="info-card" style={{ maxWidth: 480, marginBottom: 24 }}>
        <h3>Add Someone</h3>
        <form action={createAdultLeaderAction}>
          <LeaderFields idPrefix="new" />
          <button type="submit" className="btn btn-primary">
            Add to List
          </button>
        </form>
      </div>

      {ADULT_LEADER_SECTIONS.map((section) => {
        const people = roster.filter((l) => l.active && l.section === section);
        return (
          <div className="attendance-group" key={section}>
            <div className="attendance-group-head">
              <h3 style={{ marginBottom: 0 }}>{ADULT_LEADER_SECTION_LABELS[section]}</h3>
              <span className="progress-pill">
                {people.length} {people.length === 1 ? "person" : "people"}
              </span>
            </div>
            <div className="attendance-card">
              {people.length === 0 && <p style={{ padding: "12px 0" }}>Nobody in this section yet.</p>}
              {people.map((leader) => (
                <div className="attendance-row" key={leader.id}>
                  <div>
                    <span className="attendance-name">{leader.name}</span>
                    {leader.positions.length > 0 && (
                      <span className="attendance-detail">{formatPositions(leader.positions)}</span>
                    )}
                  </div>
                  <div className="attendance-buttons">
                    <details className="edit-popover">
                      <summary className="btn btn-quiet btn-small" style={{ display: "inline-block", cursor: "pointer" }}>
                        Edit
                      </summary>
                      <form action={updateAdultLeaderAction}>
                        <input type="hidden" name="id" value={leader.id} />
                        <LeaderFields idPrefix={`leader-${leader.id}`} leader={leader} />
                        <button type="submit" className="btn btn-primary btn-small">
                          Save Changes
                        </button>
                      </form>
                    </details>
                    <form action={setAdultLeaderActiveAction}>
                      <input type="hidden" name="id" value={leader.id} />
                      <input type="hidden" name="active" value="false" />
                      <button type="submit" className="btn btn-quiet btn-small">
                        Remove
                      </button>
                    </form>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {removed.length > 0 && (
        <div className="attendance-group">
          <div className="attendance-group-head">
            <h3 style={{ marginBottom: 0 }}>Removed</h3>
          </div>
          <p className="form-note" style={{ marginTop: 0, marginBottom: 12 }}>
            Off the tracker going forward, but still shown on the meetings they were already marked for.
          </p>
          <div className="attendance-card">
            {removed.map((leader) => (
              <div className="attendance-row" key={leader.id}>
                <div>
                  <span className="attendance-name">{leader.name}</span>
                  <span className="attendance-detail">
                    {leader.positions.length > 0 && `${formatPositions(leader.positions)} — `}
                    {leader._count.attendances} attendance mark{leader._count.attendances === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="attendance-buttons">
                  <form action={setAdultLeaderActiveAction}>
                    <input type="hidden" name="id" value={leader.id} />
                    <input type="hidden" name="active" value="true" />
                    <button type="submit" className="btn btn-quiet btn-small">
                      Restore
                    </button>
                  </form>
                  <DeleteAdultLeaderButton
                    adultLeaderId={leader.id}
                    name={leader.name}
                    markCount={leader._count.attendances}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
