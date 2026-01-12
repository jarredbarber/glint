
// Client-side Router for Glint
document.addEventListener('DOMContentLoaded', () => {
    let currentController: AbortController | null = null;

    // Handle clicks
    document.addEventListener('click', (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        const link = target.closest('a');
        if (!link) return;

        const href = link.getAttribute('href');

        // Ignore external links, anchors, or special protocols
        if (!href ||
            href.startsWith('http') ||
            href.startsWith('//') ||
            href.startsWith('mailto:') ||
            link.getAttribute('data-router') === 'false' ||
            link.getAttribute('target') === '_blank') {
            return;
        }

        // Handle pure anchor links (same page navigation)
        if (href.startsWith('#')) {
            return;
        }

        const url = new URL(href, window.location.origin);
        if (url.pathname === window.location.pathname) {
            return;
        }

        e.preventDefault();
        navigate(href);
    });

    let lastLoadedPathname = window.location.pathname;

    window.addEventListener('popstate', (e: PopStateEvent) => {
        const currentPathname = window.location.pathname;

        if (currentPathname !== lastLoadedPathname) {
            lastLoadedPathname = currentPathname;
            if (e.state && e.state.path) {
                loadPage(e.state.path, false);
            } else {
                loadPage(currentPathname, false);
            }
        }
    });

    async function navigate(path: string) {
        if (path === window.location.pathname) return;

        history.pushState({ path }, '', path);
        await loadPage(path);
    }

    async function loadPage(path: string, scroll = true) {
        if (currentController) {
            currentController.abort();
        }
        currentController = new AbortController();

        try {
            document.body.style.cursor = 'wait';

            const response = await fetch(path, {
                signal: currentController.signal
            });

            if (!response.ok) throw new Error(`Status ${response.status}`);

            const html = await response.text();

            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            const newContent = doc.querySelector('main.content');
            const newSidebar = doc.querySelector('aside.sidebar');
            const newTitle = doc.querySelector('title');

            if (newContent) {
                const mainContent = document.querySelector('main.content');
                if (mainContent) mainContent.replaceWith(newContent);
            }
            if (newSidebar) {
                const oldSidebar = document.querySelector('aside.sidebar');
                if (oldSidebar) {
                    const oldScroll = oldSidebar.querySelector('.sidebar-scrollable')?.scrollTop;
                    oldSidebar.replaceWith(newSidebar);
                    if (oldScroll) {
                        const newScrollable = document.querySelector('.sidebar-scrollable');
                        if (newScrollable) newScrollable.scrollTop = oldScroll;
                    }
                }
            }
            if (newTitle) {
                document.title = newTitle.innerText;
            }

            // Re-initialize dynamic content
            const mermaid = (window as any).mermaid;
            if (typeof mermaid !== 'undefined') {
                mermaid.init(undefined, document.querySelectorAll('.mermaid'));
            }

            if (scroll) {
                const hash = window.location.hash;
                if (hash) {
                    const target = document.querySelector(hash);
                    if (target) {
                        target.scrollIntoView({ behavior: 'auto', block: 'start' });
                        target.classList.add('highlight-line');
                        setTimeout(() => target.classList.remove('highlight-line'), 2000);
                        return;
                    }
                }
                window.scrollTo(0, 0);
            }


            document.dispatchEvent(new CustomEvent('glint:navigated'));

        } catch (err: any) {
            if (err.name === 'AbortError') {
                return;
            }
            console.error('Navigation failed:', err);
        } finally {
            document.body.style.cursor = '';
            currentController = null;
        }
    }
});
