// Модель данных UniFlow. Те же типы ложатся в схему БД и в контракт API.

export type TenantId = string;

export interface Tenant {
  id: TenantId;
  name: string; // «Университет А»
  short: string; // «ВУЗ А»
  ssoDomain: string; // student.univ-a.ru — для мок-входа
  // Историческая статистика до запуска демо (в реальности — агрегат из БД)
  archive: { processed: number; totalDays: number };
}

export interface Student {
  id: string;
  tenantId: TenantId;
  fullName: string; // Иванова Анна Сергеевна
  firstName: string;
  lastName: string;
  faculty: string; // ИТ
  facultyFull: string; // Факультет информационных технологий
  group: string; // ИТ-31
  course: number;
  email: string;
  maxUserId?: number; // WebApp.initDataUnsafe.user.id после привязки
}

export type CategoryId = 'docs' | 'study' | 'social' | 'campus';

export const CATEGORIES: { id: CategoryId; label: string }[] = [
  { id: 'docs', label: 'Документы' },
  { id: 'study', label: 'Учёба' },
  { id: 'social', label: 'Соцподдержка' },
  { id: 'campus', label: 'Кампус' },
];

export type FieldType = 'text' | 'textarea' | 'date' | 'time' | 'select' | 'file';

export interface ServiceField {
  id: string;
  type: FieldType;
  label: string;
  required: boolean;
  options?: string[]; // для select
  placeholder?: string;
}

export type ResultType = 'pdf' | 'visit' | 'none';

export interface Service {
  id: string;
  tenantId: TenantId;
  title: string;
  description: string;
  icon: string;
  category: CategoryId;
  meta: string; // строка под названием в каталоге: «Документы · PDF · до 3 раб. дней»
  slaDays: number; // рабочих дней на выполнение
  resultType: ResultType;
  resultNote: string; // «результат: PDF в чат и в заявку»
  department: string; // куда маршрутизируется
  fields: ServiceField[]; // ФИО/группа подставляются всегда и в fields не хранятся
  enabled: boolean; // виден в Mini App и боте
  published: boolean; // false — черновик
  aiHints?: string[]; // ключевые фразы для ИИ-маршрутизатора бота
}

export type RequestStatus = 'accepted' | 'in_progress' | 'need_info' | 'done' | 'rejected';

export const STATUS_LABEL: Record<RequestStatus, string> = {
  accepted: 'Принято',
  in_progress: 'В работе',
  need_info: 'Нужны данные',
  done: 'Готово',
  rejected: 'Отказ',
};

export interface StoredFile {
  name: string;
  size: number;
  mime: string;
  dataUrl?: string; // демо без сервера: небольшие файлы прямо в сторе
  url?: string; // режим с сервером: /files/<id>/<name>
  previewUrl?: string; // картинка для предпросмотра (сгенерированная справка)
  signature?: FileSignature; // документ вуза, подписанный электронной подписью (режим с сервером)
}

/** Электронная подпись выданного документа (демо: Ed25519 ключ сервера вуза). */
export interface FileSignature {
  docId: string; // номер документа, по нему — страница проверки /verify/<docId>
  alg: 'Ed25519';
  keyId: string; // отпечаток открытого ключа вуза
  sha256: string; // хеш файла, который подписан
  sig: string; // подпись (base64)
  signedAt: string;
  signer: string; // «Учебный отдел · Университет А»
}

export interface RequestRating {
  score: number; // 1..5
  comment?: string;
  at: string;
  channel: Channel;
}

export interface HistoryEntry {
  at: string; // ISO
  status: RequestStatus;
  note: string;
  actor: 'student' | 'staff' | 'system';
}

export type Channel = 'miniapp' | 'bot';

export interface ServiceRequest {
  id: number; // №18425
  tenantId: TenantId;
  serviceId: string;
  studentId: string;
  values: Record<string, string>; // fieldId → значение (для file — имя файла)
  files: Record<string, StoredFile>;
  status: RequestStatus;
  channel: Channel;
  createdAt: string;
  updatedAt: string;
  deadline: string; // ISO, дата
  history: HistoryEntry[];
  clarification?: string; // текст запроса уточнения от сотрудника
  studentReply?: string;
  result?: StoredFile;
  resultNote?: string; // «Заберите в каб. 204» для resultType=visit
  rejectReason?: string;
  rating?: RequestRating; // обратная связь студента после «Готово»
}

// Исходящее сообщение бота MAX. Бэкенд отправляет его через Bot API;
// в демо — показывается в ленте событий.
export interface BotMessage {
  id: string;
  at: string;
  audience: 'student' | 'staff';
  tenantId: TenantId;
  studentId?: string;
  requestId: number;
  text: string;
  buttons: { label: string; action: 'open_request' | 'download_pdf' | 'open_panel' | 'reply' | 'rate'; value?: string }[];
}

// Черновик, который бот создаёт после ИИ-маршрутизации:
// «Мне нужна справка для банка» → serviceId + предзаполненные поля.
// В Mini App передаётся через start_param = draft_<id>.
export interface Draft {
  id: string;
  studentId: string;
  serviceId: string;
  values: Record<string, string>;
  sourceText: string;
}

export type PanelRole = 'staff' | 'admin';

// Сотрудник, подписанный на уведомления бота (команда /staff в боте)
export interface StaffSubscriber {
  tenantId: TenantId;
  maxUserId: number;
  name: string;
}

export interface DB {
  version: number;
  tenants: Tenant[];
  students: Student[];
  services: Service[];
  requests: ServiceRequest[];
  messages: BotMessage[];
  drafts: Draft[];
  nextRequestId: number;
  staff?: StaffSubscriber[];
}
