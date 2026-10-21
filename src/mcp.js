// A minimal stateless MCP server (streamable HTTP, JSON responses) over the same operations as the
// REST API. There is no sign-in: tools take the owner or personal link, which is the credential.
import { httpError } from "./store.js";

const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const ownerArg = {
  owner: { type: "string", description: "The collection's owner link (https://.../o/<token>) or just the owner token." },
};
const raterArg = {
  person: { type: "string", description: "The person's personal link (https://.../r/<token>) or just the token." },
};
const TIER_ENUM = ["S", "A", "B", "C", "D", "F", "unsorted"];

const TOOLS = [
  {
    name: "request_agent_key",
    description:
      "Only when create_collection says it needs an agent key and you have none: ask for one on behalf of the person you work for. " +
      "Returns a key and an approve_url. Send the approve_url to your person (never ask them for a password); the key works once they approve. " +
      "Then call this server as /mcp with \"Authorization: Bearer <key>\" (or /mcp?key=<key>). Keep the key private.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Your name as your person knows you, e.g. 'Claude in Slack'. Shown on the approve page." } },
    },
  },
  {
    name: "create_collection",
    description: "Create a tiergrader collection. Returns the owner link (keep it private: it controls the collection), an open join link, and the owner token the other tools take.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "What is being ranked, e.g. 'Which AI-written intro is best?'" },
        description: { type: "string", description: "Optional: what raters should judge on. Shown to everyone." },
      },
      required: ["title"],
    },
  },
  {
    name: "add_items",
    description: "Add items (cards) to a collection: text or markdown you have, a web link, or a file as base64. A card's title is the title you give, else the markdown's first heading, else the filename. Raters never see filenames, so use neutral titles for blind comparisons.",
    inputSchema: {
      type: "object",
      properties: {
        ...ownerArg,
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              text: { type: "string", description: "Markdown or plain text content." },
              url: { type: "string", description: "A link to rank instead of content." },
              filename: { type: "string", description: "e.g. post-a.md or chart.png; sets how the content previews." },
              mime: { type: "string" },
              content_base64: { type: "string", description: "File bytes, base64-encoded (images, PDFs...)." },
            },
          },
        },
      },
      required: ["owner", "items"],
    },
  },
  {
    name: "get_collection",
    description: "A collection's items, people (with their personal links and how many items each has ranked) and the open join link.",
    inputSchema: { type: "object", properties: { ...ownerArg }, required: ["owner"] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "create_rater_links",
    description: "Make a personal ranking link for each name. Send each person their own link (e.g. as a Slack DM); each gets their own ranking.",
    inputSchema: {
      type: "object",
      properties: { ...ownerArg, names: { type: "array", items: { type: "string" } } },
      required: ["owner", "names"],
    },
  },
  {
    name: "get_results",
    description: "Results so far: every item's average score (S=4 A=3 B=2 C=1 D=0 F=-1), rank and consensus tier, each person's tier for it, and each person's full board.",
    inputSchema: { type: "object", properties: { ...ownerArg }, required: ["owner"] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "update_collection",
    description: "Change the title or description, or whether people can see each other's rankings (show_others, on by default).",
    inputSchema: {
      type: "object",
      properties: { ...ownerArg, title: { type: "string" }, description: { type: "string" }, show_others: { type: "boolean" } },
      required: ["owner"],
    },
  },
  {
    name: "remove_item",
    description: "Remove one item from a collection (and from everyone's rankings).",
    inputSchema: { type: "object", properties: { ...ownerArg, item_id: { type: "string" } }, required: ["owner", "item_id"] },
    annotations: { destructiveHint: true },
  },
  {
    name: "get_board",
    description: "One person's current ranking: tier -> items, plus what they haven't placed yet.",
    inputSchema: { type: "object", properties: { ...raterArg }, required: ["person"] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "read_item",
    description: "One item's full text (when it has text) and its file link. Takes either an owner link or a personal link.",
    inputSchema: {
      type: "object",
      properties: { link: { type: "string", description: "Owner or personal link (or token)." }, item_id: { type: "string", description: "Item id or number." } },
      required: ["link", "item_id"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "place_items",
    description: "Move items into tiers on one person's ranking. Only do this when that person asked you to rank for them.",
    inputSchema: {
      type: "object",
      properties: {
        ...raterArg,
        moves: {
          type: "array",
          items: {
            type: "object",
            properties: {
              item_id: { type: "string", description: "Item id or number." },
              tier: { type: "string", enum: TIER_ENUM },
              position: { type: "integer", description: "0-based place inside the tier; default is the end." },
            },
            required: ["item_id", "tier"],
          },
        },
      },
      required: ["person", "moves"],
    },
  },
];

const tokenFrom = (value, kind) => {
  const s = String(value ?? "").trim();
  const m = s.match(new RegExp(`/${kind}/([0-9a-z]+)`));
  return m ? m[1] : s;
};

export function createMcpHandler({ store, service, version }) {
  const owner = (args) => {
    const c = store.collectionByOwnerToken(tokenFrom(args.owner, "o"));
    if (!c) throw httpError(404, "That owner link doesn't match a collection.");
    return c;
  };
  const rater = (args) => {
    const r = store.raterByToken(tokenFrom(args.person, "r"));
    if (!r) throw httpError(404, "That personal link doesn't match anyone.");
    return r;
  };

  const call = (name, args, base, canCreate, requestKey) => {
    switch (name) {
      case "request_agent_key":
        return requestKey(args.name);
      case "create_collection": {
        const who = canCreate();
        if (!who.ok) throw httpError(403, who.reason);
        return service.createCollection(args, base, who.userId);
      }
      case "add_items":
        return { added: service.addItems(owner(args), args.items, base, "mcp") };
      case "get_collection": {
        const v = service.ownerView(owner(args), base);
        return { collection: v.collection, links: v.links, items: v.items, people: v.raters };
      }
      case "create_rater_links":
        return { links: service.createRaters(owner(args), args.names, base, "mcp") };
      case "get_results":
        return service.resultsView(owner(args), base);
      case "update_collection": {
        const { owner: _o, ...patch } = args;
        return { collection: service.updateCollection(owner(args), patch, "mcp") };
      }
      case "remove_item":
        service.deleteItem(owner(args), args.item_id, "mcp");
        return { removed: args.item_id };
      case "get_board":
        return service.raterBoard(rater(args), base);
      case "read_item": {
        const link = String(args.link ?? "");
        const c = /\/r\//.test(link) ? null : store.collectionByOwnerToken(tokenFrom(link, "o"));
        const r = c ? null : store.raterByToken(tokenFrom(link, "r"));
        if (!c && !r) throw httpError(404, "That link doesn't match a collection or person.");
        return service.readItem(c ? c.id : r.collection_id, args.item_id, base);
      }
      case "place_items": {
        const r = rater(args);
        service.place(r, args.moves, "mcp");
        return service.raterBoard(r, base);
      }
      default:
        throw Object.assign(new Error(`Unknown tool: ${name}`), { rpcCode: -32602 });
    }
  };

  const handle = (msg, base, canCreate, requestKey) => {
    const { id, method } = msg ?? {};
    const params = msg?.params ?? {};
    const reply = (result) => ({ jsonrpc: "2.0", id, result });
    const fail = (code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
    if (!msg || msg.jsonrpc !== "2.0" || typeof method !== "string") return fail(-32600, "Invalid request");
    if (id === undefined || id === null) return null; // notifications get no reply
    switch (method) {
      case "initialize": {
        const asked = params.protocolVersion;
        return reply({
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "tiergrader", version },
          instructions:
            "tiergrader: people rank items into S/A/B/C/D/F tiers (S=4 ... F=-1), each on their own personal link. " +
            "Workflow: create_collection -> add_items -> create_rater_links -> send each person their link -> get_results. " +
            "The owner link controls the collection; give it to the user and keep it out of shared channels. " +
            "If create_collection says it needs an agent key you don't have, call request_agent_key and send your person the approve link; never ask them for a password.",
        });
      }
      case "ping":
        return reply({});
      case "tools/list":
        return reply({ tools: TOOLS });
      case "tools/call": {
        try {
          const result = call(params.name, params.arguments ?? {}, base, canCreate, requestKey);
          return reply({ content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result });
        } catch (err) {
          if (err.rpcCode) return fail(err.rpcCode, err.message);
          return reply({ content: [{ type: "text", text: err.status ? err.message : `Error: ${err.message}` }], isError: true });
        }
      }
      default:
        return fail(-32601, `Method not found: ${method}`);
    }
  };

  // body: parsed JSON (one message or a batch). Returns [status, payload | null].
  const noKeyNeeded = () => ({ status: "not_needed", message: "Anyone can create collections on this server; no key needed." });
  return function handleMcp(body, base, { canCreate = () => ({ ok: true, userId: null }), requestKey = noKeyNeeded } = {}) {
    const batch = Array.isArray(body);
    if (batch && !body.length) return [200, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request: empty batch" } }];
    const replies = (batch ? body : [body]).map((m) => handle(m, base, canCreate, requestKey)).filter(Boolean);
    if (!replies.length) return [202, null];
    return [200, batch ? replies : replies[0]];
  };
}
