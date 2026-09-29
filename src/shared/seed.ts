import type { DB, Service, ServiceRequest, Student, Tenant } from './types';
import { addWorkingDays, subWorkingDays } from './dates';

// Демо-данные. В проде — миграции/фикстуры бэкенда.
// Номер следующей заявки — 18425, чтобы сквозной сценарий совпадал с питчем.

const tenants: Tenant[] = [
  { id: 'univ-a', name: 'Университет А', short: 'ВУЗ А', ssoDomain: 'student.univ-a.ru', archive: { processed: 120, totalDays: 194 } },
  { id: 'univ-b', name: 'Университет Б', short: 'ВУЗ Б', ssoDomain: 'student.univ-b.ru', archive: { processed: 47, totalDays: 99 } },
];

const students: Student[] = [
  {
    id: 's-ivanova', tenantId: 'univ-a', fullName: 'Иванова Анна Сергеевна', firstName: 'Анна', lastName: 'Иванова',
    faculty: 'ИТ', facultyFull: 'Факультет информационных технологий', group: 'ИТ-31', course: 3,
    email: 'a.ivanova@student.univ-a.ru',
  },
  {
    id: 's-petrov', tenantId: 'univ-a', fullName: 'Петров Илья Дмитриевич', firstName: 'Илья', lastName: 'Петров',
    faculty: 'ЭК', facultyFull: 'Экономический факультет', group: 'ЭК-22', course: 2, email: 'i.petrov@student.univ-a.ru',
  },
  {
    id: 's-sidorova', tenantId: 'univ-a', fullName: 'Сидорова Мария Игоревна', firstName: 'Мария', lastName: 'Сидорова',
    faculty: 'ИТ', facultyFull: 'Факультет информационных технологий', group: 'ИТ-41', course: 4, email: 'm.sidorova@student.univ-a.ru',
  },
  {
    id: 's-kozlov', tenantId: 'univ-a', fullName: 'Козлов Артём Павлович', firstName: 'Артём', lastName: 'Козлов',
    faculty: 'ЮР', facultyFull: 'Юридический факультет', group: 'ЮР-12', course: 1, email: 'a.kozlov@student.univ-a.ru',
  },
  {
    id: 's-smirnov', tenantId: 'univ-b', fullName: 'Смирнов Дмитрий Олегович', firstName: 'Дмитрий', lastName: 'Смирнов',
    faculty: 'МХ', facultyFull: 'Механический факультет', group: 'МХ-21', course: 2, email: 'd.smirnov@student.univ-b.ru',
  },
];

const certFields = (): Service['fields'] => [
  {
    id: 'place', type: 'select', label: 'Место требования', required: true,
    options: ['Банк / кредит', 'Работа родителей', 'Соцзащита / МФЦ', 'Военкомат', 'Посольство / виза', 'Другое'],
  },
  { id: 'reason', type: 'text', label: 'Причина / комментарий', required: false, placeholder: 'Например: для оформления кредита' },
];

