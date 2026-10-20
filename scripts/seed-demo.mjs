// Makes a demo collection through the public API: eight short "AI-written intros", two people,
// and a partial ranking for one of them. Prints the links.
//   node scripts/seed-demo.mjs [base-url]
const base = (process.argv[2] || process.env.TIERGRADER_URL || "http://localhost:5190").replace(/\/+$/, "");

const posts = [
  ["Post A", "# The quiet death of the status meeting\n\nEvery Monday at 10, forty people stopped working to describe the work they would have been doing. Then one team replaced the meeting with a two-line written update and a bot that flagged anything blocked.\n\nNobody missed it. Here's what they learned about which meetings are load-bearing and which are habit."],
  ["Post B", "# In today's fast-paced world, AI is changing everything\n\nIn today's fast-paced digital landscape, artificial intelligence is revolutionizing the way we work. It is important to note that AI offers many benefits, including increased efficiency, enhanced productivity, and improved outcomes.\n\nIn this blog post, we will delve into the transformative potential of AI."],
  ["Post C", "# I let an agent run my inbox for a week\n\nIt archived 1,412 emails, wrote 63 replies, and almost cancelled my sister's wedding RSVP. The interesting part wasn't the mistakes. It was how quickly I stopped checking its work.\n\nBy Thursday I was approving drafts without reading them. That's the real risk."],
  ["Post D", "# Evals are just unit tests for vibes\n\nYou can't write `assert output == expected` when the output is a paragraph. But you can write down what a good paragraph does: answers the question, doesn't hedge, cites the doc.\n\nThat list *is* your eval. Most teams skip writing it."],
  ["Post E", "# Unlocking synergies: a holistic approach to AI adoption\n\nOrganizations seeking to leverage AI must adopt a holistic, multi-stakeholder approach. By fostering a culture of innovation and aligning cross-functional teams, leaders can unlock unprecedented value.\n\n## Key takeaways\n\n- Embrace change\n- Foster innovation\n- Align stakeholders"],
  ["Post F", "# The spreadsheet that runs a $40M company\n\nOne tab. 212 rows. Every hire, every vendor, every renewal date. The founder has rejected three attempts to replace it with \"real software.\"\n\nI asked why. \"Because I can read the whole company in one scroll.\""],
  ["Post G", "# What I got wrong about prompt engineering\n\nI spent a year collecting magic phrases. \"Take a deep breath.\" \"You are an expert.\" Most of them did nothing measurable.\n\nWhat moved the numbers was boring: giving the model the actual document, and telling it what the reader already knows."],
  ["Post H", "# AI will not replace you (probably)\n\nThere are many opinions about whether AI will replace jobs. Some people think it will, while others think it won't. The truth is probably somewhere in between.\n\nUltimately, only time will tell how this plays out."],
];

async function call(path, body) {
  const res = await fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(process.env.CREATE_KEY ? { "x-create-key": process.env.CREATE_KEY } : {}) },
    body: JSON.stringify(body),
  });
  const out = await res.json();
  if (!res.ok) throw new Error(`${path}: ${out.error}`);
  return out;
}

const made = await call("/api/collections", {
  title: "Which AI-written intro is best?",
  description: "Rank by how much you'd want to keep reading after the first two paragraphs.",
});
const api = new URL(made.api_url).pathname;
await call(`${api}/items`, { items: posts.map(([title, text]) => ({ title, text, filename: `${title.toLowerCase().replace(/\s+/g, "-")}.md` })) });
const { raters } = await call(`${api}/raters`, { names: ["Kieran", "Dan"] });
const [kieran, dan] = raters;
await call(`/api/r/${new URL(kieran.url).pathname.split("/").pop()}/place`, {
  moves: [
    { item_id: 1, tier: "S" }, { item_id: 3, tier: "S" }, { item_id: 6, tier: "A" }, { item_id: 4, tier: "A" },
    { item_id: 7, tier: "B" }, { item_id: 8, tier: "D" }, { item_id: 2, tier: "F" }, { item_id: 5, tier: "F" },
  ],
});
await call(`/api/r/${new URL(dan.url).pathname.split("/").pop()}/place`, {
  moves: [{ item_id: 3, tier: "S" }, { item_id: 4, tier: "S" }, { item_id: 1, tier: "A" }, { item_id: 2, tier: "D" }],
});

console.log(`Owner:  ${made.owner_url}`);
console.log(`Open:   ${made.join_url}`);
for (const r of raters) console.log(`${r.name.padEnd(7)} ${r.url}`);
