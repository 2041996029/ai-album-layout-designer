import { prepareLayout, generateCandidates, allocateBook } from "@album/layout";
self.onmessage = async (event) => {
  try {
    const { input, doc, template } = event.data,
      p = await prepareLayout(input),
      allocation = allocateBook(p, doc);
    if (!allocation.ok) {
      self.postMessage({ error: allocation.conflicts[0] });
      return;
    }
    self.postMessage({ candidates: generateCandidates(p, doc, template, []) });
  } catch (error) {
    self.postMessage({
      error: { code: error instanceof Error ? error.message : "LAYOUT_FAILED" },
    });
  }
};