function servicesFor(tenantId: string): Service[] {
  if (tenantId === 'univ-b') {
    return [
      {
        id: 'b-cert', tenantId, title: 'Справка об обучении', description: 'Подтверждение статуса студента',
        icon: 'doc', category: 'docs', meta: 'Документы · PDF · до 2 раб. дней', slaDays: 2, resultType: 'pdf',
        resultNote: 'результат: PDF в чат и в заявку', department: 'Отдел кадров студентов', fields: certFields(),
        enabled: true, published: true, aiHints: ['справка', 'студент', 'банк'],
      },
      {
        id: 'b-dorm', tenantId, title: 'Общежитие', description: 'Заселение или переселение',
        icon: 'home', category: 'campus', meta: 'Кампус · до 5 раб. дней', slaDays: 5, resultType: 'visit',
        resultNote: 'ответ придёт в чат', department: 'Студгородок',
        fields: [
          { id: 'kind', type: 'select', label: 'Что нужно', required: true, options: ['Заселение', 'Переселение', 'Выселение'] },
          { id: 'from', type: 'date', label: 'С какого числа', required: true },
          { id: 'comment', type: 'textarea', label: 'Комментарий', required: false },
        ],
        enabled: true, published: true, aiHints: ['общежитие', 'заселение', 'комната'],
      },
      {
        id: 'b-aid', tenantId, title: 'Материальная помощь', description: 'Разовая выплата',
        icon: 'aid', category: 'social', meta: 'Соцподдержка · до 10 раб. дней', slaDays: 10, resultType: 'none',
        resultNote: 'может потребоваться документ', department: 'Профком',
        fields: [
          { id: 'basis', type: 'select', label: 'Основание', required: true, options: ['Трудная жизненная ситуация', 'Многодетная семья', 'Иное'] },
          { id: 'reason', type: 'textarea', label: 'Причина', required: true, placeholder: 'Кратко опишите ситуацию…' },
        ],
        enabled: true, published: true, aiHints: ['матпомощь', 'деньги', 'выплата'],
      },
    ];
  }
  return [
    {
      id: 'cert-study', tenantId, title: 'Справка об обучении', description: 'Подтверждение, что вы студент: для банка, работы родителей, МФЦ',
      icon: 'doc', category: 'docs', meta: 'Документы · PDF · до 3 раб. дней', slaDays: 3, resultType: 'pdf',
      resultNote: 'результат: PDF в чат и в заявку', department: 'Учебный отдел', fields: certFields(),
      enabled: true, published: true, aiHints: ['справка', 'для банка', 'что я студент', 'с места учёбы'],
    },
    {
      id: 'acad-leave', tenantId, title: 'Академический отпуск', description: 'Заявление на академический отпуск',
      icon: 'pause', category: 'study', meta: 'Учёба · рассмотрение · до 10 раб. дней', slaDays: 10, resultType: 'none',
      resultNote: 'решение придёт в чат и в заявку', department: 'Деканат',
      fields: [
        { id: 'from', type: 'date', label: 'Дата начала', required: true },
        { id: 'to', type: 'date', label: 'Дата окончания', required: true },
        {
          id: 'basis', type: 'select', label: 'Основание', required: true,
          options: ['По медицинским показаниям', 'Семейные обстоятельства', 'Призыв на военную службу', 'Иное'],
        },
        { id: 'doc', type: 'file', label: 'Подтверждающий документ', required: false },
      ],
      enabled: true, published: true, aiHints: ['академ', 'академический отпуск', 'взять паузу'],
    },
    {
      id: 'fin-aid', tenantId, title: 'Материальная помощь', description: 'Разовая выплата студентам в трудной ситуации',
      icon: 'aid', category: 'social', meta: 'Соцподдержка · до 10 раб. дней', slaDays: 10, resultType: 'none',
      resultNote: 'может потребоваться документ', department: 'Соцотдел',
      fields: [
        {
          id: 'basis', type: 'select', label: 'Основание', required: true,
          options: ['Трудная жизненная ситуация', 'Многодетная семья', 'Инвалидность', 'Сирота', 'Иное'],
        },
        { id: 'reason', type: 'textarea', label: 'Причина', required: true, placeholder: 'Кратко опишите ситуацию…' },
        { id: 'doc', type: 'file', label: 'Подтверждающий документ', required: false },
      ],
      enabled: true, published: true, aiHints: ['матпомощь', 'материальная помощь', 'выплата', 'деньги'],
    },
    {
      id: 'dean-visit', tenantId, title: 'Запись в деканат', description: 'Приём у специалиста деканата',
      icon: 'calendar', category: 'study', meta: 'Учёба', slaDays: 2, resultType: 'visit',
      resultNote: 'подтверждение записи придёт в чат', department: 'Деканат',
      fields: [
        { id: 'date', type: 'date', label: 'Дата', required: true },
        { id: 'time', type: 'select', label: 'Время', required: true, options: ['10:00', '11:00', '12:00', '14:00', '15:00', '16:00'] },
        { id: 'topic', type: 'text', label: 'Тема', required: true, placeholder: 'Например: перезачёт дисциплины' },
      ],
      enabled: true, published: true, aiHints: ['запись', 'деканат', 'приём', 'подойти'],
    },
    {
      id: 'campus-pass', tenantId, title: 'Выдача пропуска', description: 'Электронный или бумажный пропуск в кампус',
      icon: 'pass', category: 'campus', meta: 'Кампус · до 2 раб. дней', slaDays: 2, resultType: 'visit',
      resultNote: 'пропуск выдаётся в службе пропусков', department: 'Служба пропусков',
      fields: [
        { id: 'kind', type: 'select', label: 'Вид пропуска', required: true, options: ['Электронный', 'Бумажный'] },
        { id: 'from', type: 'date', label: 'С какого числа', required: true },
        { id: 'photo', type: 'file', label: 'Фото 3×4', required: true },
        { id: 'comment', type: 'text', label: 'Комментарий', required: false },
      ],
      enabled: false, published: false, aiHints: ['пропуск', 'турникет'],
    },
  ];
}

