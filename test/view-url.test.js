import { test } from "node:test";
import assert from "node:assert/strict";
import { readView, writeView, slugify } from "../public/view-url.js";

const ctx = {
  meId: "me1",
  people: [
    { id: "me1", name: "Mike" },
    { id: "r1", name: "Lauren" },
    { id: "r2", name: "Lee Ann" },
    { id: "r3", name: "Yannick" },
    { id: "r4", name: "André" },
  ],
  items: [
    { id: "itema", n: 1 },
    { id: "itemb", n: 2 },
  ],
};

test("slugs are plain lowercase words", () => {
  assert.equal(slugify("Lee Ann"), "lee-ann");
  assert.equal(slugify("André"), "andre");
  assert.equal(slugify("  O'Brien! "), "o-brien");
});

test("each view writes a readable link", () => {
  assert.equal(writeView("", { viewing: "me1" }, ctx), "");
  assert.equal(writeView("", { viewing: "r1" }, ctx), "?view=lauren");
  assert.equal(writeView("", { viewing: "r4" }, ctx), "?view=andre");
  assert.equal(writeView("", { viewing: "everyone" }, ctx), "?view=everyone");
  assert.equal(writeView("", { viewing: "everyone", table: true }, ctx), "?view=everyone&table=1");
  assert.equal(writeView("", { viewing: "r1", table: true }, ctx), "?view=lauren"); // the table is only for everyone
  assert.equal(writeView("", { viewing: "r3", card: "itemb" }, ctx), "?view=yannick&card=itemb");
  assert.equal(writeView("", { viewing: "me1", card: "itema" }, ctx), "?card=itema");
  assert.equal(writeView("", { viewing: "me1", card: "gone" }, ctx), "");
});

test("writing keeps other params and replaces old view params", () => {
  assert.equal(writeView("?utm_source=slack&view=lee-ann&card=itema", { viewing: "r1" }, ctx), "?utm_source=slack&view=lauren");
});

test("every written link reads back to the same view", () => {
  const views = [
    { viewing: "me1", table: false, card: null },
    { viewing: "r2", table: false, card: "itema" },
    { viewing: "everyone", table: true, card: "itemb" },
    { viewing: "everyone", table: false, card: null },
  ];
  for (const v of views) assert.deepEqual(readView(writeView("", v, ctx), ctx), v);
});

test("reading is forgiving, and anything unknown falls back to your own ranking", () => {
  assert.deepEqual(readView("", ctx), { viewing: "me1", table: false, card: null });
  assert.equal(readView("?view=Lauren", ctx).viewing, "r1");
  assert.equal(readView("?view=r3", ctx).viewing, "r3");
  assert.equal(readView("?view=Everyone&table", ctx).table, true);
  assert.equal(readView("?view=nobody", ctx).viewing, "me1");
  assert.equal(readView("?view=lauren&table=1", ctx).table, false);
  assert.equal(readView("?card=2", ctx).card, "itemb"); // a card number typed by hand
  assert.equal(readView("?card=%232", ctx).card, "itemb");
  assert.equal(readView("?card=missing", ctx).card, null);
});

test("people whose names match get their id in the link", () => {
  const twins = { ...ctx, people: [...ctx.people, { id: "r5", name: "lauren" }, { id: "r6", name: "Everyone" }] };
  assert.equal(writeView("", { viewing: "r1" }, twins), "?view=r1");
  assert.equal(writeView("", { viewing: "r5" }, twins), "?view=r5");
  assert.equal(writeView("", { viewing: "r6" }, twins), "?view=r6");
  assert.equal(readView("?view=r5", twins).viewing, "r5");
  assert.equal(readView("?view=lauren", twins).viewing, "me1"); // ambiguous, so no guess
});
