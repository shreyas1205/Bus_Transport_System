// Global micro-interactions: button ripple + cursor spotlight on glass cards.
// Pure DOM event delegation, so pages need no changes. Respects reduced motion.
const BUTTONS = '.primary, .secondary, .danger-button, .ref-signin, .danger-soft';
const CARDS = '.panel, .stat-card, .ops-stat, .route-card, .vehicle-card, .fleet-premium-card, .pass-card, .complaint-stat, .boarding-stat-card, .fee-stat, .dashboard-hero, .ref-auth-card';

export function installMicroInteractions() {
  if (typeof window === 'undefined' || window.__nvgInteractions) return;
  window.__nvgInteractions = true;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  document.addEventListener('pointerdown', event => {
    if (reduced) return;
    const button = event.target.closest?.(BUTTONS);
    if (!button || button.disabled) return;
    const rect = button.getBoundingClientRect();
    const ripple = document.createElement('span');
    ripple.className = 'nvg-ripple';
    ripple.style.left = `${event.clientX - rect.left}px`;
    ripple.style.top = `${event.clientY - rect.top}px`;
    button.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
  }, { passive: true });

  let frame = 0;
  document.addEventListener('pointermove', event => {
    if (reduced || event.pointerType !== 'mouse' || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const card = event.target.closest?.(CARDS);
      if (!card) return;
      if (!card.classList.contains('nvg-spot')) card.classList.add('nvg-spot');
      const rect = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${event.clientX - rect.left}px`);
      card.style.setProperty('--my', `${event.clientY - rect.top}px`);
    });
  }, { passive: true });
}
