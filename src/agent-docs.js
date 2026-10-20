// Markdown written for agents: /llms.txt, and the briefs embedded in each owner and personal page so
// an agent handed just a link can tell what it is and what it can do with it.

const SCALE = "S = 4, A = 3, B = 2, C = 1, D = 0, F = -1. Items not yet placed are `unsorted` and don't count.";

const CREATE_AUTH = {
  every: (base) =>
    `**Creating collections on this server needs an agent key.** An Every subscriber signs in at ${base}, makes an agent key on the home page, and gives it to you. Send it as \`Authorization: Bearer tg_...\` when creating a collection (REST or MCP; MCP clients that can't set headers can use \`${base}/mcp?key=tg_...\`). Nothing else needs it: owner and personal links are their own keys, and ranking never needs an account.`,
  key: () =>
    "**Creating collections on this server needs its password**, sent as `x-create-key: <password>` (or `/mcp?key=...`). Nothing else needs it: owner and personal links are their own keys.",
  open: () => "",
};

export function llmsTxt(base, mode = "open") {
  return `# tiergrader

> Upload files, share links, and have people drag each file into S/A/B/C/D/F tiers. Each person gets their own ranking. The owner sees everyone's rankings and the average.

Scoring: ${SCALE}

There are no accounts. Every link carries its own token, and whoever has the link has that access:

- **Owner link** \`${base}/o/{owner_token}\`: full control of one collection, plus the owner's own ranking. Keep it private, like a password.
- **Personal link** \`${base}/r/{rater_token}\`: one person's ranking. Make one per person and send it to them.
- **Open link** \`${base}/j/{invite_code}\`: anyone who opens it types their name and gets a personal link.

If someone gives you one of these links, fetch it: the page starts with a brief that says what it is and the exact API calls for it. JSON is at the same address with \`Accept: application/json\`.

${CREATE_AUTH[mode](base)}

## Typical workflow: get a group to rank a set of files

1. Create a collection.

   \`\`\`sh
   curl -s -X POST ${base}/api/collections -H 'content-type: application/json' \\${mode === "every" ? "\n     -H 'authorization: Bearer tg_...' \\" : mode === "key" ? "\n     -H 'x-create-key: ...' \\" : ""}
     -d '{"title": "Which AI-written post is best?", "description": "Rank on how much you would want to read it."}'
   \`\`\`
   Returns \`owner_url\`, \`owner_token\`, \`join_url\` and \`api_url\` (= \`${base}/api/o/{owner_token}\`). Give the owner link to the person you work for.

2. Upload files. Repeat \`-F\` for several at once (25 MB per file, 50 MB per request, 500 per collection). Markdown, text, HTML, images, PDF, audio and video all preview in the page.

   \`\`\`sh
   curl -s -X POST {api_url}/items -F file=@post-1.md -F file=@post-2.md
   \`\`\`
   Or send JSON, which also takes text you wrote and links:
   \`\`\`sh
   curl -s -X POST {api_url}/items -H 'content-type: application/json' \\
     -d '{"items": [{"title": "Post A", "text": "# Markdown here"}, {"title": "Landing page", "url": "https://example.com"}, {"filename": "chart.png", "content_base64": "..."}]}'
   \`\`\`
   A card's title is the \`title\` you give, else the first \`# heading\` of a markdown file, else the file name. Raters never see file names, so for a blind comparison give neutral titles ("Post A") rather than ones that name the model.

3. Make a personal link for each person.

   \`\`\`sh
   curl -s -X POST {api_url}/raters -H 'content-type: application/json' -d '{"names": ["Kieran", "Dan"]}'
   \`\`\`
   Returns \`[{ "id", "name", "url" }]\`. Send each person their own \`url\` (for example as a Slack DM), with a line on what to rank and how to judge. Or send everyone the \`join_url\`.

4. Read the results whenever you like.

   \`\`\`sh
   curl -s {api_url}/results       # JSON: every item's average and rank, each person's tier for it, and each person's full board
   curl -s {api_url}/results.csv   # one row per file (name, title, average), one column per person, grades in points
   \`\`\`

## Owner API (\`{api_url}\` = \`${base}/api/o/{owner_token}\`)

| Call | Does |
|---|---|
| \`GET {api_url}\` | Collection, items, people (with their links and progress), every placement, and averages |
| \`PATCH {api_url}\` | \`{"title", "description", "show_others"}\`. \`show_others: false\` hides people's rankings from each other (on by default) |
| \`DELETE {api_url}\` | Deletes the collection and everything in it |
| \`POST {api_url}/items\` | Add items (multipart files, or JSON as above) |
| \`GET {api_url}/items/{id}\` | One item, with its full text when it has any |
| \`PATCH {api_url}/items/{id}\` | \`{"title"}\` |
| \`DELETE {api_url}/items/{id}\` | Remove an item |
| \`POST {api_url}/raters\` | \`{"names": [...]}\` or \`{"name"}\`: personal links |
| \`PATCH {api_url}/raters/{id}\` | \`{"name"}\` |
| \`DELETE {api_url}/raters/{id}\` | Remove a person and their ranking |
| \`POST {api_url}/place\` | The owner's own ranking: \`{"moves": [{"item_id", "tier", "position"}]}\`, as on a personal link. It only counts in results once it has something in it |
| \`GET {api_url}/results\` | Averages, ranks and each person's board |
| \`GET {api_url}/results.csv\` | Export: one row per file with its name, title and average, and each person's grade in points (S 4 … F -1) |

Item files are at \`${base}/f/{item_id}\`.

## Ranking on a person's behalf (only when that person asks you to)

With their personal link \`${base}/r/{rater_token}\`, the API is \`${base}/api/r/{rater_token}\`:

| Call | Does |
|---|---|
| \`GET /api/r/{rater_token}/board\` | Their board: tier -> items, plus what is still unsorted |
| \`GET /api/r/{rater_token}/items/{id}\` | One item with its full text, to read before judging |
| \`POST /api/r/{rater_token}/place\` | \`{"moves": [{"item_id": "...", "tier": "S", "position": 0}]}\`. \`item_id\` may also be the item's number; \`tier\` is S/A/B/C/D/F or \`unsorted\`; \`position\` (0-based, inside the tier) is optional and defaults to the end |

An open page updates as soon as the ranking changes.

## In the browser: WebMCP

Every collection page registers WebMCP tools on \`document.modelContext\` (or \`navigator.modelContext\` in older builds), so an agent with the page open can work it directly:

- \`tiergrader_get_board\`: who is being viewed, the tiers and their items, and what is unsorted
- \`tiergrader_read_item\`: the full text of one item
- \`tiergrader_place_items\`: move items into tiers on your own personal page (cards move on screen)
- \`tiergrader_view\`: show someone else's ranking, or everyone's average
- \`tiergrader_get_results\`: averages and every visible person's tiers
- On the owner page only: \`tiergrader_create_links\` and \`tiergrader_add_text_items\`

Without WebMCP, the same functions are on \`window.tiergrader\` (\`await tiergrader.getBoard()\`, \`tiergrader.placeItems([{item: 3, tier: "A"}])\`, ...).

## MCP server

\`${base}/mcp\` is a remote MCP server (streamable HTTP, no sign-in) with the same operations: \`create_collection\`, \`add_items\`, \`get_collection\`, \`create_rater_links\`, \`get_results\`, \`update_collection\`, \`remove_item\`, \`get_board\`, \`read_item\`, \`place_items\`. Tools take the owner or personal link (or bare token) as an argument.
`;
}

