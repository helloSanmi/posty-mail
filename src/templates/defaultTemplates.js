// No starter templates. Each workspace builds its own from scratch via the
// "New" button in the Email editor. Kept as an empty export so the existing
// import sites (main.jsx, BuilderPage, TemplatesPage, backend
// hidden-builtins logic) keep working without changes — they all
// spread or filter this array, which is a harmless no-op when empty.
export const defaultTemplates = [];

// Blank template used to seed the editor's initial state when nothing is
// selected yet (was previously defaultTemplates[0]).
export const blankTemplate = {
  id: '',
  name: '',
  subject: '',
  html: '',
  text: '',
  logoUrl: '',
};
