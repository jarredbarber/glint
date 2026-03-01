export { };

function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Client-side Share Management
 */

const overlay = document.getElementById('share-modal-overlay');
const shareList = document.getElementById('share-list');
const accessSelect = document.getElementById('share-access') as HTMLSelectElement;
const expirySelect = document.getElementById('share-expiry') as HTMLSelectElement;
const labelInput = document.getElementById('share-label') as HTMLInputElement;

// Get current page path dynamically (not cached) since client-side router updates data-path
function getCurrentPath(): string {
    return document.body.getAttribute('data-path') || (window.location.pathname.startsWith('/') ? window.location.pathname.substring(1) : window.location.pathname);
}

// Toast Helper
function showToast(message: string, type: 'success' | 'error' | 'info' = 'info') {
    let container = document.querySelector('.glint-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'glint-toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `glint-toast ${type}`;
    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.textContent = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
    const msg = document.createElement('span');
    msg.className = 'toast-message';
    msg.textContent = message;
    toast.appendChild(icon);
    toast.appendChild(msg);

    container.appendChild(toast);

    // Auto remove
    setTimeout(() => {
        toast.classList.add('out');
        toast.addEventListener('animationend', () => toast.remove());
    }, 3000);
}

window.openShareModal = async function () {
    if (!overlay) return;
    overlay.classList.add('open');
    await refreshShareList();
};

window.closeShareModal = function () {
    if (!overlay) return;
    overlay.classList.remove('open');
};

window.createShare = async function () {
    const access = accessSelect.value;
    const expirySeconds = parseInt(expirySelect.value);
    const label = labelInput.value.trim();

    let expiresAt = undefined;
    if (expirySeconds > 0) {
        expiresAt = Date.now() + (expirySeconds * 1000);
    }

    try {
        const res = await fetch('/api/shares', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                path: getCurrentPath(),
                access: access,
                expiresAt: expiresAt,
                label: label || undefined
            })
        });

        if (!res.ok) {
            const err = await res.json();
            showToast('Failed to create share: ' + (err.error || 'Unknown error'), 'error');
            return;
        }

        // Reset form
        labelInput.value = '';
        showToast('Share link created successfully', 'success');
        await refreshShareList();
    } catch (err) {
        console.error('Error creating share:', err);
        showToast('Failed to create share', 'error');
    }
};

window.revokeShare = async function (id: string) {
    if (!confirm('Are you sure you want to revoke this share link? It will stop working immediately.')) {
        return;
    }

    try {
        const res = await fetch(`/api/shares/${id}`, {
            method: 'DELETE'
        });

        if (!res.ok) {
            showToast('Failed to revoke share', 'error');
            return;
        }

        showToast('Link revoked', 'success');
        await refreshShareList();
    } catch (err) {
        console.error('Error revoking share:', err);
        showToast('Error revoking share', 'error');
    }
};

window.copyShareLink = function (id: string) {
    const url = window.location.origin + '/s/' + id;
    navigator.clipboard.writeText(url).then(() => {
        showToast('Link copied to clipboard', 'success');
    }).catch(() => {
        showToast('Failed to copy link', 'error');
    });
};

async function refreshShareList() {
    if (!shareList) return;

    try {
        const res = await fetch(`/api/shares?path=${encodeURIComponent(getCurrentPath())}`);
        if (!res.ok) throw new Error('Failed to fetch shares');

        const shares = await res.json();
        renderShares(shares);
    } catch (err) {
        shareList.innerHTML = '<div class="error">Failed to load shares</div>';
    }
}

function renderShares(shares: any[]) {
    if (!shareList) return;

    if (shares.length === 0) {
        shareList.innerHTML = '<div class="no-shares">No active share links for this page.</div>';
        return;
    }

    shareList.innerHTML = shares.map(share => {
        const expiryText = share.expiresAt
            ? 'Expires: ' + new Date(share.expiresAt).toLocaleString()
            : 'Never expires';

        const shareUrl = window.location.origin + '/s/' + share.id;

        return `
            <div class="share-item">
                <div class="share-item-header">
                    <span class="share-label-text">${escapeHtml(share.label || 'Untitled Share')}</span>
                    <span class="share-access-badge">${share.access}</span>
                </div>
                <div class="share-expiry-text" style="font-size: 0.75rem; color: var(--text-dim);">${expiryText}</div>
                <div class="share-url-container">
                    <input type="text" class="share-url-input" value="${shareUrl}" readonly onclick="this.select()">
                    <button class="copy-btn" data-id="${share.id}" onclick="window.copyShareLink('${share.id}')">Copy</button>
                    <button class="revoke-btn" onclick="window.revokeShare('${share.id}')">Revoke</button>
                </div>
            </div>
        `;
    }).join('');
}

// Close on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') window.closeShareModal();
});

declare global {
    interface Window {
        openShareModal: () => Promise<void>;
        closeShareModal: () => void;
        createShare: () => Promise<void>;
        revokeShare: (id: string) => Promise<void>;
        copyShareLink: (id: string) => void;
    }
}
