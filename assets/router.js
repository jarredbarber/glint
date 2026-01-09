
// Client-side Router for Glint
document.addEventListener('DOMContentLoaded', () => {
    let currentController = null;

    // Handle clicks
    document.addEventListener('click', (e) => {
        const link = e.target.closest('a');
        if (!link) return;

        const href = link.getAttribute('href');

        // Ignore external links, anchors, or special protocols
        if (!href ||
            href.startsWith('http') ||
            href.startsWith('//') ||
            href.startsWith('#') ||
            href.startsWith('mailto:') ||
            link.getAttribute('target') === '_blank') {
            return;
        }

        e.preventDefault();
        navigate(href);
    });

    // Handle Back/Forward
    window.addEventListener('popstate', (e) => {
        if (e.state && e.state.path) {
            loadPage(e.state.path, false);
        } else {
            loadPage(window.location.pathname, false);
        }
    });

    async function navigate(path) {
        if (path === window.location.pathname) return;

        history.pushState({ path }, '', path);
        await loadPage(path);
    }

    async function loadPage(path, scroll = true) {
        // Abort previous request if running
        if (currentController) {
            currentController.abort();
        }
        currentController = new AbortController();

        try {
            // Show loading state (optional, can be subtle)
            document.body.style.cursor = 'wait';

            const response = await fetch(path, {
                signal: currentController.signal
            });

            if (!response.ok) throw new Error(`Status ${response.status}`);

            const html = await response.text();

            // Parse HTML
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            // Swap Content
            const newContent = doc.querySelector('main.content');
            const newSidebar = doc.querySelector('aside.sidebar');
            const newTitle = doc.querySelector('title');

            if (newContent) {
                document.querySelector('main.content').replaceWith(newContent);
            }
            if (newSidebar) {
                // Preserve scroll position of sidebar if possible, or just replace
                // Replacing ensures active state is correct
                const oldSidebar = document.querySelector('aside.sidebar');
                const oldScroll = oldSidebar.querySelector('.sidebar-scrollable')?.scrollTop;

                oldSidebar.replaceWith(newSidebar);

                // Restore sidebar scroll
                if (oldScroll) {
                    const newScrollable = document.querySelector('.sidebar-scrollable');
                    if (newScrollable) newScrollable.scrollTop = oldScroll;
                }
            }
            if (newTitle) {
                document.title = newTitle.innerText;
            }

            // Re-initialize dynamic content
            if (typeof mermaid !== 'undefined') {
                mermaid.init(undefined, document.querySelectorAll('.mermaid'));
            }

            // Re-bind theme selector if needed (it's inline JS, so it should work, 
            // but the sidebar replacement re-adds the elements)

            if (scroll) {
                window.scrollTo(0, 0);
            }

        } catch (err) {
            if (err.name === 'AbortError') {
                // Ignore aborted requests
                return;
            }
            console.error('Navigation failed:', err);
            // Fallback to full reload on error
            // window.location.reload(); 
        } finally {
            document.body.style.cursor = '';
            currentController = null;
        }
    }
});
