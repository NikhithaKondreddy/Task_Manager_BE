function escapePdfText(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function buildContentStream(lines = []) {
  const safeLines = (Array.isArray(lines) ? lines : [String(lines || '')]).slice(0, 42);
  const commands = ['BT', '/F1 10 Tf', '36 790 Td', '14 TL'];
  safeLines.forEach((line, index) => {
    if (index === 0) {
      commands.push(`(${escapePdfText(line)}) Tj`);
    } else {
      commands.push('T*');
      commands.push(`(${escapePdfText(line)}) Tj`);
    }
  });
  commands.push('ET');
  return commands.join('\n');
}

function buildPdfBuffer(title, rows = []) {
  const lines = [title || 'Ticket Report', ''];
  (rows || []).forEach((row) => {
    lines.push(
      Object.entries(row || {})
        .map(([key, value]) => `${key}: ${value == null ? '' : value}`)
        .join(' | ')
    );
  });

  const stream = buildContentStream(lines);
  const objects = [];

  const addObject = (body) => {
    objects.push(body);
    return objects.length;
  };

  const fontObject = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const contentObject = addObject(`<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream`);
  const pageObject = addObject(`<< /Type /Page /Parent 4 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObject} 0 R >> >> /Contents ${contentObject} 0 R >>`);
  const pagesObject = addObject(`<< /Type /Pages /Kids [${pageObject} 0 R] /Count 1 >>`);
  const catalogObject = addObject(`<< /Type /Catalog /Pages ${pagesObject} 0 R >>`);

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogObject} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
}

module.exports = {
  buildPdfBuffer,
};
