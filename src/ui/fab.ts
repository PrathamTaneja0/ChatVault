import iconUrl from '../../public/icon/48.png';

const FAB_STYLES = `
  @keyframes cv-fab-glow {
    0%, 100% {
      box-shadow:
        0 4px 14px rgba(0, 0, 0, 0.5),
        0 0 0 0 rgba(255, 255, 255, 0);
    }
    50% {
      box-shadow:
        0 6px 20px rgba(0, 0, 0, 0.55),
        0 0 18px rgba(255, 255, 255, 0.07);
    }
  }
  @keyframes cv-fab-shimmer {
    0%, 100% { filter: brightness(1); }
    50% { filter: brightness(1.06); }
  }
  .cv-fab {
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 2147483646;
    width: 52px;
    height: 52px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition:
      transform 0.22s cubic-bezier(0.34, 1.4, 0.64, 1),
      filter 0.22s ease,
      box-shadow 0.22s ease;
    animation: cv-fab-glow 3.5s ease-in-out infinite, cv-fab-shimmer 3.5s ease-in-out infinite;
    font-family: system-ui, sans-serif;
  }
  .cv-fab-icon {
    width: 52px;
    height: 52px;
    display: block;
    border-radius: 50%;
    pointer-events: none;
    user-select: none;
    -webkit-user-drag: none;
  }
  .cv-fab:hover {
    animation: none;
    transform: scale(1.1);
    filter: brightness(1.18) saturate(1.05);
    box-shadow:
      0 8px 28px rgba(0, 0, 0, 0.6),
      0 0 24px rgba(255, 255, 255, 0.12);
  }
  .cv-fab:active {
    transform: scale(0.94);
    filter: brightness(0.95);
    transition-duration: 0.1s;
    box-shadow:
      0 2px 8px rgba(0, 0, 0, 0.45),
      inset 0 2px 6px rgba(0, 0, 0, 0.3);
  }
  .cv-fab-tooltip {
    position: absolute;
    right: 60px;
    background: #1f2937;
    color: white;
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 12px;
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s;
  }
  .cv-fab:hover .cv-fab-tooltip { opacity: 1; }
`;

export function createFab(onClick: () => void): HTMLElement {
  const style = document.createElement('style');
  style.textContent = FAB_STYLES;
  document.head.appendChild(style);

  const fab = document.createElement('button');
  fab.className = 'cv-fab';
  fab.setAttribute('aria-label', 'Export chat to PDF (Ctrl+Shift+E)');
  fab.title = 'Export chat to PDF';
  fab.innerHTML = `
    <span class="cv-fab-tooltip">Export to PDF</span>
    <img class="cv-fab-icon" src="${iconUrl}" width="52" height="52" alt="" draggable="false" />
  `;
  fab.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });

  return fab;
}

export function removeFab(fab: HTMLElement): void {
  fab.remove();
}