const itemLine = (it) => `- #${it.n} **${it.title}** (${it.kind}) id \`${it.id}\``;

export function ownerBrief(base, view) {
  const { collection: c, links, items, raters, results } = view;
  const api = links.api_url;
  const top = results.items.filter((r) => r.avg !== null).slice(0, 10);
  return `# ${c.title} (tiergrader owner page)

This is the **owner link** for a tiergrader collection: ${items.length} item${items.length === 1 ? "" : "s"}, ${raters.length} ${raters.length === 1 ? "person" : "people"} invited. Whoever has this link controls the collection, so keep it private. Scoring: ${SCALE}
${c.description ? `\nDescription: ${c.description}\n` : ""}
## For agents

- JSON for everything: \`GET ${api}\` (or this page with \`Accept: application/json\`)
- Add files: \`curl -s -X POST ${api}/items -F file=@post.md\`, or JSON \`{"items": [{"title", "text"}]}\`
- Personal links: \`curl -s -X POST ${api}/raters -H 'content-type: application/json' -d '{"names": ["Kieran", "Dan"]}'\`, then send each person their link
- Open link anyone can join with their name: ${links.join_url}
- Results: \`GET ${api}/results\` (JSON) or \`${api}/results.csv\`
- With this page open in a browser, WebMCP tools are registered (\`tiergrader_get_board\`, \`tiergrader_get_results\`, \`tiergrader_create_links\`, \`tiergrader_add_text_items\`, ...). Full reference: ${base}/llms.txt

## Items
${items.length ? items.map(itemLine).join("\n") : "_None yet._"}

## People
${raters.length ? raters.map((r) => `- **${r.name}**: ranked ${r.ranked} of ${r.total}. Personal link: ${r.url}`).join("\n") : "_No one yet._"}
${top.length ? `\n## Average so far\n${top.map((r) => `${r.rank}. **${r.title}**: ${r.avg} (${r.tier}, ${r.count} rating${r.count === 1 ? "" : "s"})`).join("\n")}\n` : ""}`;
}

export function raterBrief(base, view, board) {
  const { collection: c, me, items } = view;
  const api = me.api_url;
  const tierLines = Object.entries(board.board)
    .map(([tier, list]) => `- **${tier}**: ${list.length ? list.map((x) => `#${x.n} ${x.title}`).join(", ") : "-"}`)
    .join("\n");
  return `# ${c.title} (${me.name}'s tiergrader ranking)

This is **${me.name}'s personal link** for ranking ${items.length} item${items.length === 1 ? "" : "s"} into tiers. Scoring: ${SCALE}
${c.description ? `\nWhat to judge: ${c.description}\n` : ""}
## Current ranking
${tierLines}

## For agents (only rank on ${me.name}'s behalf if they ask you to)

- Board as JSON: \`GET ${api}/board\`
- Read an item: \`GET ${api}/items/{id}\`
- Move items: \`curl -s -X POST ${api}/place -H 'content-type: application/json' -d '{"moves": [{"item_id": "<id or number>", "tier": "A"}]}'\` (tier: S, A, B, C, D, F or unsorted)
- With this page open in a browser, WebMCP tools are registered: \`tiergrader_get_board\`, \`tiergrader_read_item\`, \`tiergrader_place_items\`, \`tiergrader_view\`, \`tiergrader_get_results\`. Full reference: ${base}/llms.txt

## Items
${items.map(itemLine).join("\n") || "_None yet._"}
`;
}
