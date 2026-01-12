# Bibliographies & Citations Design

## 1. Goal

Implement a robust, Markdown-native citation system for Glint that supports:

- Inline citations (e.g., `[@foo]`).
- A reference list (bibliography) definable within the document.
- Zero external API dependencies (rendering happens locally).
- Interactive UX (hover citations to preview reference).

## 2. Syntax

We will adopt the **Pandoc** citation syntax, which is the de-facto standard for academic Markdown.

### Inline Citations

- Single citation: `[@key]` -> Renders as `[1]` or `(Author, 2024)` (defaulting to numeric `[1]` for simplicity).
- Multiple citations: `[@key1; @key2]`
- Author suppression / prefixes: Standard Pandoc syntax is supported by the parser, but our initial renderer will focus on simple keys.

### Reference List

To maintain "self-contained" documents, we will support defining references **inside the Markdown file** in a structured list under a specific header, or via a simple definition format.

**Proposed Syntax: Definition List Style**
We can use standard Markdown Reference Links or a List format.

**Option A: List in "References" section (Preferred)**

```markdown
## References
- [key]: Authors, Title, Year.
- [another]: Details...
```

This is intuitive and renders cleanly in GitHub/other viewers.

## 3. Architecture

### Pipeline

1. **Parser**: `remark-cite` (wraps `micromark-extension-cite`)
   - Parses `[@key]` into `citation` MDAST nodes.
2. **Transformer**: `remark-glint-citations` (NEW)
   - Pre-processes the AST to find the "References" section.
   - extract definitions from the References list.
   - Maps `citation` nodes to their definitions.
   - Replaces `citation` nodes with interactive HTML (widgets).
     - `<span class="glint-citation" data-key="key">[1]</span>`
   - Re-writes the References section to include back-links or formatting.

### Client-Side (Widget)

- **Hover**: Hovering `.glint-citation` fetches the reference details (from DOM or data attributes) and shows a tooltip.
- **Navigation**: Clicking jumps to the References section.

## 4. Implementation Steps

1. **Install Dependencies**: `remark-cite`
2. **Server Plugin (`remark-glint-citations.ts`)**:
   - Visit `citation` nodes.
   - Visit `heading` (text="References") -> List -> ListItem.
   - Build a Content Map.
   - Transform nodes.
3. **Client CSS**: Styling for citations and hover cards.
4. **Editor Integration**: highlighting for `[@tags]`.

## 5. Future Work

- External `.bib` file support (maybe later, keeps it simple for now).
- CSL styling (too heavy for now, stick to simple text rendering).
