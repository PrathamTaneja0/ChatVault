import type { ExtractionProgress } from '../core/adapter';

export function createProgressBar(): {
  element: HTMLElement;
  update: (progress: ExtractionProgress) => void;
} {
  const container = document.createElement('div');
  container.className = 'cv-progress';
  container.innerHTML = `
    <div class="cv-progress-track">
      <div class="cv-progress-fill"></div>
    </div>
    <p class="cv-progress-text">Starting…</p>
  `;

  const fill = container.querySelector('.cv-progress-fill') as HTMLElement;
  const text = container.querySelector('.cv-progress-text') as HTMLElement;

  return {
    element: container,
    update(progress: ExtractionProgress) {
      fill.style.width = `${Math.min(progress.percent, 100)}%`;
      text.textContent = progress.message;
    },
  };
}

export const progressStyles = `
  .cv-progress { width: 100%; }
  .cv-progress-track {
    height: 6px;
    background: #e5e7eb;
    border-radius: 3px;
    overflow: hidden;
    margin-bottom: 12px;
  }
  .cv-progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #4F46E5, #059669);
    border-radius: 3px;
    width: 0%;
    transition: width 0.3s ease;
  }
  .cv-progress-text {
    font-size: 13px;
    color: #6b7280;
    margin: 0;
    text-align: center;
  }
`;
