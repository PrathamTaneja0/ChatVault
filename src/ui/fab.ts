// 128px source downscaled to 52px stays sharp on high-DPI displays;
// the 48px asset upscaled to 52px is what made the FAB blurry.
import iconUrl from '../../public/icon/128.png';

const FAB_STYLES = `
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
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
    transition:
      transform 0.18s cubic-bezier(0.34, 1.3, 0.64, 1),
      box-shadow 0.18s ease;
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
    transform: translateY(-2px) scale(1.05);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  }
  .cv-fab:active {
    transform: scale(0.95);
    transition-duration: 0.08s;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
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
  fab.setAttribute('aria-label', 'Export chat (Ctrl+Shift+E)');
  fab.title = 'Export chat';
  fab.innerHTML = `
    <span class="cv-fab-tooltip">Export chat</span>
    <img class="cv-fab-icon" src="${iconUrl}" width="52" height="52" alt="" draggable="false" />
  `;
  fab.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });

  return fab;
}
