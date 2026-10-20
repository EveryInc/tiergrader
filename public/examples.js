// The three example tier grades. The server seeds them so visitors can try grading before making their
// own, and the landing-page demo acts them out. Grades are listed in item order. Dan's and Kate's are
// seeded on the server; "You" is only used by the demo (a visitor's own grades are theirs to make).

const logo = (bg, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" width="320" height="200"><rect width="320" height="200" fill="${bg}"/>${body}</svg>`;

const page = (title, css, body) =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>*{box-sizing:border-box}body{margin:0;font-family:-apple-system,Helvetica,Arial,sans-serif}${css}</style></head><body>${body}</body></html>`;

export const EXAMPLES = [
  {
    slug: "intros",
    version: 1,
    name: "Blog intros",
    title: "Which blog intro would you keep reading?",
    description: "Grade each intro on whether you'd keep reading after the first two paragraphs.",
    items: [
      {
        title: "Intro A",
        filename: "intro-a.md",
        text: "# The quiet death of the status meeting\n\nEvery Monday at 10, forty people stopped working to describe the work they would have been doing. Then one team replaced the meeting with a two-line written update and a bot that flagged anything blocked.\n\nNobody missed it. Here's what they learned about which meetings hold the company up and which are just habit.",
      },
      {
        title: "Intro B",
        filename: "intro-b.md",
        text: "# In today's fast-paced world, AI is changing everything\n\nIn today's fast-paced digital landscape, artificial intelligence is revolutionizing the way we work. It is important to note that AI offers many benefits, including increased efficiency, enhanced productivity, and improved outcomes.\n\nIn this blog post, we will delve into the transformative potential of AI.",
      },
      {
        title: "Intro C",
        filename: "intro-c.md",
        text: "# I let an agent run my inbox for a week\n\nIt archived 1,412 emails, wrote 63 replies, and almost declined my sister's wedding. The interesting part wasn't the mistakes. It was how quickly I stopped checking its work.\n\nBy Thursday I was approving drafts without reading them. That's the real risk.",
      },
      {
        title: "Intro D",
        filename: "intro-d.md",
        text: "# Evals are just unit tests for taste\n\nYou can't write `assert output == expected` when the output is a paragraph. But you can write down what a good paragraph does: it answers the question, doesn't hedge, cites the doc.\n\nThat list is your eval. Most teams skip writing it.",
      },
      {
        title: "Intro E",
        filename: "intro-e.md",
        text: "# Unlocking synergies: a holistic approach to AI adoption\n\nOrganizations seeking to leverage AI must adopt a holistic, multi-stakeholder approach. By fostering a culture of innovation and aligning cross-functional teams, leaders can unlock unprecedented value.\n\n## Key takeaways\n\n- Embrace change\n- Foster innovation\n- Align stakeholders",
      },
      {
        title: "Intro F",
        filename: "intro-f.md",
        text: "# The spreadsheet that runs a $40M company\n\nOne tab. 212 rows. Every hire, every vendor, every renewal date. The founder has rejected three attempts to replace it with \"real software.\"\n\nI asked why. \"Because I can read the whole company in one scroll.\"",
      },
    ],
    grades: {
      You: ["S", "F", "S", "A", "F", "A"],
      Dan: ["S", "F", "S", "A", "F", "B"],
      Kate: ["A", "D", "S", "S", "F", "A"],
    },
  },
  {
    slug: "logos",
    version: 1,
    name: "Logos",
    title: "Pick a logo for Lumen",
    description: "Lumen is a reading app. Which logo would you put on the App Store?",
    items: [
      { title: "Logo A", filename: "logo-a.svg", svg: logo("#fdfaf7", `<text x="160" y="122" text-anchor="middle" font-family="Georgia,serif" font-size="70" fill="#121212">lumen</text>`) },
      {
        title: "Logo B",
        filename: "logo-b.svg",
        svg: logo("#1a2ee1", `<circle cx="92" cy="100" r="30" fill="#ffdf7f"/><text x="140" y="114" font-family="Helvetica,Arial,sans-serif" font-weight="700" font-size="40" letter-spacing="6" fill="#ffffff">LUMEN</text>`),
      },
      {
        title: "Logo C",
        filename: "logo-c.svg",
        svg: logo("#fdfaf7", `<rect x="58" y="52" width="96" height="96" fill="#c3311d"/><text x="106" y="128" text-anchor="middle" font-family="Georgia,serif" font-size="76" fill="#fdfaf7">L</text><text x="172" y="114" font-family="Georgia,serif" font-size="38" fill="#121212">umen</text>`),
      },
      {
        title: "Logo D",
        filename: "logo-d.svg",
        svg: logo("#9ce5f5", `<defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#9ce5f5"/><stop offset="1" stop-color="#1a2ee1"/></linearGradient></defs><rect width="320" height="200" fill="url(#g)"/><text x="160" y="124" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-weight="800" font-size="66" fill="#ffffff">lumen.</text>`),
      },
      {
        title: "Logo E",
        filename: "logo-e.svg",
        svg: logo("#121212", `<circle cx="160" cy="100" r="70" fill="none" stroke="#ffdf7f" stroke-width="4"/><circle cx="160" cy="100" r="60" fill="none" stroke="#ffdf7f" stroke-width="1"/><text x="160" y="96" text-anchor="middle" font-family="Courier New,monospace" font-weight="700" font-size="24" letter-spacing="4" fill="#ffdf7f">LUMEN</text><text x="160" y="122" text-anchor="middle" font-family="Courier New,monospace" font-size="12" letter-spacing="3" fill="#ffdf7f">READ · EST 2026</text>`),
      },
      {
        title: "Logo F",
        filename: "logo-f.svg",
        svg: logo("#bfff7f", `<text x="160" y="124" text-anchor="middle" font-family="Georgia,serif" font-style="italic" font-size="72" fill="#121212">Lumen</text><path d="M236 58l5 12 13 1-10 8 3 13-11-7-11 7 3-13-10-8 13-1z" fill="#121212"/>`),
      },
    ],
    grades: {
      You: ["A", "S", "A", "C", "F", "B"],
      Dan: ["A", "S", "B", "C", "F", "B"],
      Kate: ["S", "A", "A", "D", "C", "B"],
    },
  },
  {
    slug: "landing-pages",
    version: 1,
    name: "Landing pages",
    title: "Which landing page would make you sign up?",
    description: "Five takes on Lumen's landing page. Which one gets you to press the button?",
    items: [
      {
        title: "Landing A",
        filename: "landing-a.html",
        accent: "#fdfaf7",
        html: page(
          "Lumen: read what you save",
          "body{background:#fdfaf7;color:#121212}main{max-width:620px;margin:0 auto;padding:96px 28px}h1{font:400 56px/1.02 Georgia,serif;letter-spacing:-.03em;margin:0 0 18px}p{font-size:19px;color:#585654;margin:0 0 30px}a{display:inline-block;background:#121212;color:#9ce5f5;padding:14px 22px;text-decoration:none}",
          "<main><h1>Read more of what you save.</h1><p>Lumen turns your read-later pile into ten minutes a day. No streaks, no feeds. Just the things you meant to read.</p><a href='#'>Start reading</a></main>",
        ),
      },
      {
        title: "Landing B",
        filename: "landing-b.html",
        accent: "#5b3be8",
        html: page(
          "Lumen: your reading list, finally read",
          "body{background:linear-gradient(135deg,#5b3be8,#1a2ee1);color:#fff;min-height:100vh}main{padding:90px 32px;text-align:center}h1{font:800 64px/1 Helvetica,Arial,sans-serif;letter-spacing:-.04em;margin:0 0 20px}p{font-size:20px;opacity:.85;margin:0 0 34px}a{display:inline-block;margin:0 6px;padding:15px 26px;border-radius:999px;text-decoration:none;font-weight:700}.a{background:#fff;color:#1a2ee1}.b{border:2px solid #fff;color:#fff}",
          "<main><h1>Your reading list,<br>finally read.</h1><p>Lumen picks today's ten minutes from everything you saved.</p><a class='a' href='#'>Try it free</a><a class='b' href='#'>See how it works</a></main>",
        ),
      },
      {
        title: "Landing C",
        filename: "landing-c.html",
        accent: "#f2ede8",
        html: page(
          "Lumen: what readers say",
          "body{background:#f2ede8;color:#121212}main{max-width:760px;margin:0 auto;padding:70px 28px}h1{font:600 40px/1.1 Helvetica,Arial,sans-serif;margin:0 0 30px}blockquote{margin:0 0 16px;padding:18px 22px;background:#fff;border:1px solid #d8ccc0;font-size:17px}cite{display:block;margin-top:8px;font-size:13px;color:#6f6962;font-style:normal}a{display:inline-block;margin-top:12px;background:#c3311d;color:#fff;padding:13px 22px;text-decoration:none}",
          "<main><h1>12,000 readers cleared their backlog.</h1><blockquote>“I read 40 articles last month. I used to save 40 and read none.”<cite>Priya, product designer</cite></blockquote><blockquote>“It's the only app that made me read less news and more books.”<cite>Sam, teacher</cite></blockquote><a href='#'>Join them</a></main>",
        ),
      },
      {
        title: "Landing D",
        filename: "landing-d.html",
        accent: "#121212",
        html: page(
          "Lumen: features",
          "body{background:#121212;color:#fdfaf7}main{max-width:900px;margin:0 auto;padding:70px 28px}h1{font:700 44px/1.05 Helvetica,Arial,sans-serif;margin:0 0 34px}.g{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.c{border:1px solid #3c3c3c;padding:20px}.c b{display:block;width:26px;height:26px;background:#ffdf7f;margin-bottom:14px}.c h2{font-size:18px;margin:0 0 6px}.c p{margin:0;color:#bcbcbc;font-size:14px}a{display:inline-block;margin-top:26px;background:#ffdf7f;color:#121212;padding:13px 22px;text-decoration:none;font-weight:700}",
          "<main><h1>Everything you saved, sorted for you.</h1><div class='g'><div class='c'><b></b><h2>Daily ten</h2><p>A short stack picked from your saves.</p></div><div class='c'><b></b><h2>Highlights</h2><p>Keep the lines worth keeping.</p></div><div class='c'><b></b><h2>Offline</h2><p>Read on the plane, on the train.</p></div></div><a href='#'>Get Lumen</a></main>",
        ),
      },
      {
        title: "Landing E",
        filename: "landing-e.html",
        accent: "#ffffff",
        html: page(
          "Lumen",
          "body{background:#fff;color:#333}main{max-width:900px;margin:0 auto;padding:40px 24px;font-size:14px;line-height:1.5}h1{font-size:22px}a{font-size:11px;color:#06c}",
          "<main><h1>Welcome to Lumen</h1><p>Lumen is an innovative, AI-powered reading platform that leverages cutting-edge technology to deliver a holistic, personalized content consumption experience across all of your devices, enabling you to optimize your reading workflows, synergize your saved content, and unlock unprecedented productivity gains through intelligent curation, advanced analytics, and seamless cross-platform integration with the tools you already use every day, in a secure and scalable way.</p><a href='#'>click here to learn more about signing up</a></main>",
        ),
      },
    ],
    grades: {
      You: ["S", "A", "B", "B", "F"],
      Dan: ["A", "S", "B", "B", "F"],
      Kate: ["S", "B", "A", "C", "F"],
    },
  },
];
