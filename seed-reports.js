(() => {
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = new Date();
  const dayAt = (off) => { const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - off); return d; };
  const isoOff = (off) => iso(dayAt(off));

  const entries = [];
  const readingSessions = [];
  let eid = 0;
  for (let d = 0; d <= 300; d += 1) {
    if (d % 3 === 2) continue; // zero day
    const mins = 20 + ((d * 53) % 170); // 20..189
    const date = isoOff(d);
    entries.push({
      id: `se-${eid++}`, date,
      startTime: '09:30', endTime: `09:${30 + (mins % 30)}`.replace('09:', '09:'),
      durationMin: mins,
      labelIds: d % 2 === 0 ? ['l1'] : ['l2'],
      itemIds: d % 4 === 0 ? ['g1'] : [],
      note: d % 4 === 0 ? 'Worked on the goal' : 'Focused work',
      createdAt: new Date(dayAt(d).getTime() + 36000000).toISOString(),
    });
    if (d % 5 === 1) {
      readingSessions.push({
        id: `rs-${d}`, fileId: 'f1', date,
        startedAt: new Date(dayAt(d).getTime() + 72000000).toISOString(),
        endedAt: new Date(dayAt(d).getTime() + 7500000 + 3600000).toISOString(),
        minutes: 25 + (d % 35), pagesVisited: 4, pagesRead: 3, startPage: 10, endPage: 13,
      });
    }
  }
  const habitLog = {};
  for (let d = 0; d <= 300; d += 1) habitLog[isoOff(d)] = d % 7 < 3;
  const habitLog2 = {};
  for (let d = 0; d <= 300; d += 14) habitLog2[isoOff(d)] = true;

  const state = {
    view: 'reports',
    reportRange: 'year',
    calendarSystem: 'gregorian',
    dailyCapacityMin: 240,
    stats: { focusSessions: 18, focusMinutes: 640, readingMinutes: 320, pagesRead: 55 },
    labels: [
      { id: 'l1', name: 'Deep work', color: '#0F766E', itemIds: [] },
      { id: 'l2', name: 'Study', color: '#7C3AED', itemIds: [] },
    ],
    entries,
    readingSessions,
    habits: [
      { id: 'h1', name: 'Read 20 pages', description: '', color: '#D97706', cadence: 'daily', log: habitLog, createdAt: '2025-01-05T09:00:00.000Z' },
      { id: 'h2', name: 'Weekly review', description: '', color: '#0891B2', cadence: 'weekly', log: habitLog2, createdAt: '2025-01-05T09:00:00.000Z' },
    ],
    items: [
      {
        id: 'g1', title: 'Finish Algorithms course', type: 'goal', parentId: null,
        deadline: isoOff(-20), notes: '', manualProgress: 45, checklist: [], color: '#0F766E',
        priority: 'p1', status: 'in_progress', estimateMin: 6000, nextAction: 'Chapter 7 exercises',
        dependsOn: [], fileIds: ['f1'], plannedStart: null, plannedEnd: null, startDate: null,
        completedAt: null, createdAt: '2025-01-05T09:00:00.000Z', updatedAt: '2025-08-01T09:00:00.000Z',
      },
    ],
    files: [
      {
        id: 'f1', title: 'Algorithms — CLRS', fileName: 'clrs.pdf', size: 4200000, pageCount: 180,
        addedAt: '2025-02-01T10:00:00.000Z', deadline: isoOff(-8), coverMode: 'page', coverPage: 1,
        color: null, tags: ['cs'], notes: '', currentPage: 42, pageSeconds: { '10': 90, '11': 45 },
        readPages: ['1', '2', '3'], favoritePages: [], annoPages: [], folderId: null,
        lastReadAt: null, archived: false,
      },
    ],
  };
  localStorage.setItem('workbench_aurora_v3', JSON.stringify({ state, version: 5 }));
  return 'seeded: ' + entries.length + ' entries, ' + readingSessions.length + ' sessions';
})()
