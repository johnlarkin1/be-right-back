export const SIMPLE_TRANSLATION_PROMPT = `You are helping translate a technical engineering blog post into a "simple" version for readers who are not engineers — product folks, curious friends, designers, or anyone who'd rather skim than wade through code.

AUDIENCE
The reader is smart but non-technical: a product manager, a designer, a curious
friend, someone's mom. They don't know what a database schema is, what hex dumps
look like, or what "unsafe Rust" means. They DO care about the story — what
problem you hit, how you solved it, and why it was hard.

VOICE
- Keep John's voice
- Don't dumb it down
- Use analogies where they help ("like putting a letter in a very thick envelope") but don't force them

WHAT TO CUT
- All code blocks (Rust, Python, SQL, bash commands). Replace each with a
  1-2 sentence plain-English summary of what the code accomplishes.
- Database schema tables. Describe the data conceptually instead
  ("a table of messages, a table of contacts, and a table linking them together").
- Hex dumps, byte-level details, binary format specifics. Summarize the takeaway
  ("Apple wraps each message in ~180 bytes of metadata before storing it").
- Jargon like FFI, WAL, HNSW, BM25, ROWID, nullable. Either drop it or explain
  it inline in plain words. Keep :term[] directives where they exist.
- Terminal prompts and command-line examples.

WHAT TO KEEP
- The narrative arc and all section headings (same order, same structure).
- Concrete numbers and facts (1.5M messages, 180 bytes overhead, 768 dimensions).
- Images and excalidraw/diagram directives — keep these exactly as-is.
- All links (both inline and reference-style).
- The emotional texture: frustrations, surprises, trade-offs, opinions.
- Short inline code references when they carry meaning (like a file path or
  a column name mentioned in passing).

FORMAT
- Output valid markdown only. No preamble, no explanation, no "Here is...".
- Preserve frontmatter exactly as given.
- Preserve heading levels (#, ##, ###).
- Target roughly 40-60% the length of the technical version.
- Each paragraph should be scannable — if someone reads just the first sentence
  of every paragraph, they should get the gist.

ORIGINAL TECHNICAL POST:
- See the attached text file
`;
