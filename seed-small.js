(() => {
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = new Date();
  const isoOff = (off) => { const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - off); return iso(d); };
  const entries = [];
  const readingSessions = [];
  for (let d = 0; d <= 20; d += 1) {
    if (d % 3 === 2) continue;
    const date = isoOff(d);
    entries.push({
      id: `se-${d}`, date, startTime: '09:30', endTime: '10:30', durationMin: 20 + ((d * 53) % 170),
      labelIds: d % 2 === 0 ? ['l1'] : ['l2'], itemIds: [], note: 'Focused work',
      createdAt: new Date().toISOString(),
    });
    if (d % 5 === 1) {
      readingSessions.push({
        id: `rs-${d}`, fileId: 'f1', date, startedAt: new Date().toISOString(), endedAt: new Date().toISOString(),
        minutes: 25 + (d % 35), pagesVisited: 4, pagesRead: 3, startPage: 10, endPage: 13,
      });
    }
  }
  const habitLog = {};
  for (let d = 0; d <= 20; d += 1) habitLog[isoOff(d)] = d % 7 < 3;
  const state = {
    view: 'reports', reportRange: 'today', calendarSystem: 'gregorian', dailyCapacityMin: 240,
    stats: { focusSessions: 18, focusMinutes: 640, readingMinutes: 320, pagesRead: 55 },
    labels: [
      { id: 'l1', name: 'Deep work', color: '#0F766E', itemIds: [] },
      { id: 'l2', name: 'Study', color: '#7C3AED', itemIds: [] },
    ],
    entries, readingSessions,
    habits: [{ id: 'h1', name: 'Read 20 pages', description: '', color: '#D97706', cadence: 'daily', log: habitLog, createdAt: '2026-01-05T09:00:00.000Z' }],
    files: [{
      id: 'f1', title: 'Algorithms — CLRS', fileName: 'clrs.pdf', size: 4200000, pageCount: 180,
      addedAt: '2026-02-01T10:00:00.000Z', deadline: isoOff(8), coverMode: 'page', coverPage: 1,
      color: null, tags: ['cs'], notes: '', currentPage: 42, pageSeconds: {}, readPages: ['1', '2', '3'],
      favoritePages: [], annoPages: [], folderId: null, lastReadAt: null, archived: false,
    }],
  };
  localStorage.setItem('workbench_aurora_v3', JSON.stringify({ state, version: 5 }));
  return 'small seed: ' + entries.length + ' entries';
})()
