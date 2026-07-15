import { requireAdminSession } from "@/lib/authorize";
import { prisma } from "@/lib/prisma";
import { DEADLINE_CATEGORY_LABELS, formatDueDate } from "@/lib/deadlineCategories";
import {
  createAnnouncementAction,
  deleteAnnouncementAction,
  createDeadlineAction,
  deleteDeadlineAction,
  createVolunteerNeedAction,
  toggleVolunteerNeedAction,
  deleteVolunteerNeedAction,
} from "@/lib/actions/parentPortal";

export default async function ParentPortalAdminPage() {
  await requireAdminSession();

  const [announcements, deadlines, volunteerNeeds] = await Promise.all([
    prisma.announcement.findMany({ orderBy: [{ pinned: "desc" }, { createdAt: "desc" }] }),
    prisma.deadline.findMany({ orderBy: { dueDate: "asc" } }),
    prisma.volunteerNeed.findMany({ orderBy: { createdAt: "desc" } }),
  ]);

  return (
    <>
      <div className="section-head">
        <div className="eyebrow">Admin</div>
        <h2>Parent Portal Content</h2>
        <p>Announcements, deadlines, and volunteer needs shown on every family&apos;s Parent Dashboard.</p>
      </div>

      <div className="info-card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Announcements</h3>
        <form action={createAnnouncementAction} style={{ marginBottom: 20 }}>
          <div className="form-field">
            <label htmlFor="ann-title">Title</label>
            <input id="ann-title" name="title" required />
          </div>
          <div className="form-field">
            <label htmlFor="ann-body">Message</label>
            <textarea id="ann-body" name="body" rows={3} required />
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, fontSize: 14, fontWeight: 600 }}>
            <input type="checkbox" name="pinned" style={{ width: "auto" }} />
            Pin to top
          </label>
          <button type="submit" className="btn btn-primary">Post Announcement</button>
        </form>

        {announcements.length === 0 ? (
          <p style={{ marginBottom: 0 }}>No announcements yet.</p>
        ) : (
          announcements.map((a) => (
            <div key={a.id} style={{ background: "var(--cream)", borderRadius: 8, padding: "10px 14px", marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                <div>
                  <p style={{ marginBottom: 2, fontWeight: 700 }}>{a.pinned && "📌 "}{a.title}</p>
                  <p style={{ marginBottom: 0, fontSize: 14 }}>{a.body}</p>
                </div>
                <form action={deleteAnnouncementAction}>
                  <input type="hidden" name="id" value={a.id} />
                  <button type="submit" className="btn btn-outline btn-small" style={{ borderColor: "var(--carnival-red)", color: "var(--carnival-red)" }}>
                    Delete
                  </button>
                </form>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="info-card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Deadlines</h3>
        <form action={createDeadlineAction} style={{ marginBottom: 20 }}>
          <div className="form-field">
            <label htmlFor="dl-title">Title</label>
            <input id="dl-title" name="title" required />
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div className="form-field" style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="dl-category">Category</label>
              <select id="dl-category" name="category" defaultValue="GENERAL">
                {Object.entries(DEADLINE_CATEGORY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div className="form-field" style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="dl-dueDate">Due Date</label>
              <input id="dl-dueDate" name="dueDate" type="date" required />
            </div>
          </div>
          <div className="form-field">
            <label htmlFor="dl-description">Description (optional)</label>
            <textarea id="dl-description" name="description" rows={2} />
          </div>
          <button type="submit" className="btn btn-primary">Add Deadline</button>
        </form>

        {deadlines.length === 0 ? (
          <p style={{ marginBottom: 0 }}>No deadlines yet.</p>
        ) : (
          deadlines.map((d) => (
            <div key={d.id} style={{ background: "var(--cream)", borderRadius: 8, padding: "10px 14px", marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                <div>
                  <p className="form-note" style={{ marginBottom: 2 }}>{DEADLINE_CATEGORY_LABELS[d.category].toUpperCase()} · {formatDueDate(d.dueDate)}</p>
                  <p style={{ marginBottom: 0, fontWeight: 700 }}>{d.title}</p>
                  {d.description && <p style={{ marginBottom: 0, fontSize: 14 }}>{d.description}</p>}
                </div>
                <form action={deleteDeadlineAction}>
                  <input type="hidden" name="id" value={d.id} />
                  <button type="submit" className="btn btn-outline btn-small" style={{ borderColor: "var(--carnival-red)", color: "var(--carnival-red)" }}>
                    Delete
                  </button>
                </form>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="info-card">
        <h3 style={{ marginTop: 0 }}>Volunteer Needs</h3>
        <form action={createVolunteerNeedAction} style={{ marginBottom: 20 }}>
          <div className="form-field">
            <label htmlFor="vn-title">Title</label>
            <input id="vn-title" name="title" required placeholder="e.g. Pinewood Derby check-in table" />
          </div>
          <div className="form-field">
            <label htmlFor="vn-description">Description (optional)</label>
            <textarea id="vn-description" name="description" rows={2} />
          </div>
          <button type="submit" className="btn btn-primary">Post Volunteer Need</button>
        </form>

        {volunteerNeeds.length === 0 ? (
          <p style={{ marginBottom: 0 }}>No volunteer needs posted yet.</p>
        ) : (
          volunteerNeeds.map((v) => (
            <div key={v.id} style={{ background: "var(--cream)", borderRadius: 8, padding: "10px 14px", marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                <div>
                  <p style={{ marginBottom: 0, fontWeight: 700 }}>
                    {v.title}{" "}
                    <span className={`badge-pill ${v.active ? "badge-attendance" : "badge-pending"}`}>
                      {v.active ? "Open" : "Filled"}
                    </span>
                  </p>
                  {v.description && <p style={{ marginBottom: 0, fontSize: 14 }}>{v.description}</p>}
                </div>
                <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                  <form action={toggleVolunteerNeedAction}>
                    <input type="hidden" name="id" value={v.id} />
                    <input type="hidden" name="active" value={String(v.active)} />
                    <button type="submit" className="btn btn-outline btn-small" style={{ borderColor: "var(--scout-blue)", color: "var(--scout-blue)" }}>
                      Mark {v.active ? "Filled" : "Open"}
                    </button>
                  </form>
                  <form action={deleteVolunteerNeedAction}>
                    <input type="hidden" name="id" value={v.id} />
                    <button type="submit" className="btn btn-outline btn-small" style={{ borderColor: "var(--carnival-red)", color: "var(--carnival-red)" }}>
                      Delete
                    </button>
                  </form>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}
