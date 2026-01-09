
document.addEventListener('DOMContentLoaded', () => {
    // 1. Paste Event Listener
    document.addEventListener('paste', async (e) => {
        const items = (e.clipboardData || e.originalEvent.clipboardData).items;
        let blob = null;

        for (const item of items) {
            if (item.type.indexOf('image') === 0) {
                blob = item.getAsFile();
                break;
            }
        }

        if (blob) {
            e.preventDefault();
            await uploadImage(blob);
        }
    });

    // 2. Context Menu (Simple "Paste Image" overlay)
    // Since we can't easily modify the native context menu, we'll create a custom overlay
    // when right-clicking on the content area.
    const contentArea = document.querySelector('main.content');
    if (contentArea) {
        contentArea.addEventListener('contextmenu', async (e) => {
            // Check if clipboard has image (requires permission in some browsers, 
            // but we can at least offer the option and fail gracefully or prompt)

            // For now, let's just log or show a custom menu if we want to be fancy.
            // But standard behavior: users expect Ctrl+V. 
            // If we want a context menu item, we need a custom UI.
            // Let's implement a simple custom menu.

            if (!e.ctrlKey && !e.metaKey) { // Allow default with modifier?
                e.preventDefault();
                showContextMenu(e.clientX, e.clientY);
            }
        });
    }

    function showContextMenu(x, y) {
        // Remove existing
        const existing = document.querySelector('.glint-context-menu');
        if (existing) existing.remove();

        const menu = document.createElement('div');
        menu.className = 'glint-context-menu';
        menu.style.position = 'fixed';
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
        menu.style.background = 'var(--bg-color, #fff)';
        menu.style.border = '1px solid var(--border-color, #ccc)';
        menu.style.padding = '5px 0';
        menu.style.zIndex = '1000';
        menu.style.borderRadius = '4px';
        menu.style.boxShadow = '0 2px 10px rgba(0,0,0,0.1)';

        const item = document.createElement('div');
        item.innerText = 'Paste Image';
        item.style.padding = '8px 16px';
        item.style.cursor = 'pointer';
        item.style.fontSize = '14px';
        item.style.color = 'var(--text-color, #333)';

        item.onmouseenter = () => item.style.background = 'var(--hover-bg, #eee)';
        item.onmouseleave = () => item.style.background = 'transparent';

        item.onclick = async () => {
            menu.remove();
            try {
                const clipboardItems = await navigator.clipboard.read();
                for (const item of clipboardItems) {
                    const imageType = item.types.find(type => type.startsWith('image/'));
                    if (imageType) {
                        const blob = await item.getType(imageType);
                        await uploadImage(blob);
                        return;
                    }
                }
                alert('No image found in clipboard');
            } catch (err) {
                console.error(err);
                alert('Unable to access clipboard. Please use Ctrl+V/Cmd+V to paste.');
            }
        };

        menu.appendChild(item);
        document.body.appendChild(menu);

        // Close on click outside
        setTimeout(() => {
            document.addEventListener('click', function cleanup() {
                menu.remove();
                document.removeEventListener('click', cleanup);
            }, { once: true });
        }, 0);
    }

    async function uploadImage(blob) {
        // Show loading state
        const originalCursor = document.body.style.cursor;
        document.body.style.cursor = 'wait';

        try {
            // Determine path
            let path = window.location.pathname;
            // Remove leading slash
            path = path.substring(1);
            // If empty, let API handle it (resolve to index)

            const formData = new FormData();
            formData.append('file', blob, 'pasted-image.png');
            formData.append('articlePath', path);

            // 1. Upload
            const upRes = await fetch('/api/upload', { method: 'POST', body: formData });
            if (!upRes.ok) {
                const err = await upRes.json();
                throw new Error(err.error || 'Upload failed');
            }
            const { url } = await upRes.json();

            // 2. Append to Source
            const sourceRes = await fetch(`/api/source/${path}`);
            if (!sourceRes.ok) throw new Error('Failed to get source');
            const { content } = await sourceRes.json();

            // Append image markdown
            // We'll add a newline if needed
            const newContent = content.trimEnd() + `\n\n![Image](${url})\n`;

            // 3. Save
            const saveRes = await fetch('/api/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path, content: newContent })
            });
            if (!saveRes.ok) throw new Error('Failed to save content');

            // 4. Reload to show change
            // Using window.location.reload() relies on server rendering properties
            window.location.reload();

        } catch (err) {
            console.error(err);
            alert(`Error uploading image: ${err.message}`);
        } finally {
            document.body.style.cursor = originalCursor;
        }
    }
});
