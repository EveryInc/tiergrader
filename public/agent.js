// Exposes the open page to AI agents: WebMCP tools on document.modelContext (navigator.modelContext in
// older Chrome builds), and the same functions on window.tiergrader for agents that can run JavaScript.

const json = (value) => JSON.stringify(value, null, 2);

export function registerAgentTools(ctrl) {
  const owner = ctrl.role === "owner";

  window.tiergrader = {
    getBoard: () => ctrl.getBoard(),
    readItem: (item) => ctrl.readItem(item),
    placeItems: (placements) => ctrl.placeItems(placements),
    view: (person) => ctrl.view(person),
    getResults: () => ctrl.getResults(),
    ...(owner ? { createLinks: (names) => ctrl.createLinks(names), addTextItems: (items) => ctrl.addTextItems(items) } : {}),
    help:
      "tiergrader page API. getBoard(); readItem(idOrNumber); placeItems([{item, tier, position?}]) with tier S/A/B/C/D/F/unranked; " +
      "view('me' | 'everyone' | name); getResults()" + (owner ? "; createLinks(['Kieran', 'Dan']); addTextItems([{title, text}])" : ""),
  };

  const tools = [
    {
      name: "tiergrader_get_board",
      description:
        "See the tier list on this page: what the collection is, whose ranking is shown, and which items are in each tier (S=4, A=3, B=2, C=1, D=0, F=-1 points) or still unranked. Call this first.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      execute: async () => json(ctrl.getBoard()),
    },
    {
      name: "tiergrader_read_item",
      description: "Read one item's full text (for markdown, text and HTML files) so you can judge it. Images, PDFs and other files return a link instead.",
      inputSchema: {
        type: "object",
        properties: { item: { type: "string", description: "The item's id, its number (e.g. \"3\"), or its exact title." } },
        required: ["item"],
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async ({ item }) => json(await ctrl.readItem(item)),
    },
    {
      name: "tiergrader_view",
      description: "Switch whose ranking the page shows: 'me' (your own, on a personal page), 'everyone' (the average), or a person's name.",
      inputSchema: { type: "object", properties: { person: { type: "string" } }, required: ["person"] },
      annotations: { readOnlyHint: true },
      execute: async ({ person }) => json(ctrl.view(person)),
    },
    {
      name: "tiergrader_get_results",
      description: "Every item's average score, rank and consensus tier, with each visible person's tier for it.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      execute: async () => json(ctrl.getResults()),
    },
  ];

  tools.push({
      name: "tiergrader_place_items",
      description:
        "Move items into tiers on this page's own ranking (the person's, or the owner's on an owner page). The cards move on screen and save immediately; they can drag them afterwards. Only rank when the person asked you to.",
      inputSchema: {
        type: "object",
        properties: {
          placements: {
            type: "array",
            description: "Applied in order.",
            items: {
              type: "object",
              properties: {
                item: { type: "string", description: "Item id, number, or exact title." },
                tier: { type: "string", enum: ["S", "A", "B", "C", "D", "F", "unranked"] },
                position: { type: "integer", description: "Optional 0-based place within the tier (0 = leftmost, the best). Default: the end." },
              },
              required: ["item", "tier"],
            },
          },
        },
        required: ["placements"],
      },
      execute: async ({ placements }) => json(ctrl.placeItems(placements)),
    });

  if (owner) {
    tools.push(
      {
        name: "tiergrader_create_links",
        description: "Make a personal ranking link for each name. Each person gets their own ranking. Send each person their own link.",
        inputSchema: { type: "object", properties: { names: { type: "array", items: { type: "string" } } }, required: ["names"] },
        execute: async ({ names }) => json(await ctrl.createLinks(names)),
      },
      {
        name: "tiergrader_add_text_items",
        description: "Add text or markdown items (cards) to this collection.",
        inputSchema: {
          type: "object",
          properties: {
            items: {
              type: "array",
              items: { type: "object", properties: { title: { type: "string" }, text: { type: "string" } }, required: ["text"] },
            },
          },
          required: ["items"],
        },
        execute: async ({ items }) => json(await ctrl.addTextItems(items)),
      },
    );
  }

  const mc = document.modelContext ?? navigator.modelContext;
  if (!mc?.registerTool) return;
  for (const tool of tools) {
    try {
      const pending = mc.registerTool(tool);
      pending?.catch?.((err) => console.warn(`WebMCP: couldn't register ${tool.name}`, err));
    } catch (err) {
      console.warn(`WebMCP: couldn't register ${tool.name}`, err);
    }
  }
}
