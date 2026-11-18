import type { RequirementNode } from "@/lib/requirementProgress";
import type { PublicAdventure } from "@/lib/rankRequirementsData";

/*
 * The full adventure list for one rank on the public Rank Requirements page:
 * one collapsed section for the rank, and inside it one collapsed section per
 * adventure with its official requirements. Plain <details>, so it works
 * without JavaScript and stays short until someone opens it.
 */
export default function RankAdventureRequirements({
  rankName,
  adventures,
}: {
  rankName: string;
  adventures: PublicAdventure[];
}) {
  if (adventures.length === 0) return null;
  const required = adventures.filter((a) => a.type === "REQUIRED");
  const electives = adventures.filter((a) => a.type === "ELECTIVE");

  return (
    <details className="rank-adv">
      <summary className="rank-adv-summary">
        See every {rankName} adventure&apos;s requirements ({required.length} required, {electives.length} elective)
      </summary>
      <div className="rank-adv-body">
        {required.length > 0 && <AdventureGroup label="Required Adventures" adventures={required} />}
        {electives.length > 0 && <AdventureGroup label="Elective Adventures" adventures={electives} />}
      </div>
    </details>
  );
}

function AdventureGroup({ label, adventures }: { label: string; adventures: PublicAdventure[] }) {
  return (
    <>
      <div className="rank-adv-group">{label}</div>
      {adventures.map((adventure) => (
        <details className="rank-adv-item" key={adventure.id}>
          <summary>
            <span className="rank-adv-name">{adventure.name}</span>
            {adventure.requirements.length > 0 && (
              <span className="rank-adv-count">
                {adventure.requirements.length} requirement{adventure.requirements.length === 1 ? "" : "s"}
              </span>
            )}
          </summary>
          <div className="rank-adv-reqs">
            {adventure.note && <p className="rank-adv-note">{adventure.note}</p>}
            {adventure.requirementsNote && <p className="rank-adv-note">{adventure.requirementsNote}</p>}
            {adventure.requirementsPick !== null && adventure.requirementsPick < adventure.requirements.length && (
              <p className="rank-adv-note">
                Complete any {adventure.requirementsPick} of these {adventure.requirements.length}.
              </p>
            )}
            {adventure.requirements.length > 0 ? (
              <RequirementList nodes={adventure.requirements} />
            ) : (
              <p className="rank-adv-note">Ask your den leader for this adventure&apos;s requirements.</p>
            )}
          </div>
        </details>
      ))}
    </>
  );
}

function RequirementList({ nodes }: { nodes: RequirementNode[] }) {
  return (
    <ol className="rank-adv-list">
      {nodes.map((node) => (
        <li key={node.id}>
          <span className="rank-adv-code">{node.code}.</span> {node.text}
          {node.pick !== null && node.pick < node.children.length && (
            <span className="rank-adv-pick">
              {" "}
              (any {node.pick} of {node.children.length})
            </span>
          )}
          {node.children.length > 0 && <RequirementList nodes={node.children} />}
        </li>
      ))}
    </ol>
  );
}
