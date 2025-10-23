// @ts-nocheck
let markedPromise = null;

export const loadMarkdownRenderer = async () => {
  if (!markedPromise) {
    markedPromise = import('marked')
      .then((module) => {
        const marked = module?.marked ?? module?.default ?? module;
        if (marked?.setOptions) {
          marked.setOptions({ breaks: true, gfm: true });
        }
        return marked;
      })
      .catch((error) => {
        markedPromise = null;
        throw error;
      });
  }
  return markedPromise;
};
