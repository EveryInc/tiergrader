# tiergrader

Upload a bunch of files, share a link, and have people drag each file into **S, A, B, C, D or F**. Every person gets their own ranking; you can click through how Kieran ranked, how Dan ranked, and everyone's average.

Built for the "a human with taste has to judge this" part of evals: AI-written blog posts, landing pages, designs, model outputs.

**Inspiration:** [Hamel Husain ranking every AI eval method from worst to best on a tier list](https://x.com/mfishbein/status/2109354297343303725). One of his points is that judging subjective output takes a human subject-matter expert. tiergrader makes it quick to hand that judgment to a few people at once.

## Use it

The hosted version is for **Every subscribers**: sign in with your Every account to make collections. The people you send links to can rank without any account.

Not a subscriber? tiergrader is open source under the [MIT license](LICENSE), so feel free to run your own:

```bash
npm start                    # http://localhost:5190
node scripts/seed-demo.mjs   # makes a demo collection and prints its links
npm test
```

No dependencies to install: Node 24+ (`node:sqlite`, `node:http`). The page loads SortableJS, marked and DOMPurify from jsdelivr at pinned versions with integrity hashes, and fonts from Google Fonts and Fontshare.

## How it works

- **Ranking needs no account. Links are the access.** Making a collection gives you three kinds of link:
  - **Owner link** `/o/…`: add files, make links, see everyone's rankings and the average, export CSV. Keep it private.
  - **Personal link** `/r/…`: one person's ranking. Make one per person (Share → names) and DM it to them.
  - **Open link** `/j/…`: anyone types their name and gets their own personal link.
- **Each file is a card.** Click one to read it in a modal: just the title and the post, image, page or PDF, with the tier buttons underneath. Anything else downloads. Only raster images, PDF, audio and video are served as-is; everything else (HTML, SVG, text…) is served in a sandbox with no access to the app.
- **Scoring:** S 4 · A 3 · B 2 · C 1 · D 0 · F −1. Unplaced cards don't count. The "Everyone" view puts each card in the tier nearest its average (ties round up) and shows each person's vote on it; "Table" lists them all.
- **Live:** open pages update as people rank, files are added, or links are made.
- People can see each other's rankings by default; the owner can turn that off in Share.
- Raters never see file names, so for a blind comparison give the cards neutral titles ("Post A").

## Keyboard

Click a card to open it in the reader, then:

| Keys | Does |
|---|---|
| `S` `A` `B` `C` `D` `F` | Put it in that tier (holding `⌥` works too) |
| `4` `3` `2` `1` `0` `-` | Same, by points |
| `U` / `⌫` | Back to unsorted |
| `←` `→` / `J` `K` | Previous / next card |
| `Enter` | Open or close the reader |
| `Space` | Scroll the reader |
| `⌘Z` | Undo |
| `?` | All shortcuts |

After you place an unsorted card the next unsorted one opens, so grading is read, key, read, key. Plain letters work because nothing on the board takes typing; on a Mac, `⌥S` etc. also work (the app reads the physical key, so `ß` still means S).

## Who can make collections

Set by environment variables; ranking never needs an account.

| Setup | Who can create |
|---|---|
| `EVERY_OAUTH_CLIENT_ID` + `EVERY_OAUTH_CLIENT_SECRET` (+ `PUBLIC_URL`) | Every subscribers, after signing in with Every. Agents use **agent keys** a subscriber makes on the home page (`Authorization: Bearer tg_…`); a key keeps working while its owner has signed in within the last 30 days. |
| `CREATE_KEY` only | Anyone with that one shared key (`x-create-key` header). |
| Neither | Anyone. Fine on your own machine; on Railway or behind https it refuses to start unless you also set `ALLOW_OPEN_CREATE=1`. |

`CREATE_KEY` also works alongside Every sign-in, as an operator override. Every sign-in is OAuth2 against every.to (PKCE, scope `basic_profile`); tiergrader keeps who you are and whether you subscribe, and drops Every's access token.

Getting an Every OAuth client: ask the Every team to provision one with the redirect URI `<PUBLIC_URL>/auth/every/callback` (exactly, no query string) and the scope `basic_profile`.

## Agents

- **Give your agent a link.** Every owner and personal page carries a plain-text brief of what the link is and the exact API calls for it (`?format=md` returns just that; `Accept: application/json` returns the data).
- **REST API:** documented at `/llms.txt`. Create a collection, `curl -F file=@…` uploads, make personal links, pull `/results` or `/results.csv`. On a server with Every sign-in, only creating a collection needs an agent key.
- **Agent skill:** [`skills/tiergrader/SKILL.md`](skills/tiergrader/SKILL.md) walks an agent through the whole loop, including DMing each person their link over a Slack connector (after you OK the messages) and reporting results. Copy it into `~/.claude/skills/` and set `TIERGRADER_URL` (and `TIERGRADER_KEY`, your agent key).
- **MCP server:** `POST /mcp` (streamable HTTP, stateless; tools take the owner or personal link as an argument, and `create_collection` takes your agent key as a bearer header or `/mcp?key=…`): `create_collection`, `add_items`, `get_collection`, `create_rater_links`, `get_results`, `update_collection`, `remove_item`, `get_board`, `read_item`, `place_items`.
- **WebMCP:** board pages register tools on `document.modelContext` (falling back to `navigator.modelContext`): `tiergrader_get_board`, `tiergrader_read_item`, `tiergrader_place_items`, `tiergrader_view`, `tiergrader_get_results`, plus `tiergrader_create_links` and `tiergrader_add_text_items` on owner pages. An agent with the page open can sort cards for you and you watch them move. The same functions are on `window.tiergrader` for agents that can run JavaScript but don't speak WebMCP.

## Deploy

The SQLite file holds everything, uploads included, so the server needs a persistent disk.

- **Render:** `render.yaml` is a Blueprint for a web service with a 1 GB disk at `/data` (a paid instance type, since free ones have no disk). It generates a `CREATE_KEY`, and uses Render's own URL unless you set `PUBLIC_URL`.
- **Railway:** `railway.json` is included. Add a volume; the app finds it through `RAILWAY_VOLUME_MOUNT_PATH`.
- **Anywhere else:** Node 24+, `npm start`, `DATA_DIR` on a persistent disk, health check `/healthz`.

Then:

- **Set `PUBLIC_URL`** to the public address so the links the API hands out are right (Render sets this for you).
- **Decide who can create** (table above). On a public deploy, set Every sign-in or `CREATE_KEY`; otherwise anyone can create collections (limited to 20 a minute per address; joins to 30).
- **Optional: `WEBMCP_ORIGIN_TRIAL_TOKEN`.** Register your origin for [Chrome's WebMCP origin trial](https://developer.chrome.com/origintrials/#/register_trial/4163014905550602241) and set the token, so visitors' Chrome exposes the page's agent tools without flags.

Limits: 25 MB per file, 50 MB per upload request, 500 items and 500 people per collection. See `.env.example`.

## Layout

```
server.js            entry point
src/app.js           routes, file serving, live updates (SSE), /mcp
src/store.js         SQLite schema and queries
src/service.js       views and writes shared by REST and MCP
src/mcp.js           MCP tools
src/auth.js          Every sign-in, sessions, agent keys
src/agent-docs.js    llms.txt and the per-page agent briefs
src/pages.js         HTML shells
public/board.js      the tier board (owner and personal pages)
public/agent.js      WebMCP tools and window.tiergrader
public/shared.js     tier scale and averaging (server and browser)
public/home.js       sign in, create a collection, agent keys
public/join.js       open-link join page
```

## License

[MIT](LICENSE). The Every name and logo are trademarks of Every Media, Inc. and aren't covered by the license; if you run your own copy, swap `public/every-wordmark.svg` and the lockup in `public/shared.js` for your own.
