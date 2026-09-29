import type { Service, ServiceRequest, Student, StoredFile, Tenant } from './types';
import { ddmmyyyy } from './dates';

// Генерация справки в PDF без внешних библиотек:
// рисуем документ на canvas (кириллица без встраивания шрифтов) → JPEG → PDF с одной страницей.
// В проде справку формирует бэкенд по шаблону вуза; подпись/печать — ЭП или выдача лично.

const A4 = { w: 595.28, h: 841.89 }; // pt
const SCALE = 2; // px на pt

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number) {
  const words = text.split(' ');
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y);
      line = w;
      y += lh;
    } else line = test;
  }
  if (line) ctx.fillText(line, x, y);
  return y + lh;
}

function drawCertificate(req: ServiceRequest, st: Student, tenant: Tenant, svc: Service): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.round(A4.w * SCALE);
  c.height = Math.round(A4.h * SCALE);
  const ctx = c.getContext('2d')!;
  const u = (n: number) => n * SCALE;
  const font = (w: number, s: number) => `${w} ${u(s)}px "Segoe UI", Roboto, Arial, sans-serif`;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);

  // шапка
  ctx.fillStyle = '#0b5361';
  ctx.fillRect(0, 0, c.width, u(8));
  ctx.fillStyle = '#19283b';
  ctx.textAlign = 'center';
  ctx.font = font(700, 13);
  ctx.fillText(tenant.name.toUpperCase(), c.width / 2, u(70));
  ctx.font = font(400, 10);
  ctx.fillStyle = '#3d5163';
  ctx.fillText(`${st.facultyFull} · ${svc.department}`, c.width / 2, u(88));
  ctx.strokeStyle = '#d5dee0';
  ctx.lineWidth = u(0.8);
  ctx.beginPath();
  ctx.moveTo(u(60), u(104));
  ctx.lineTo(c.width - u(60), u(104));
  ctx.stroke();

  ctx.fillStyle = '#19283b';
  ctx.font = font(800, 20);
  ctx.fillText('СПРАВКА', c.width / 2, u(160));
  ctx.font = font(400, 11);
  ctx.fillText(`№ ${req.id} от ${ddmmyyyy(new Date().toISOString())}`, c.width / 2, u(180));

  ctx.textAlign = 'left';
  ctx.font = font(400, 12);
  let y = u(230);
  const x = u(70);
  const maxW = c.width - u(140);
  y = wrap(
    ctx,
    `Дана ${st.fullName} в том, что он(а) действительно является студентом(кой) ${st.course} курса, ` +
      `группы ${st.group}, ${st.facultyFull.toLowerCase()} (${tenant.name}), очной формы обучения.`,
    x, y, maxW, u(20),
  );
  y += u(10);
  const place = req.values.place || '—';
  y = wrap(ctx, `Справка выдана для предъявления по месту требования: ${place}.`, x, y, maxW, u(20));
  if (req.values.reason) y = wrap(ctx, `Комментарий студента: ${req.values.reason}.`, x, y, maxW, u(20));

  y += u(50);
  ctx.font = font(600, 12);
  ctx.fillText('Начальник учебного отдела', x, y);
  ctx.textAlign = 'right';
  ctx.fillText('______________ / подпись /', c.width - x, y);
  ctx.textAlign = 'left';

  // место для печати
  ctx.setLineDash([u(4), u(4)]);
  ctx.strokeStyle = '#9aa8b5';
  ctx.beginPath();
  ctx.arc(x + u(60), y + u(70), u(44), 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = font(400, 9);
  ctx.fillStyle = '#9aa8b5';
  ctx.textAlign = 'center';
  ctx.fillText('М. П.', x + u(60), y + u(74));

  // подвал
  ctx.textAlign = 'left';
  ctx.fillStyle = '#3d5163';
  ctx.font = font(400, 9);
  wrap(
    ctx,
    'Документ сформирован в UniFlow (демо). Оригинал с подписью и печатью выдаётся в учебном отделе ' +
      'либо заверяется электронной подписью вуза.',
    x, c.height - u(70), maxW, u(13),
  );
  ctx.fillStyle = '#0b5361';
  ctx.fillRect(0, c.height - u(8), c.width, u(8));
  return c;
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.split(',')[1];
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToDataUrl(bytes: Uint8Array, mime: string) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return `data:${mime};base64,${btoa(bin)}`;
}

/** Минимальный PDF 1.4: одна страница A4 с JPEG-картинкой на весь лист. */
function jpegToPdf(jpeg: Uint8Array, pxW: number, pxH: number): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (p: Uint8Array | string) => {
    const b = typeof p === 'string' ? enc.encode(p) : p;
    parts.push(b);
    length += b.length;
  };
  const obj = (n: number, body: string | (() => void)) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    if (typeof body === 'string') push(body);
    else body();
    push('\nendobj\n');
  };
  const content = `q ${A4.w} 0 0 ${A4.h} 0 0 cm /Im0 Do Q`;

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.w} ${A4.h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  obj(4, () => {
    push(`<< /Type /XObject /Subtype /Image /Width ${pxW} /Height ${pxH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
    push(jpeg);
    push('\nendstream');
  });
  obj(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);

  const xref = length;
  let x = 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 1; i <= 5; i++) x += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  push(x);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);

  const out = new Uint8Array(length);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function generateCertificatePdf(req: ServiceRequest, st: Student, tenant: Tenant, svc: Service): StoredFile {
  const canvas = drawCertificate(req, st, tenant, svc);
  const jpegUrl = canvas.toDataURL('image/jpeg', 0.82);
  const pdf = jpegToPdf(dataUrlToBytes(jpegUrl), canvas.width, canvas.height);
  // Превью поменьше, чтобы не раздувать хранилище
  const small = document.createElement('canvas');
  small.width = 595;
  small.height = 842;
  small.getContext('2d')!.drawImage(canvas, 0, 0, small.width, small.height);
  return {
    name: `spravka_${req.id}.pdf`,
    size: pdf.length,
    mime: 'application/pdf',
    dataUrl: bytesToDataUrl(pdf, 'application/pdf'),
    previewUrl: small.toDataURL('image/jpeg', 0.8),
  };
}

export async function fileToStored(file: File, maxInline = 1_500_000): Promise<StoredFile> {
  const stored: StoredFile = { name: file.name, size: file.size, mime: file.type || 'application/octet-stream' };
  if (file.size <= maxInline) {
    stored.dataUrl = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.onerror = () => rej(r.error);
      r.readAsDataURL(file);
    });
    if (stored.mime.startsWith('image/')) stored.previewUrl = stored.dataUrl;
  }
  return stored;
}

export const formatSize = (n: number) =>
  n < 1024 ? `${n} Б` : n < 1024 * 1024 ? `${Math.round(n / 1024)} КБ` : `${(n / 1024 / 1024).toFixed(1)} МБ`;
