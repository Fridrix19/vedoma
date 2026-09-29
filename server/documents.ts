import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { DB, StoredFile } from '../src/shared/types';
import { DomainError } from '../src/shared/domain';
import { buildCertificatePdf } from './certificate';
import { config } from './config';
import { pathFromUrl, saveBuffer } from './files';
import { keyId, newDocId, signFile, verifyFile } from './signing';

// Выдача документов: справка по шаблону → PDF → подпись → превью. Проверка подлинности по номеру документа.

const run = promisify(execFile);

/** Публичная ссылка на страницу проверки (в QR-коде и в боте). */
export const verifyUrl = (docId: string) => `${config.publicUrl || `http://localhost:${config.port}`}/verify/${docId}`;

/** PNG первой страницы — чтобы справку было видно в Mini App (встроенный просмотр PDF есть не везде). */
async function makePreview(pdfPath: string): Promise<string | undefined> {
  const out = join(dirname(pdfPath), 'preview');
  try {
    await run('pdftoppm', ['-png', '-r', '70', '-singlefile', '-f', '1', '-l', '1', pdfPath, out], { timeout: 15000 });
  } catch {
    return undefined; // pdftoppm нет (например, Windows без poppler) — будет встроенный просмотр PDF
  }
  if (!existsSync(`${out}.png`)) return undefined;
  const id = /files[\\/]([a-z0-9]{16})[\\/]/.exec(pdfPath)?.[1];
  return id ? `/files/${id}/preview.png` : undefined;
}

const signerFor = (d: DB, tenantId: string, department: string) =>
  `${department} · ${d.tenants.find((t) => t.id === tenantId)?.name ?? ''}`;

/** Справка по шаблону вуза: настоящий PDF с текстом, штампом ЭП и QR. */
export async function issueCertificate(d: DB, requestId: number): Promise<StoredFile> {
  const req = d.requests.find((r) => r.id === requestId);
  if (!req) throw new DomainError(`Заявка №${requestId} не найдена`);
  const service = d.services.find((s) => s.id === req.serviceId)!;
  const student = d.students.find((s) => s.id === req.studentId)!;
  const tenant = d.tenants.find((t) => t.id === req.tenantId)!;
  if (service.resultType !== 'pdf') throw new DomainError('Шаблон справки есть только у услуг с результатом «PDF».');
  const docId = newDocId(requestId);
  const signer = signerFor(d, req.tenantId, service.department);
  const signedAt = new Date().toISOString();
  const pdf = await buildCertificatePdf({ req, student, tenant, service, docId, verifyUrl: verifyUrl(docId), keyId, signer, signedAt });
  const file = saveBuffer(`spravka_${requestId}.pdf`, 'application/pdf', pdf);
  file.signature = signFile(pdf, docId, signer, signedAt);
  const p = pathFromUrl(file.url);
  if (p) file.previewUrl = await makePreview(p);
  return file;
}

/** Файл, загруженный сотрудником: PDF тоже подписываем (подпись отдельно от файла) и делаем превью. */
export async function signUploaded(d: DB, requestId: number, file: StoredFile): Promise<StoredFile> {
  if (file.mime !== 'application/pdf') return file;
  const req = d.requests.find((r) => r.id === requestId);
  const service = d.services.find((s) => s.id === req?.serviceId);
  const p = pathFromUrl(file.url);
  if (!req || !service || !p) return file;
  const signed = { ...file, signature: signFile(readFileSync(p), newDocId(requestId), signerFor(d, req.tenantId, service.department)) };
  const preview = await makePreview(p);
  return preview ? { ...signed, previewUrl: preview } : signed;
}

/** Проверка по номеру документа (страница из QR-кода). */
export function verifyDocument(d: DB, docId: string) {
  const req = d.requests.find((r) => r.result?.signature?.docId === docId);
  const file = req?.result;
  if (!req || !file?.signature) return null;
  const p = pathFromUrl(file.url);
  const check = verifyFile(p ? readFileSync(p) : null, file.signature);
  const st = d.students.find((s) => s.id === req.studentId);
  const svc = d.services.find((s) => s.id === req.serviceId);
  const [last = '', first = '', middle = ''] = (st?.fullName ?? '').split(' ');
  return {
    ...check,
    docId,
    document: svc?.title ?? 'Документ',
    fileName: file.name,
    requestId: req.id,
    // Персональные данные на публичной странице — только инициалы
    issuedTo: `${last} ${first ? `${first[0]}.` : ''}${middle ? ` ${middle[0]}.` : ''}`.trim(),
    issuer: file.signature.signer,
    signedAt: file.signature.signedAt,
    alg: file.signature.alg,
    keyId: file.signature.keyId,
    sha256: file.signature.sha256,
  };
}
