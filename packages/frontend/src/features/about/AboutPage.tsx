/**
 * About — product-level goals page (public repo; owner-approved copy, verbatim).
 *
 * Simple, readable page in the app's existing page pattern/palette. No images,
 * no generated artwork, no new design language.
 */

const GOALS: { lead: string; body: string }[] = [
  {
    lead: "Collaborative by design.",
    body: "A 2026 app is operated; a 2027 app is inhabited. The people and agents who build and run this studio are present in it — named, roled, and visibly at work.",
  },
  {
    lead: "Agent-driven, manager-led.",
    body: "Specialized agents do scoped work. A manager coordinates them, verifies the experience end to end, and keeps the shared record true.",
  },
  {
    lead: "Traceability first.",
    body: "Logging and analytics are a first-class surface, not an afterthought — every channel visible, so consequences are planned for in advance instead of lived through.",
  },
  {
    lead: "Local-first, scoped by default.",
    body: "Data and models stay on the owner's hardware. Access is granted by name and by scope; untrusted strangers are rejected by default.",
  },
  {
    lead: "Honest surfaces.",
    body: "What the app knows, it shows. What it cannot do, it says plainly. Errors never show the plumbing.",
  },
  {
    lead: "Craft over churn.",
    body: "One auditable file for ports, one for logging. Small steps, verified before they are believed.",
  },
];

export function AboutPage() {
  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-6 pb-10">
      <div>
        <h1 className="text-2xl font-bold text-foreground">About Native Media AI Studio</h1>
        <p className="text-gray-400 mt-2 text-sm leading-relaxed">
          Native Media AI Studio is a local-first studio for creating music-driven media —
          designed, built, and run by a one-person company working with a team of AI agents.
          It has been in continuous development since 2025.
        </p>
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">
          Where this is going — the goals for 2027:
        </h2>
        <ul className="list-disc list-inside space-y-3 marker:text-purple-400">
          {GOALS.map((g) => (
            <li key={g.lead} className="text-sm text-gray-300 leading-relaxed pl-1">
              <span className="font-semibold text-foreground">{g.lead}</span>{" "}
              {g.body}
            </li>
          ))}
        </ul>
      </div>

      <p className="text-sm text-gray-400 border-t border-border pt-4">
        Built by Internext Ventures LLC.
      </p>
    </div>
  );
}