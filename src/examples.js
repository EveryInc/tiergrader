// Seeds the example tier grades (public/examples.js) so visitors can try grading before making their own.
import { EXAMPLES } from "../public/examples.js";

export function ensureExamples(store, log = () => {}) {
  for (const ex of EXAMPLES) {
    const tag = `${ex.slug}@${ex.version}`;
    store.dropOtherExampleVersions(ex.slug, tag);
    if (store.exampleCollection(tag)) continue;
    const c = store.createCollection({ title: ex.title, description: ex.description });
    store.setExample(c.id, tag);
    const added = ex.items.map((it) =>
      store.addItem(c.id, { title: it.title, filename: it.filename, data: Buffer.from(it.text ?? it.svg ?? it.html, "utf8") }),
    );
    for (const [name, grades] of Object.entries(ex.grades)) {
      if (name === "You") continue;
      const r = store.addRater(c.id, name);
      store.place(r, grades.map((tier, i) => ({ item_id: added[i].id, tier })));
    }
    log(`Seeded example "${ex.slug}": owner link /o/${c.owner_token}`);
  }
}

export const exampleBySlug = (slug) => EXAMPLES.find((ex) => ex.slug === slug);
