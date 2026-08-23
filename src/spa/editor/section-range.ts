// Section-range math for the section-as-unit editor (issue #8).
// The pure core (`sectionRangeFromLines`) is node-testable; `getSectionRange`
// is a thin DOM wrapper exercised by manual smoke (Task 3/4).
export interface SectionRange { startLine: number; endLine: number; }

export function sectionRangeFromLines(startLine: number, laterSectionLines: number[], eof: number): SectionRange {
    const after = laterSectionLines.filter((l) => l > startLine).sort((a, b) => a - b);
    return { startLine, endLine: after.length ? after[0] : eof };
}

function levelOf(section: Element): number {
    for (const c of Array.from(section.classList)) {
        const m = c.match(/^level-(\d)$/);
        if (m) return parseInt(m[1], 10);
    }
    return 0;
}

export function getSectionRange(section: HTMLElement, eof: number): SectionRange {
    const startAttr = section.dataset.sectionLine;
    const wrapper = section.closest('.content-wrapper') ?? document.body;
    const sections = Array.from(wrapper.querySelectorAll<HTMLElement>('.glint-section[data-section-line]'));

    if (!startAttr) {
        // Preamble / under-H1 content lives outside any <section> (rehype-glint-sections wraps h2–h6 only).
        const first = sections[0]?.dataset.sectionLine;
        return { startLine: 1, endLine: first ? parseInt(first, 10) : eof };
    }
    const startLine = parseInt(startAttr, 10);
    const myLevel = levelOf(section);
    const idx = sections.indexOf(section);
    const laterSectionLines = sections
        .slice(idx + 1)
        .filter((s) => levelOf(s) <= myLevel)
        .map((s) => parseInt(s.dataset.sectionLine!, 10));
    return sectionRangeFromLines(startLine, laterSectionLines, eof);
}
