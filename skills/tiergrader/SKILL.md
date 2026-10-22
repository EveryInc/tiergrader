---
name: tiergrader
description: Get a group of people to rank files into S/A/B/C/D/F tiers with tiergrader, then read back how each person ranked them. Use when the user wants humans to judge or compare a set of outputs (blog posts, drafts, designs, screenshots, model outputs), asks to "make a tier list" or "get Kieran and Dan to rank these", hands you a tiergrader link (/o/, /r/ or /j/), or asks how people ranked a tiergrader collection.
---

# tiergrader

tiergrader turns files into cards that people drag into tiers: S = 4, A = 3, B = 2, C = 1, D = 0, F = -1. Each person ranks on their own personal link; the owner link shows everyone's rankings and the average.

The server is at `$TIERGRADER_URL` (default `http://localhost:5190`), and `$TIERGRADER_KEY` holds the user's agent key if the server needs one. The full API is at `$TIERGRADER_URL/llms.txt`; read it if anything below is unclear.

## Links are the credentials

- Owner link `/o/<token>`: controls the collection. Give it to the user. Never post it in a shared channel or send it to raters.
- Personal link `/r/<token>`: one person's ranking. One per person.
- Open link `/j/<code>`: anyone types their name and gets a personal link. Fine to share in a channel.

If the user hands you a link, `curl -s <link>?format=md` tells you what it is and lists the exact calls for it.

## Get a group to rank some files

1. **Create the collection.** Title = what is being ranked; description = what to judge on (raters see it).
   ```sh
   curl -s -X POST $TIERGRADER_URL/api/collections -H 'content-type: application/json' \
     -H "authorization: Bearer $TIERGRADER_KEY" \
     -d '{"title": "Which intro is best?", "description": "Would you keep reading after two paragraphs?"}'
   ```
   On a server with Every sign-in (like the hosted one), creating needs an agent key (`tg_...`). If you don't have one, get it yourself; never ask the user for a password:
   ```sh
   curl -s -X POST $TIERGRADER_URL/api/agent-keys -H 'content-type: application/json' -d '{"name": "Claude"}'
   ```
   Send the user the `approve_url` it returns ("Open this to let me make tier grades for you") and keep the `key` to yourself; never post it in a shared channel. Once they approve (`GET $TIERGRADER_URL/api/agent-keys/status` with the key says `active`), create the collection with it, and save it for next time. Only creating needs it; every other call uses the links.
   Keep `api_url` from the response; tell the user the `owner_url`.

2. **Upload the files.** `curl -s -X POST $API_URL/items -F file=@a.md -F file=@b.md ...` (25 MB each). For text you have in hand, send JSON: `{"items": [{"title": "Post A", "text": "..."}]}`.
   - For a blind comparison (e.g. outputs from different models), give neutral titles like "Post A" and keep a private key of which is which. Raters never see file names, but they do see titles and a markdown file's first `# heading`.

3. **Make a personal link per person.**
   ```sh
   curl -s -X POST $API_URL/raters -H 'content-type: application/json' -d '{"names": ["Kieran", "Dan"]}'
   ```

4. **Send each person their own link.** With a Slack connector, DM each person separately: one line on what they're ranking and how to judge, their personal link, and that it takes a few minutes (click a card to read it, press S/A/B/C/D/F). Show the user the drafted messages and recipients and get a yes before sending; never send someone else's link.

5. **Pull results** when asked, or when everyone is done (`raters[].ranked == total` in `GET $API_URL`):
   ```sh
   curl -s $API_URL/results      # averages, ranks, each person's tier per item, each person's board
   curl -s $API_URL/results.csv
   ```
   Report the top and bottom items with their averages, where people disagreed most (an S next to a D), and anyone who hasn't finished. If the titles were blind, map them back to the originals.

## Ranking for someone

Only when that person asks you to rank on their behalf, using their personal link:
`GET /api/r/<token>/board`, read items with `GET /api/r/<token>/items/<id>`, then
`POST /api/r/<token>/place` with `{"moves": [{"item_id": "<id or number>", "tier": "A"}]}`.

If the person has the page open in a browser you can drive, it registers WebMCP tools (`tiergrader_get_board`, `tiergrader_read_item`, `tiergrader_place_items`, ...) and the same functions on `window.tiergrader`; the cards move on their screen.

## MCP

`$TIERGRADER_URL/mcp` is a remote MCP server with the same operations (`create_collection`, `add_items`, `create_rater_links`, `get_results`, `place_items`, ...), for clients that can't run curl.
