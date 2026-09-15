/* Generates a small multi-page PDF (no deps) for E2E testing of the Library/Reader.
   Run: bun tests/make-sample-pdf.mjs */
import { writeFileSync, mkdirSync } from 'node:fs';

const PAGES = 8;
const W = 595, H = 842;

const objMap = new Map();
objMap.set(1, `<< /Type /Catalog /Pages 2 0 R >>`);
objMap.set(2, `<< /Type /Pages /Count ${PAGES} /Kids [${Array.from({ length: PAGES }, (_, i) => `${4 + i * 2} 0 R`).join(' ')}] >>`);
objMap.set(3, `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>`);
const chNames = ['Introduction', 'First-Order Equations', 'Linear Systems', 'Existence & Uniqueness', 'Nonlinear Dynamics', 'Boundary Value Problems', 'Power Series Methods', 'Review & Next Steps'];
for (let p = 1; p <= PAGES; p++) {
  const pageId = 3 + p * 2 + 1 - 2 + 1; // 4,6,8...
  const pid = 2 + p * 2; // 4,6,8...
  const cid = pid + 1;
  const ch = chNames[p - 1];
  const lines = [
    `BT /F1 34 Tf 64 760 Td (Aurora Sample Book) Tj ET`,
    `BT /F1 15 Tf 64 736 Td (A study companion generated for testing) Tj ET`,
    `BT /F1 24 Tf 64 660 Td (Chapter ${p} — ${ch}) Tj ET`,
    `BT /F1 16 Tf 64 620 Td (Page ${p} of ${PAGES}) Tj ET`,
    `BT /F1 11 Tf 64 590 Td (Spend 15+ seconds on a page and it counts as read.) Tj ET`,
    `BT /F1 11 Tf 64 572 Td (Reading sessions track time per page automatically.) Tj ET`,
    `BT /F1 90 Tf 200 300 Td (${p}) Tj ET`,
    `BT /F1 10 Tf 64 70 Td (workbench aurora — sample reading material) Tj ET`,
  ].join('\n');
  const content = lines.replace(/\(/g, '(').replace(/—/g, '-');
  objMap.set(pid, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${cid} 0 R >>`);
  objMap.set(cid, `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);
}

let out = '%PDF-1.4\n';
const offsets = [];
const maxId = 3 + PAGES * 2;
for (let id = 1; id <= maxId; id++) {
  offsets[id] = Buffer.byteLength(out, 'latin1');
  out += `${id} 0 obj\n${objMap.get(id)}\nendobj\n`;
}
const xrefPos = Buffer.byteLength(out, 'latin1');
out += `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
for (let id = 1; id <= maxId; id++) {
  out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
}
out += `trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;

mkdirSync('public/samples', { recursive: true });
writeFileSync('public/samples/aurora-sample-book.pdf', Buffer.from(out, 'latin1'));
console.log('Wrote public/samples/aurora-sample-book.pdf', Buffer.byteLength(out, 'latin1'), 'bytes,', PAGES, 'pages');