function atDaysAgo(days: number, h: number, m: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(h, m, 0, 0);
  return d;
}

function mkReq(
  p: Partial<ServiceRequest> & Pick<ServiceRequest, 'id' | 'tenantId' | 'serviceId' | 'studentId' | 'status'>,
  created: Date,
  sla: number,
): ServiceRequest {
  const iso = created.toISOString();
  return {
    values: {},
    files: {},
    channel: 'miniapp',
    createdAt: iso,
    updatedAt: iso,
    deadline: addWorkingDays(created, sla).toISOString(),
    history: [{ at: iso, status: 'accepted', note: 'заявка создана', actor: 'student' }],
    ...p,
  };
}

export function createSeed(): DB {
  const services = [...servicesFor('univ-a'), ...servicesFor('univ-b')];

  const kozlovCreated = subWorkingDays(new Date(), 5);
  kozlovCreated.setHours(10, 5, 0, 0);
  const sidorovaCreated = subWorkingDays(new Date(), 3);
  sidorovaCreated.setHours(12, 30, 0, 0);

  const later = (d: Date, minutes: number) => new Date(d.getTime() + minutes * 60000).toISOString();

  const r18370created = atDaysAgo(2, 11, 20);
  const r18290created = atDaysAgo(16, 9, 12);

  const requests: ServiceRequest[] = [
    mkReq(
      {
        id: 18418, tenantId: 'univ-a', serviceId: 'fin-aid', studentId: 's-petrov', status: 'accepted',
        values: { basis: 'Многодетная семья', reason: 'В семье трое детей, прошу рассмотреть выплату', doc: 'spravka_mnogodet.pdf' },
        files: { doc: { name: 'spravka_mnogodet.pdf', size: 184000, mime: 'application/pdf' } },
        channel: 'bot',
      },
      atDaysAgo(1, 15, 42), 10,
    ),
    mkReq(
      {
        id: 18412, tenantId: 'univ-a', serviceId: 'acad-leave', studentId: 's-sidorova', status: 'in_progress',
        values: { from: '2026-10-05', to: '2027-02-01', basis: 'Семейные обстоятельства' },
        history: [
          { at: sidorovaCreated.toISOString(), status: 'accepted', note: 'заявка создана', actor: 'student' },
          { at: later(sidorovaCreated, 95), status: 'in_progress', note: 'взята сотрудником', actor: 'staff' },
        ],
        updatedAt: later(sidorovaCreated, 95),
      },
      sidorovaCreated, 10,
    ),
    mkReq(
      {
        id: 18390, tenantId: 'univ-a', serviceId: 'cert-study', studentId: 's-kozlov', status: 'in_progress',
        values: { place: 'Военкомат', reason: 'Отсрочка' },
        history: [
          { at: kozlovCreated.toISOString(), status: 'accepted', note: 'заявка создана', actor: 'student' },
          { at: later(kozlovCreated, 40), status: 'in_progress', note: 'взята сотрудником', actor: 'staff' },
        ],
        updatedAt: later(kozlovCreated, 40),
      },
      kozlovCreated, 3,
    ),
    mkReq(
      {
        id: 18370, tenantId: 'univ-a', serviceId: 'dean-visit', studentId: 's-ivanova', status: 'need_info',
        values: { date: new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 10), time: '14:00', topic: 'Перезачёт дисциплины' },
        clarification: 'На 14:00 запись занята. Выберите другое время или напишите, когда вам удобно.',
        history: [
          { at: r18370created.toISOString(), status: 'accepted', note: 'заявка создана', actor: 'student' },
          { at: later(r18370created, 30), status: 'in_progress', note: 'взята сотрудником', actor: 'staff' },
          { at: later(r18370created, 34), status: 'need_info', note: 'запрошено уточнение', actor: 'staff' },
        ],
        updatedAt: later(r18370created, 34),
      },
      r18370created, 2,
    ),
    mkReq(
      {
        id: 18290, tenantId: 'univ-a', serviceId: 'fin-aid', studentId: 's-ivanova', status: 'done',
        values: { basis: 'Трудная жизненная ситуация', reason: 'Лечение, прикладываю чеки' },
        resultNote: 'Выплата назначена, поступит вместе со стипендией.',
        rating: { score: 5, at: later(r18290created, 60 * 24 * 5 + 30), channel: 'bot' },
        history: [
          { at: r18290created.toISOString(), status: 'accepted', note: 'заявка создана', actor: 'student' },
          { at: later(r18290created, 60 * 26), status: 'in_progress', note: 'взята сотрудником', actor: 'staff' },
          { at: later(r18290created, 60 * 24 * 5), status: 'done', note: 'выплата назначена', actor: 'staff' },
        ],
        updatedAt: later(r18290created, 60 * 24 * 5),
      },
      r18290created, 10,
    ),
    // История для аналитики обратной связи (тестовые данные)
    ...[
      { id: 18301, st: 's-petrov', svc: 'cert-study', ago: 12, took: 2, score: 4, comment: undefined, clar: false },
      { id: 18305, st: 's-sidorova', svc: 'cert-study', ago: 10, took: 4, score: 2, comment: 'Дважды ходила в деканат за печатью — в заявке не было сказано, что оригинал только лично', clar: true },
      { id: 18310, st: 's-kozlov', svc: 'dean-visit', ago: 8, took: 1, score: 5, comment: undefined, clar: false },
      { id: 18322, st: 's-petrov', svc: 'acad-leave', ago: 20, took: 7, score: 3, comment: 'Долго ждал решения, не понимал, на каком этапе заявка', clar: true },
    ].map((h) => {
      const c = atDaysAgo(h.ago, 10, 15);
      const sla = h.svc === 'acad-leave' ? 10 : h.svc === 'dean-visit' ? 2 : 3;
      const doneAt = later(c, 60 * 24 * h.took);
      return mkReq(
        {
          id: h.id, tenantId: 'univ-a', serviceId: h.svc, studentId: h.st, status: 'done',
          values: h.svc === 'cert-study' ? { place: 'Банк / кредит' } : h.svc === 'dean-visit' ? { date: c.toISOString().slice(0, 10), time: '11:00', topic: 'Консультация' } : { from: '2026-10-01', to: '2027-01-31', basis: 'Семейные обстоятельства' },
          resultNote: h.svc === 'dean-visit' ? 'Ждём вас в 11:00, каб. 214' : undefined,
          history: [
            { at: c.toISOString(), status: 'accepted', note: 'заявка создана', actor: 'student' },
            { at: later(c, 60), status: 'in_progress', note: 'взята сотрудником', actor: 'staff' },
            ...(h.clar ? [{ at: later(c, 120), status: 'need_info' as const, note: 'запрошено уточнение', actor: 'staff' as const }, { at: later(c, 60 * 20), status: 'in_progress' as const, note: 'студент дополнил заявку', actor: 'student' as const }] : []),
            { at: doneAt, status: 'done', note: 'заявка выполнена', actor: 'staff' },
          ],
          updatedAt: doneAt,
          rating: { score: h.score, comment: h.comment, at: later(c, 60 * 24 * h.took + 20), channel: 'bot' },
        },
        c, sla,
      );
    }),
    mkReq(
      {
        id: 18415, tenantId: 'univ-b', serviceId: 'b-dorm', studentId: 's-smirnov', status: 'accepted',
        values: { kind: 'Переселение', from: '2026-10-01', comment: 'Хочу переехать в корпус 2' },
      },
      atDaysAgo(0, 9, 10), 5,
    ),
  ];

  return {
    version: 1,
    tenants,
    students,
    services,
    requests,
    messages: [],
    drafts: [],
    nextRequestId: 18425,
  };
}
