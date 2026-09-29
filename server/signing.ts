import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FileSignature } from '../src/shared/types';
import { uid } from '../src/shared/domain';
import { config } from './config';

// Электронная подпись документов вуза (демо).
// Ключ Ed25519 создаётся при первом запуске и хранится в data/signing-key.pem (не в репозитории).
// Подписывается SHA-256 готового PDF: любое изменение файла ломает проверку.
// В реальном вузе здесь — усиленная квалифицированная ЭП (ГОСТ Р 34.10-2012, КриптоПро), интерфейс тот же.

const keyFile = join(config.dataDir, 'signing-key.pem');

let privateKey: KeyObject;
if (existsSync(keyFile)) {
  privateKey = createPrivateKey(readFileSync(keyFile));
} else {
  privateKey = generateKeyPairSync('ed25519').privateKey;
  writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
}
const publicKey = createPublicKey(privateKey);

/** Отпечаток открытого ключа: 16 hex-символов, группами по 4. */
export const keyId = createHash('sha256')
  .update(publicKey.export({ type: 'spki', format: 'der' }))
  .digest('hex')
  .slice(0, 16)
  .toUpperCase()
  .replace(/(.{4})(?!$)/g, '$1 ');

export const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

export const sha256 = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');

/** Номер документа: VD-<заявка>-<6 случайных символов>. Он же ключ страницы проверки. */
export const newDocId = (requestId: number) => `VD-${requestId}-${uid(6).toUpperCase()}`;

export function signFile(buf: Buffer, docId: string, signer: string, signedAt = new Date().toISOString()): FileSignature {
  const hash = sha256(buf);
  const sig = sign(null, Buffer.from(hash, 'hex'), privateKey).toString('base64');
  return { docId, alg: 'Ed25519', keyId, sha256: hash, sig, signedAt, signer };
}

/** Проверка: файл не изменён и подпись сделана ключом этого вуза. */
export function verifyFile(buf: Buffer | null, s: FileSignature) {
  const hashOk = buf ? sha256(buf) === s.sha256 : false;
  let sigOk = false;
  try {
    sigOk = verify(null, Buffer.from(s.sha256, 'hex'), publicKey, Buffer.from(s.sig, 'base64'));
  } catch {
    sigOk = false;
  }
  return { hashOk, sigOk, valid: hashOk && sigOk && s.keyId === keyId };
}
