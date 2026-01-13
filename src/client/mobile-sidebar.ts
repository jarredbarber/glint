/**
 * Mobile Sidebar Client
 * Handles opening/closing the sidebar on mobile devices.
 */

(function () {
    const toggleBtn = document.querySelector('.mobile-toggle');
    const overlay = document.querySelector('.mobile-overlay');
    const sidebar = document.querySelector('.sidebar');

    if (!toggleBtn || !overlay || !sidebar) return;

    function closeSidebar() {
        document.body.classList.remove('sidebar-open');
    }

    function toggleSidebar() {
        document.body.classList.toggle('sidebar-open');
    }

    // Toggle button click
    toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleSidebar();
    });

    // Close on overlay click
    overlay.addEventListener('click', () => {
        closeSidebar();
    });

    // Close when clicking a link in the sidebar (optional, but good UX)
    sidebar.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.tagName === 'A') {
            closeSidebar();
        }
    });

    // Close on escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && document.body.classList.contains('sidebar-open')) {
            closeSidebar();
        }
    });
})();
