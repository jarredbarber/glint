/**
 * Command Palette Client
 * Handles Cmd+K / Ctrl+K search and execution of common application actions.
 */

(function () {
    const overlay = document.getElementById('command-palette-overlay');
    const input = document.getElementById('command-input') as HTMLInputElement;
    const results = document.getElementById('command-results');

    if (!overlay || !input || !results) return;

    let selectedIndex = 0;
    let commands: any[] = [];

    // Define commands
    const getCommands = () => [
        { title: 'Go to Home', desc: 'Navigate to home page', action: () => window.location.href = '/' },
        { title: 'Go to Task View', desc: 'Managed tracked tasks', action: () => window.location.href = '/tasks' },
        { title: 'Go to Journal View', desc: 'See dated notes timeline', action: () => window.location.href = '/journal' },
        {
            title: 'Toggle Theme', desc: 'Switch light/dark mode', action: () => {
                const themes = ['nord', 'everforest-dark', 'gruvbox-dark', 'catppuccin-mocha', 'solarized-light', 'tokyo-night', 'rose-pine', 'dracula', 'one-dark', 'kanagawa', 'github-light', 'default'];
                const current = document.body.className.split(' ').find(c => themes.includes(c)) || 'nord';
                const next = themes[(themes.indexOf(current) + 1) % themes.length];

                fetch('/api/theme', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ theme: next })
                }).then(() => window.location.reload());
            }
        },
        { title: 'Print Page', desc: 'Export as PDF', action: () => window.print() },
        { title: 'Share Page', desc: 'Create shareable link', action: () => (window as any).openShareModal && (window as any).openShareModal() },
        {
            title: 'Edit Page', desc: 'Toggle editor', action: () => {
                const editBtn = document.querySelector('.code-edit-btn') as HTMLElement;
                if (editBtn) editBtn.click();
            }
        }
    ];

    function openPalette() {
        commands = getCommands();
        overlay!.style.display = 'flex';
        input!.value = '';
        input!.focus();
        renderResults();
    }

    function closePalette() {
        overlay!.style.display = 'none';
    }

    function renderResults() {
        const query = input.value.toLowerCase();
        const filtered = commands.filter(c =>
            c.title.toLowerCase().includes(query) ||
            c.desc.toLowerCase().includes(query)
        );

        results!.innerHTML = filtered.map((c, i) => {
            return `
            <div class="command-item ${i === selectedIndex ? 'selected' : ''}" data-index="${i}">
                <div class="command-content">
                    <div class="command-title">${c.title}</div>
                    <div class="command-desc">${c.desc}</div>
                </div>
            </div>`;
        }).join('');

        // Reset index if out of bounds
        if (selectedIndex >= filtered.length) selectedIndex = 0;
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
            e.preventDefault();
            if (overlay.style.display === 'flex') closePalette();
            else openPalette();
        }

        if (overlay.style.display !== 'flex') return;

        if (e.key === 'Escape') closePalette();

        const filteredCount = results.children.length;
        if (filteredCount === 0) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedIndex = (selectedIndex + 1) % filteredCount;
            renderResults();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedIndex = (selectedIndex - 1 + filteredCount) % filteredCount;
            renderResults();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const visibleCmds = commands.filter(c =>
                c.title.toLowerCase().includes(input.value.toLowerCase()) ||
                c.desc.toLowerCase().includes(input.value.toLowerCase())
            );
            if (visibleCmds[selectedIndex]) {
                visibleCmds[selectedIndex].action();
                closePalette();
            }
        }
    });

    input.addEventListener('input', () => {
        selectedIndex = 0;
        renderResults();
    });

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closePalette();
    });

    // Delegate clicks on items
    results.addEventListener('click', (e) => {
        const item = (e.target as HTMLElement).closest('.command-item') as HTMLElement;
        if (item) {
            const idx = parseInt(item.dataset.index || '0');
            const visibleCmds = commands.filter(c =>
                c.title.toLowerCase().includes(input.value.toLowerCase()) ||
                c.desc.toLowerCase().includes(input.value.toLowerCase())
            );
            if (visibleCmds[idx]) {
                visibleCmds[idx].action();
                closePalette();
            }
        }
    });
})();
