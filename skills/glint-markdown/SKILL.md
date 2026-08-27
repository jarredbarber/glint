---
name: glint-markdown
description: Reference for Glint-flavored Markdown extensions (math, diagrams, music, tasks, wiki links, citations)
---

# Glint Markdown Extensions

Glint renders standard Markdown plus the extensions below. Use this as a reference when writing content for the static SPA or the `glint-md render` command.

## Math (KaTeX)

Inline: `$E = mc^2$`
Block (separate with blank lines):

```
$$
\int_0^\infty e^{-x^2} dx = \frac{\sqrt{\pi}}{2}
$$
```

Define document-specific macros in YAML frontmatter. The leading backslash on the macro name is optional:

```
---
latex-macros:
  R: \mathbb{R}
  vec: \mathbf{#1}
---

Use $\R$ and $\vec{x}$ in the document.
```

Numbering is opt-in. Add `\tag{label}` to number one display equation:

```
$$
E = mc^2 \tag{1}
$$
```

Use an unstarred KaTeX environment such as `align` to number each row automatically; use `align*` to suppress numbering:

```
$$
\begin{align}
x &= 1 \\
y &= 2
\end{align}
$$
```

## Mermaid Diagrams

```mermaid
graph LR
  A --> B --> C
```

Rendered client-side. Any valid Mermaid diagram type is supported.

## ABC Music Notation (abcjs)

```abcjs
X:1
T:Scale
M:4/4
L:1/8
K:C
CDEFGAB c|
```

Renders as an interactive music score. Use language `abcjs` or `abc`. See https://abcjs.net for syntax.

## Wiki Links

`[[Page Name]]` links to `Page Name.md`
`[[Page Name|Label]]` links with a custom label

Broken links (file not found) render with a `broken-link` CSS class.

## Citations

Inline: `[[#ref:mykey]]` renders as a numbered superscript.

Reference list (must be under a `## References` heading):

```
## References

- [ref:mykey] "Title of Work" Author Name (2024) https://example.com
```

Citations are auto-numbered in order of appearance.

## Task Widget

Tasks are list items with a bracketed state marker:

| Syntax | State |
|--------|-------|
| `- [ ] description` | open |
| `- [x] description` | done |
| `- [/] description` | in progress |
| `- [w] description` | waiting |
| `- [b] description` | blocked |
| `- [c] description` | cancelled |

Optional metadata goes in trailing parentheses:

```
- [ ] Fix the bug (#high @alice due:2024-12-01 scheduled:2024-11-28 created:2024-11-01)
```

Metadata tokens: `#priority`, `@assignee`, `due:YYYY-MM-DD`, `scheduled:YYYY-MM-DD`, `created:YYYY-MM-DD`, `completed:YYYY-MM-DD`. Omit any token that does not apply.

## GitHub-Flavored Markdown

Standard GFM is fully supported: tables, strikethrough (`~~text~~`), task checkboxes in lists, fenced code blocks with syntax highlighting, and autolinked URLs.
