import type { SVGProps } from 'react';

// Иконки таббара и поиска — пути из макета Figma (цвет через currentColor
// для активного/неактивного состояния). Остальные нарисованы в той же сетке 20×20, stroke 1.67.

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size = 20): SVGProps<SVGSVGElement> => ({
  width: size, height: size, viewBox: '0 0 20 20', fill: 'none', 'aria-hidden': true,
});

export const IconSearch = ({ size = 18, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 18 18" fill="none" aria-hidden {...p}>
    <path d="M8.25 13.5C11.1495 13.5 13.5 11.1495 13.5 8.25C13.5 5.35051 11.1495 3 8.25 3C5.35051 3 3 5.35051 3 8.25C3 11.1495 5.35051 13.5 8.25 13.5Z" stroke="currentColor" strokeWidth="1.5" />
    <path d="M15 15L12.375 12.375" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

export const IconServices = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M7.08333 2.5H3.75C3.05964 2.5 2.5 3.05964 2.5 3.75V7.08333C2.5 7.77369 3.05964 8.33333 3.75 8.33333H7.08333C7.77369 8.33333 8.33333 7.77369 8.33333 7.08333V3.75C8.33333 3.05964 7.77369 2.5 7.08333 2.5Z" stroke="currentColor" strokeWidth="1.66667" />
    <path d="M16.25 2.5H12.9167C12.2263 2.5 11.6667 3.05964 11.6667 3.75V7.08333C11.6667 7.77369 12.2263 8.33333 12.9167 8.33333H16.25C16.9404 8.33333 17.5 7.77369 17.5 7.08333V3.75C17.5 3.05964 16.9404 2.5 16.25 2.5Z" stroke="currentColor" strokeWidth="1.66667" />
    <path d="M7.08333 11.6667H3.75C3.05964 11.6667 2.5 12.2263 2.5 12.9167V16.25C2.5 16.9404 3.05964 17.5 3.75 17.5H7.08333C7.77369 17.5 8.33333 16.9404 8.33333 16.25V12.9167C8.33333 12.2263 7.77369 11.6667 7.08333 11.6667Z" stroke="currentColor" strokeWidth="1.66667" />
    <path d="M16.25 11.6667H12.9167C12.2263 11.6667 11.6667 12.2263 11.6667 12.9167V16.25C11.6667 16.9404 12.2263 17.5 12.9167 17.5H16.25C16.9404 17.5 17.5 16.9404 17.5 16.25V12.9167C17.5 12.2263 16.9404 11.6667 16.25 11.6667Z" stroke="currentColor" strokeWidth="1.66667" />
  </svg>
);

export const IconRequests = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M6.66667 5H17.5M6.66667 10H17.5M6.66667 15H17.5" stroke="currentColor" strokeWidth="1.66667" />
    <path d="M3.33333 6C3.88562 6 4.33333 5.55229 4.33333 5C4.33333 4.44772 3.88562 4 3.33333 4C2.78105 4 2.33333 4.44772 2.33333 5C2.33333 5.55229 2.78105 6 3.33333 6Z" fill="currentColor" />
    <path d="M3.33333 11C3.88562 11 4.33333 10.5523 4.33333 10C4.33333 9.44772 3.88562 9 3.33333 9C2.78105 9 2.33333 9.44772 2.33333 10C2.33333 10.5523 2.78105 11 3.33333 11Z" fill="currentColor" />
    <path d="M3.33333 16C3.88562 16 4.33333 15.5523 4.33333 15C4.33333 14.4477 3.88562 14 3.33333 14C2.78105 14 2.33333 14.4477 2.33333 15C2.33333 15.5523 2.78105 16 3.33333 16Z" fill="currentColor" />
  </svg>
);

