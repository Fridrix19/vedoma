import type { BotMessage, Service, ServiceRequest, Student } from './types';
import { ddmm } from './dates';

// Тексты исходящих сообщений бота MAX. Бэкенд бота использует ровно их
// (Bot API: POST /messages с inline-клавиатурой). Кнопка open_request —
// это кнопка открытия Mini App с start_param=req_<id>.

type Msg = Omit<BotMessage, 'id' | 'at'>;

const shortName = (s: Student) => {
  const [last, first, middle] = s.fullName.split(' ');
  return `${last} ${first?.[0] ?? ''}.${middle ? ` ${middle[0]}.` : ''}`;
};

export const botTexts = {
  accepted: (r: ServiceRequest, svc: Service): Msg => ({
    audience: 'student', tenantId: r.tenantId, studentId: r.studentId, requestId: r.id,
    text: `Заявка №${r.id} принята.\n${svc.title}\nСтатус: Принято. Срок: до ${ddmm(r.deadline)}.`,
    buttons: [{ label: 'Открыть заявку', action: 'open_request' }],
  }),
  staffNew: (r: ServiceRequest, svc: Service, st: Student): Msg => ({
    audience: 'staff', tenantId: r.tenantId, requestId: r.id,
    text: `Новая заявка №${r.id}\n${svc.title} · ${shortName(st)} · ${st.group}`,
    buttons: [{ label: 'Открыть заявку', action: 'open_panel' }],
  }),
  inProgress: (r: ServiceRequest): Msg => ({
    audience: 'student', tenantId: r.tenantId, studentId: r.studentId, requestId: r.id,
    text: `Заявка №${r.id}: статус «В работе».`,
    buttons: [{ label: 'Открыть заявку', action: 'open_request' }],
  }),
  needInfo: (r: ServiceRequest, comment: string): Msg => ({
    audience: 'student', tenantId: r.tenantId, studentId: r.studentId, requestId: r.id,
    text: `По заявке №${r.id} нужны данные:\n«${comment}»`,
    buttons: [{ label: 'Дополнить заявку', action: 'reply' }],
  }),
  staffReplied: (r: ServiceRequest, st: Student): Msg => ({
    audience: 'staff', tenantId: r.tenantId, requestId: r.id,
    text: `${shortName(st)} дополнил(а) заявку №${r.id}`,
    buttons: [{ label: 'Открыть заявку', action: 'open_panel' }],
  }),
  done: (r: ServiceRequest, svc: Service): Msg => {
    const signed = r.result?.signature
      ? `\nДокумент подписан электронной подписью вуза, № ${r.result.signature.docId}. Файл можно переслать — подлинность проверяется по QR-коду.`
      : '';
    const doc = r.result
      ? (svc.resultType === 'pdf' ? ' Справка в PDF.' : ` Документ: ${r.result.name}.`) + signed
      : '';
    return {
      audience: 'student', tenantId: r.tenantId, studentId: r.studentId, requestId: r.id,
      // Бэкенд отправляет файл вложением в том же сообщении (Bot API: attachments type=file)
      text: `Заявка №${r.id} готова.${doc}${r.resultNote ? `\n${r.resultNote}` : ''}`,
      buttons: r.result
        ? [{ label: r.result.mime === 'application/pdf' ? 'Скачать PDF' : 'Скачать файл', action: 'download_pdf' }]
        : [{ label: 'Открыть заявку', action: 'open_request' }],
    };
  },
  rateAsk: (r: ServiceRequest): Msg => ({
    audience: 'student', tenantId: r.tenantId, studentId: r.studentId, requestId: r.id,
    text: 'Оцените, пожалуйста, как прошло оформление: 1 — плохо, 5 — отлично. Это поможет вузу убрать лишние шаги.',
    buttons: ['1', '2', '3', '4', '5'].map((v) => ({ label: v, action: 'rate' as const, value: v })),
  }),
  staffLowRating: (r: ServiceRequest, st: Student, score: number, comment?: string): Msg => ({
    audience: 'staff', tenantId: r.tenantId, requestId: r.id,
    text: `Низкая оценка ${score}/5 по заявке №${r.id} (${shortName(st)})${comment ? `:\n«${comment}»` : ''}`,
    buttons: [{ label: 'Открыть заявку', action: 'open_panel' }],
  }),
  rejected: (r: ServiceRequest, reason: string): Msg => ({
    audience: 'student', tenantId: r.tenantId, studentId: r.studentId, requestId: r.id,
    text: `Заявка №${r.id} отклонена.\nПричина: ${reason}`,
    buttons: [{ label: 'Открыть заявку', action: 'open_request' }],
  }),
};
