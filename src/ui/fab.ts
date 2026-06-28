const FAB_STYLES = `
  .cv-fab {
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 2147483646;
    width: 52px;
    height: 52px;
    border-radius: 50%;
    background: radial-gradient(circle at 32% 28%, #4a4a4a 0%, #1a1a1a 48%, #0a0a0a 100%);
    border: 1px solid rgba(255, 255, 255, 0.08);
    cursor: pointer;
    box-shadow:
      0 4px 16px rgba(0, 0, 0, 0.55),
      inset 0 1px 0 rgba(255, 255, 255, 0.14);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.2s, box-shadow 0.2s;
    font-family: system-ui, sans-serif;
  }
  .cv-fab:hover {
    transform: scale(1.08);
    box-shadow:
      0 6px 24px rgba(0, 0, 0, 0.65),
      inset 0 1px 0 rgba(255, 255, 255, 0.2);
  }
  .cv-fab svg {
    width: 24px;
    height: 24px;
    fill: white;
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
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 2l5 5h-5V4zM8 13h8v2H8v-2zm0 4h5v2H8v-2z"/>
    </svg>
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