export const IconProfile = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M10 9.33333C11.4728 9.33333 12.6667 8.13943 12.6667 6.66667C12.6667 5.19391 11.4728 4 10 4C8.52724 4 7.33333 5.19391 7.33333 6.66667C7.33333 8.13943 8.52724 9.33333 10 9.33333Z" stroke="currentColor" strokeWidth="1.66667" />
    <path d="M4.58333 15.8333C5.58333 13.3333 7.58333 12.0833 10 12.0833C12.4167 12.0833 14.4167 13.3333 15.4167 15.8333" stroke="currentColor" strokeWidth="1.66667" />
  </svg>
);

const S = { stroke: 'currentColor', strokeWidth: 1.67, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export const IconUpload = ({ size = 16, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M10 13V3.5M6 7.5l4-4 4 4M3.5 13.5v2A1.5 1.5 0 0 0 5 17h10a1.5 1.5 0 0 0 1.5-1.5v-2" {...S} /></svg>
);
export const IconFile = ({ size = 20, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M11.5 2.5H5.5A1.5 1.5 0 0 0 4 4v12a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 16 16V7l-4.5-4.5Z" {...S} /><path d="M11.5 2.5V7H16" {...S} /></svg>
);
export const IconCheck = ({ size = 16, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M4 10.5l4 4 8-9" {...S} strokeWidth={2} /></svg>
);
export const IconClose = ({ size = 16, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M5 5l10 10M15 5L5 15" {...S} /></svg>
);
export const IconGrip = ({ size = 14, ...p }: P) => (
  <svg {...base(size)} {...p}>{[5, 10, 15].map((y) => [7.5, 12.5].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.3" fill="currentColor" />))}</svg>
);
export const IconPlus = ({ size = 16, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M10 4v12M4 10h12" {...S} strokeWidth={2} /></svg>
);
export const IconBell = ({ size = 16, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M5 8a5 5 0 0 1 10 0c0 5 2 6 2 6H3s2-1 2-6Z" {...S} /><path d="M8.5 17a1.7 1.7 0 0 0 3 0" {...S} /></svg>
);

// Иконки услуг (выбор в конструкторе)
export const SERVICE_ICONS: Record<string, { label: string; el: (p: P) => JSX.Element }> = {
  doc: { label: 'Документ', el: (p) => <IconFile {...p} /> },
  pause: {
    label: 'Пауза',
    el: ({ size = 20, ...p }) => <svg {...base(size)} {...p}><circle cx="10" cy="10" r="7.5" {...S} /><path d="M8.3 7v6M11.7 7v6" {...S} /></svg>,
  },
  aid: {
    label: 'Поддержка',
    el: ({ size = 20, ...p }) => <svg {...base(size)} {...p}><path d="M10 16.5s-6.5-3.8-6.5-8.3A3.7 3.7 0 0 1 10 6a3.7 3.7 0 0 1 6.5 2.2c0 4.5-6.5 8.3-6.5 8.3Z" {...S} /></svg>,
  },
  calendar: {
    label: 'Запись',
    el: ({ size = 20, ...p }) => <svg {...base(size)} {...p}><rect x="3" y="4.5" width="14" height="12.5" rx="2" {...S} /><path d="M3 8.5h14M7 2.5v3M13 2.5v3" {...S} /></svg>,
  },
  pass: {
    label: 'Пропуск',
    el: ({ size = 20, ...p }) => <svg {...base(size)} {...p}><rect x="2.5" y="4.5" width="15" height="11" rx="2" {...S} /><circle cx="7.5" cy="9.5" r="1.8" {...S} /><path d="M5 13.2c.5-1 1.4-1.5 2.5-1.5s2 .5 2.5 1.5M12 8.5h3M12 11.5h3" {...S} /></svg>,
  },
  home: {
    label: 'Общежитие',
    el: ({ size = 20, ...p }) => <svg {...base(size)} {...p}><path d="M3 9l7-5.5L17 9v7.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9Z" {...S} /><path d="M8 17.5v-5h4v5" {...S} /></svg>,
  },
};

export const ServiceIcon = ({ name, ...p }: P & { name: string }) => {
  const I = SERVICE_ICONS[name]?.el ?? SERVICE_ICONS.doc.el;
  return <I {...p} />;
};
