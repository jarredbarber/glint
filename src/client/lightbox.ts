/**
 * Image Lightbox Client
 * Handles full-screen image viewing on click.
 */

(function () {
    const overlay = document.getElementById('lightbox-overlay');
    const lightboxImg = document.getElementById('lightbox-image') as HTMLImageElement;
    const caption = document.getElementById('lightbox-caption');
    const closeBtn = document.querySelector('.lightbox-close');

    if (!overlay || !lightboxImg || !caption) return;

    function openLightbox(src: string, alt: string) {
        lightboxImg.src = src;
        caption!.textContent = alt || '';
        overlay!.style.display = 'flex';
        document.body.style.overflow = 'hidden'; // Prevent scrolling
    }

    function closeLightbox() {
        overlay!.style.display = 'none';
        lightboxImg.src = '';
        document.body.style.overflow = ''; // Restore scrolling
    }

    // Attach click listeners to all images in the content area
    document.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;

        // Check if it's an image inside the content or a figure
        if (target.tagName === 'IMG' && (target.closest('.content') || target.closest('.image-figure'))) {
            // Don't trigger if we are inside the lightbox itself
            if (target.closest('#lightbox-overlay')) return;

            e.preventDefault();
            const img = target as HTMLImageElement;
            openLightbox(img.src, img.alt);
        }
    });

    // Close on background click
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay || e.target === closeBtn) {
            closeLightbox();
        }
    });

    // Close on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && overlay.style.display === 'flex') {
            closeLightbox();
        }
    });
})();
