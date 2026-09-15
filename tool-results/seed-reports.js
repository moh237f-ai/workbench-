(() => {
  const d = (off) => { const t = new Date(); t.setDate(t.getDate() + off); const p = (n) => String(n).padStart(2, '0'); return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`; };
  const iso = (off, h, m) => `${d(off)}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  const e = (id, off, dur, note, labelIds, itemIds, sh, sm, eh, em) => ({ id, date: d(off), startTime: `${String(sh).padStart(2, '0')}:${String(sm).padStart(2, '0')}`, endTime: `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`, durationMin: dur, labelIds, itemIds, note, createdAt: iso(off, 20, 0) });
  const rs = (id, off, min, pr, sp, ep) => ({ id, fileId: 'f-algo', date: d(off), startedAt: iso(off, 21, 0), endedAt: iso(off, 21, min), minutes: min, pagesVisited: pr, pagesRead: pr, startPage: sp, endPage: ep });

  const entries = [
    e('e1', 0, 95, 'Deep work on planner', ['l1'], ['t1'], 9, 0, 10, 35),
    e('e2', 0, 45, 'Inbox zero + notes', ['l2'], [], 11, 10, 11, 55),
    e('e3', -1, 130, 'Roadmap canvas work', ['l1'], ['t1'], 8, 30, 10, 40),
    e('e4', -2, 60, 'Review flashcards', ['l1'], [], 15, 0, 16, 0),
    e('e5', -4, 240, 'Big focus day', ['l1'], ['t1'], 8, 0, 12, 0),
    e('e6', -5, 30, 'Email + admin', ['l2'], [], 17, 0, 17, 30),
    e('e7', -6, 180, 'Reader link layer', ['l1'], ['t1'], 9, 30, 12, 30),
    e('e8', -9, 75, 'Weekly review', ['l2'], [], 19, 0, 20, 15),
    e('e9', -12, 150, 'Library folders', ['l1'], ['t1'], 10, 0, 12, 30),
    e('e10', -20, 90, 'Focus clocks', ['l1'], [], 14, 0, 15, 30),
    e('e11', -35, 200, 'Sprint: reports v4', ['l1'], ['t1'], 9, 0, 12, 20),
    e('e12', -80, 120, 'Shamsi calendar port', ['l1'], [], 10, 0, 12, 0),
    e('e13', -150, 160, 'Store migration v5', ['l2'], ['t1'], 11, 0, 13, 40),
    e('e14', -210, 240, 'Deep winter sprint', ['l1'], ['t1'], 8, 0, 12, 0),
    e('e15', -300, 90, 'First entries', [], [], 16, 0, 17, 30),
  ];

  const readingSessions = [
    rs('r1', 0, 35, 12, 10, 22),
    rs('r2', -1, 25, 8, 22, 30),
    rs('r3', -4, 55, 20, 30, 50),
    rs('r4', -12, 40, 14, 50, 64),
    rs('r5', -80, 60, 22, 64, 86),
  ];

  const habitLog = {};
  [0, -1, -2, -4, -5, -9, -10].forEach((o) => { habitLog[d(o)] = true; });
  const weeklyLog = {};
  [-3, -10, -17].forEach((o) => { weeklyLog[d(o)] = true; });

  const state = {
    theme: 'light',
    view: 'reports',
    reportRange: 'last7',
    reportCustom: { from: d(-3), to: d(0) },
    calendarSystem: 'shamsi',
    dailyCapacityMin: 240,
    stats: { focusSessions: 14, focusMinutes: 350, readingMinutes: 215, pagesRead: 76 },
    labels: [
      { id: 'l1', name: 'Deep work', color: '#0d8f7d' },
      { id: 'l2', name: 'Admin', color: '#b45309' },
    ],
    items: [
      { id: 'g1', title: 'Learn algorithms', type: 'goal', parentId: null, deadline: d(40), notes: '', manualProgress: 40, checklist: [], color: '#0d8f7d', priority: 'P1', status: 'active', estimateMin: 6000, nextAction: '', dependsOn: [], fileIds: ['f-algo'], plannedStart: null, plannedEnd: null, startDate: null, createdAt: iso(-90, 9, 0), updatedAt: iso(-1, 9, 0) },
      { id: 't1', title: 'CLRS chapter 4', type: 'task', parentId: 'g1', deadline: d(10), notes: '', manualProgress: 55, checklist: [], color: null, priority: 'P2', status: 'active', estimateMin: 300, nextAction: '', dependsOn: [], fileIds: [], plannedStart: iso(0, 15, 0).slice(0, 16), plannedEnd: iso(0, 17, 0).slice(0, 16), startDate: null, createdAt: iso(-30, 9, 0), updatedAt: iso(0, 9, 0) },
    ],
    entries,
    habits: [
      { id: 'h1', name: 'Read 20 pages', description: '', color: '#7b61dc', cadence: 'daily', log: habitLog, createdAt: iso(-60, 9, 0) },
      { id: 'h2', name: 'Weekly review', description: '', color: '#b45309', cadence: 'weekly', log: weeklyLog, createdAt: iso(-60, 9, 0) },
    ],
    files: [
      { id: 'f-algo', title: 'CLRS Algorithms.pdf', fileName: 'clrs.pdf', size: 5400000, pageCount: 400, addedAt: iso(-90, 9, 0), deadline: d(21), coverMode: 'page', coverPage: 1, color: null, tags: [], notes: '', currentPage: 86, pageSeconds: {}, readPages: [], favoritePages: [], annoPages: [], folderId: null, lastReadAt: iso(-1, 21, 25), archived: false },
    ],
    readingSessions,
    filePlans: [
      { id: 'fp1', fileId: 'f-algo', date: d(0), startMin: 480, minutes: 30, done: true, createdAt: iso(0, 8, 0) },
      { id: 'fp2', fileId: 'f-algo', date: d(-1), startMin: 540, minutes: 45, done: false, createdAt: iso(-1, 8, 0) },
    ],
    roadmaps: [
      { id: 'rm1', title: 'Persian fluency', desc: '', nodes: [ { id: 'n1', kind: 'task', refId: 't1', x: 100, y: 100, w: 200, h: 90 }, { id: 'n2', kind: 'milestone', refId: null, title: 'Midterm', done: false, x: 400, y: 100, w: 200, h: 90 } ], edges: [ { id: 'ed1', from: 'n1', to: 'n2', label: '' } ], createdAt: iso(-45, 9, 0), updatedAt: iso(-2, 9, 0) },
    ],
  };
  localStorage.setItem('workbench_aurora_v3', JSON.stringify({ state, version: 5 }));
  return 'seeded ' + entries.length + ' entries';
})()
