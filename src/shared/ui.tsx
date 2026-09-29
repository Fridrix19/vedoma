import { useCallback, useEffect, useRef, useState } from 'react';
import type { RequestStatus, ServiceRequest, StoredFile } from './types';
import { STATUS_LABEL } from './types';
import { isOverdue } from './api';
import { IconClose } from './icons';
import { dataUrlToBlob, downloadStoredFile } from './max';
import { formatSize } from './pdf';

export function StatusChip({ status, overdue }: { status: RequestStatus; overdue?: boolean }) {
  if (overdue) return <span className="chip chip--overdue">Просрочена</span>;
  return <span className={`chip chip--${status}`}>{STATUS_LABEL[status]}</span>;
}

export const RequestChip = ({ r }: { r: ServiceRequest }) => <StatusChip status={r.status} overdue={isOverdue(r)} />;

// ——— Тосты ———
export interface Toast {
  id: number;
  source?: string;
  text: string;
  tone?: 'dark' | 'light';
}

export function useToasts(ttl = 4200) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const push = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = ++seq.current;
      setToasts((prev) => [...prev.slice(-2), { ...t, id }]);
      window.setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), ttl);
    },
    [ttl],
  );
  return { toasts, push };
}

export function Toasts({ toasts, badge = 'Б' }: { toasts: Toast[]; badge?: string }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone === 'light' ? 'toast--light' : ''}`}>
          <span className="toast__badge">{badge}</span>
          <div>
            {t.source && <div className="toast__src">{t.source}</div>}
            <div className="toast__body">{t.text}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Следит за новыми элементами массива (по id) и вызывает cb для каждого нового. */
export function useOnNew<T extends { id: string }>(items: T[], cb: (item: T) => void) {
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!seen.current) {
      seen.current = new Set(items.map((i) => i.id));
      return;
    }
    for (const i of items) {
      if (!seen.current.has(i.id)) {
        seen.current.add(i.id);
        cb(i);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);
}

// ——— Просмотр документа ———
export function FileViewer({ file, onClose }: { file: StoredFile; onClose: () => void }) {
  const [note, setNote] = useState('');
  // Загруженный PDF без картинки-превью показываем встроенным просмотрщиком браузера
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  useEffect(() => {
    if (file.mime !== 'application/pdf' || file.previewUrl) return;
    if (file.url) {
      setPdfUrl(file.url);
      return;
    }
    if (!file.dataUrl) return;
    let url: string | null = null;
    try {
      url = URL.createObjectURL(dataUrlToBlob(file.dataUrl));
      setPdfUrl(url);
    } catch {
      /* ignore */
    }
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [file]);
  return (
    <div className="viewer" onClick={onClose}>
      <div className="viewer__card" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={file.name}>
        <div className="viewer__head">
          <div className="viewer__title">{file.name}</div>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <IconClose />
          </button>
        </div>
        <div className="viewer__body">
          {file.previewUrl || (file.url && file.mime.startsWith('image/')) ? (
            <img src={file.previewUrl ?? file.url} alt={`Предпросмотр ${file.name}`} />
          ) : pdfUrl ? (
            <iframe className="viewer__pdf" src={pdfUrl} title={file.name} />
          ) : (
            <div className="viewer__empty">
              Предпросмотр недоступен. {formatSize(file.size)}
            </div>
          )}
        </div>
        <div className="viewer__foot">
          <button
            className="btn btn--primary"
            onClick={async () => {
              const res = await downloadStoredFile(file);
              setNote(
                res === 'saved' ? 'Файл отправлен на сохранение.'
                  : res === 'declined' ? 'Сохранение отменено.'
                    : 'В демо сохраняются только файлы, созданные на стенде. Предпросмотр выше.',
              );
            }}
          >
            Скачать {file.mime === 'application/pdf' ? 'PDF' : 'файл'}
          </button>
          {note && <span style={{ fontSize: 13, color: 'var(--muted)', alignSelf: 'center' }}>{note}</span>}
        </div>
      </div>
    </div>
  );
}
