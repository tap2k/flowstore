import type { Spec } from "@flowstore/core/schema/v0";

// A minimal valid spec for a brand-new project. The user picks a repo with
// no flowstore content; init writes this. Single welcome flow with one END exit so
// the spec is structurally complete and the canvas has something to render.
// Designer fills in everything else.
export function scaffoldNewProject(opts: { name: string; id?: string }): Spec {
  const id = opts.id ?? `agent_${slug(opts.name)}`;
  return {
    agent: {
      $schema: "flowstore://agent/v0",
      id,
      meta: {
        name: opts.name,
        purpose: "",
      },
      chatbot_initiates: true,
      entry_flow_id: "welcome",
    },
    flows: [
      {
        $schema: "flowstore://flow/v0",
        id: "welcome",
        name: "Welcome",
        type: "happy",
        instructions: "Greet the user and ask how you can help.",
        exit_paths: [
          {
            id: "xp_welcome_end",
            goto: "END",
            actions: [],
          },
        ],
      },
    ],
  };
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "new_agent";
}
