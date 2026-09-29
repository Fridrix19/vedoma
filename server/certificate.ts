import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Service, ServiceRequest, Student, Tenant } from '../src/shared/types';

// Справка об обучении в настоящем PDF: текст (можно выделить и найти), встроенный шрифт с кириллицей,
// штамп электронной подписи и QR-код на страницу проверки подлинности.

const FONTS = join(dirname(fileURLToPath(import.meta.url)), 'assets', 'fonts');

const C = {
  ink: '#19283b',
  muted: '#5b6b7b',
  line: '#d5dee0',
  brand: '#0b5361',
  sign: '#1f4e9c',
  demo: '#b3261e',
};

export interface CertificateInput {
  req: ServiceRequest;
  student: Student;
  tenant: Tenant;
  service: Service;
  docId: string;
  verifyUrl: string;
  keyId: string;
  signer: string;
  signedAt: string;
}

const msk = (iso: string, withTime = false) =>
  new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit', month: '2-digit', year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(new Date(iso));

export async function buildCertificatePdf(x: CertificateInput): Promise<Buffer> {
  const { req, student: st, tenant, service: svc } = x;
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 56, bottom: 40, left: 70, right: 70 },
    info: {
      Title: `Справка ${x.docId}`,
      Author: `${svc.department} · ${tenant.name}`,
      Subject: svc.title,
      Creator: 'UniFlow',
      Keywords: `UniFlow, ${x.docId}, демо`,
    },
  });
  doc.registerFont('serif', join(FONTS, 'LiberationSerif-Regular.ttf'));
  doc.registerFont('serif-b', join(FONTS, 'LiberationSerif-Bold.ttf'));
  doc.registerFont('sans', join(FONTS, 'LiberationSans-Regular.ttf'));
  doc.registerFont('sans-b', join(FONTS, 'LiberationSans-Bold.ttf'));

  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const W = doc.page.width;
  const L = doc.page.margins.left;
  const TW = W - L - doc.page.margins.right;

  // Шапка вуза
  doc.rect(0, 0, W, 6).fill(C.brand);
  doc.fillColor(C.ink).font('serif-b').fontSize(14).text(tenant.name.toUpperCase(), L, 64, { width: TW, align: 'center' });
  doc.fillColor(C.muted).font('serif').fontSize(10.5)
    .text(`${st.facultyFull} · ${svc.department}`, { width: TW, align: 'center' });
  const hy = doc.y + 10;
  doc.moveTo(L, hy).lineTo(W - L, hy).lineWidth(0.8).strokeColor(C.line).stroke();

  // Заголовок
  doc.fillColor(C.ink).font('serif-b').fontSize(22).text('СПРАВКА', L, hy + 38, { width: TW, align: 'center', characterSpacing: 2 });
  doc.font('serif').fontSize(11.5).fillColor(C.muted)
    .text(`№ ${x.docId} от ${msk(x.signedAt)}`, { width: TW, align: 'center' });

  // Текст справки
  const body = { width: TW, align: 'justify' as const, lineGap: 5, indent: 32, paragraphGap: 10 };
  doc.moveDown(2.2).fillColor(C.ink).font('serif').fontSize(13);
  doc.text(
    `Настоящим подтверждается, что ${st.fullName} действительно является студентом(кой) ${st.course} курса ` +
      `очной формы обучения, группа ${st.group}, ${st.facultyFull.toLowerCase()} (${tenant.name}).`,
    body,
  );
  doc.text(`Справка выдана для предъявления по месту требования: ${req.values.place || '—'}.`, body);
  const reason = req.values.reason?.trim().replace(/\.$/, '');
  if (reason) doc.text(`Цель получения: ${reason[0].toLowerCase()}${reason.slice(1)}.`, body);
  doc.text(`Основание: заявка № ${req.id} от ${msk(req.createdAt)}, поданная через UniFlow в мессенджере MAX.`, body);

  // Должность
  doc.moveDown(1.6).font('serif').fontSize(12.5);
  const py = doc.y;
  doc.text(svc.department, L, py, { width: TW / 2 });
  doc.fillColor(C.muted).fontSize(11).text('подписано электронной подписью', L + TW / 2, py + 1, { width: TW / 2, align: 'right' });

  // Штамп электронной подписи + QR
  const sy = Math.max(doc.y + 34, 520);
  const sw = 318;
  const sh = 118;
  doc.roundedRect(L, sy, sw, sh, 8).lineWidth(1.4).strokeColor(C.sign).stroke();
  doc.fillColor(C.sign).font('sans-b').fontSize(9.5)
    .text('ДОКУМЕНТ ПОДПИСАН', L, sy + 12, { width: sw, align: 'center', characterSpacing: 0.6 })
    .text('ЭЛЕКТРОННОЙ ПОДПИСЬЮ', { width: sw, align: 'center', characterSpacing: 0.6 });
  doc.moveTo(L + 14, sy + 42).lineTo(L + sw - 14, sy + 42).lineWidth(0.6).strokeColor(C.sign).stroke();
  const row = (label: string, value: string, y: number) => {
    doc.font('sans').fontSize(8.5).fillColor(C.muted).text(label, L + 14, y, { width: 74 });
    doc.font('sans').fontSize(8.5).fillColor(C.ink).text(value, L + 88, y, { width: sw - 102 });
  };
  row('Подписант', x.signer, sy + 50);
  row('Ключ', `Ed25519 · ${x.keyId}`, sy + 66);
  row('Подписано', `${msk(x.signedAt, true)} (МСК)`, sy + 82);
  row('Документ', x.docId, sy + 98);

  const qr = await QRCode.toBuffer(x.verifyUrl, { margin: 1, width: 240, errorCorrectionLevel: 'M', color: { dark: C.ink } });
  const qx = W - L - 104;
  doc.image(qr, qx, sy, { width: 104 });
  doc.font('sans').fontSize(8).fillColor(C.muted)
    .text('Проверить подлинность —', qx - 20, sy + sh - 8, { width: 144, align: 'center' })
    .text('наведите камеру', { width: 144, align: 'center' });

  // Подвал
  const fy = doc.page.height - 78;
  doc.moveTo(L, fy).lineTo(W - L, fy).lineWidth(0.6).strokeColor(C.line).stroke();
  doc.font('sans-b').fontSize(8.5).fillColor(C.demo)
    .text('ДЕМОНСТРАЦИОННЫЙ ДОКУМЕНТ. Данные тестовые, юридической силы не имеет.', L, fy + 8, { width: TW, align: 'center' });
  doc.font('sans').fontSize(8).fillColor(C.muted)
    .text(`Сформирован UniFlow. Проверка подлинности: ${x.verifyUrl}`, { width: TW, align: 'center', link: x.verifyUrl });

  doc.end();
  return done;
}
