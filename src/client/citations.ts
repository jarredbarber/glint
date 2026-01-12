/**
 * Citations - Client-side interactivity
 * 
 * Handles hover cards for citations and smooth scroll to bibliography.
 */

document.addEventListener('DOMContentLoaded', () => {
    setupCitationInteractions();
});

document.addEventListener('glint:navigated', () => {
    setupCitationInteractions();
});

function setupCitationInteractions() {
    const cites = document.querySelectorAll('.glint-cite');
    const cardsContainer = document.querySelector('.glint-cite-cards');

    if (!cardsContainer) return;

    cites.forEach(cite => {
        const el = cite as HTMLElement;
        if (el.dataset.initialized) return;
        el.dataset.initialized = 'true';

        const refId = el.dataset.ref;
        if (!refId) return;

        // Find the corresponding card
        const card = cardsContainer.querySelector(`.glint-cite-card[data-ref="${refId}"]`) as HTMLElement;

        // Click to scroll to bibliography entry
        el.addEventListener('click', (e) => {
            e.preventDefault();
            const target = document.getElementById(`ref-${refId}`);
            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                target.classList.add('highlight');
                setTimeout(() => target.classList.remove('highlight'), 2000);
            }
        });

        // Hover to show card
        if (card) {
            el.addEventListener('mouseenter', () => {
                // Position the card near the citation
                const rect = el.getBoundingClientRect();
                card.style.position = 'fixed';
                card.style.left = `${Math.min(rect.left, window.innerWidth - 340)}px`;
                card.style.top = `${rect.bottom + 8}px`;
                card.style.bottom = 'auto';
                card.style.right = 'auto';
                card.classList.add('visible');
            });

            el.addEventListener('mouseleave', () => {
                card.classList.remove('visible');
            });
        }
    });
}

export { };
