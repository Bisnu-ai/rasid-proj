'use strict';

const ExcelJS = require('exceljs');
const { Receipt } = require('./models');
const { formatDate, formatTime, formatINR } = require('./format');

/**
 * Build the .xlsx report entirely from MongoDB.
 * Layout: summary section at the top (total receipts, total collection),
 * then the 4-column table: Donor Name | Amount (INR) | Date | Time.
 */
async function buildExcelBuffer() {
  const [agg] = await Receipt.aggregate([
    { $group: { _id: null, totalPaise: { $sum: '$amount' }, count: { $sum: 1 } } },
  ]);
  const totalPaise = agg ? agg.totalPaise : 0;
  const count = agg ? agg.count : 0;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Receipt Management System';
  wb.created = new Date();
  const ws = wb.addWorksheet('Receipts');

  ws.columns = [
    { key: 'name', width: 34 },
    { key: 'amount', width: 20 },
    { key: 'date', width: 22 },
    { key: 'time', width: 14 },
  ];

  const red = 'FF8E1B1B';
  const gold = 'FFFFE9A0';
  const thin = { style: 'thin', color: { argb: 'FFC9971C' } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  const money = '"₹"#,##0.00';

  // ---- Summary section ----
  ws.mergeCells('A1:D1');
  const title = ws.getCell('A1');
  title.value = 'Collection Summary';
  title.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: red } };
  title.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 24;

  ws.getCell('A2').value = 'Total Receipts';
  ws.getCell('B2').value = count;
  ws.getCell('B2').numFmt = '0';
  ws.getCell('A3').value = 'Total Collection (INR)';
  ws.getCell('B3').value = totalPaise / 100;
  ws.getCell('B3').numFmt = money;
  ['A2', 'A3'].forEach((a) => {
    ws.getCell(a).font = { bold: true };
    ws.getCell(a).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: gold } };
    ws.getCell(a).border = border;
  });
  ['B2', 'B3'].forEach((a) => {
    ws.getCell(a).font = { bold: true };
    ws.getCell(a).alignment = { horizontal: 'right' };
    ws.getCell(a).border = border;
  });

  // ---- Table header (row 5) ----
  const headerRowNo = 5;
  const header = ws.getRow(headerRowNo);
  header.values = ['Donor Name', 'Amount (INR)', 'Date', 'Time'];
  header.height = 22;
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: red } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = border;
  });

  // ---- Data rows (oldest first) ----
  let rowNo = headerRowNo + 1;
  const cursor = Receipt.find({}, { donorName: 1, amount: 1, dateTime: 1 }).sort({ dateTime: 1, _id: 1 }).lean().cursor();
  for await (const r of cursor) {
    const row = ws.getRow(rowNo++);
    row.values = [r.donorName, r.amount / 100, formatDate(r.dateTime), formatTime(r.dateTime)];
    row.getCell(2).numFmt = money;
    row.getCell(2).alignment = { horizontal: 'right' };
    row.getCell(3).alignment = { horizontal: 'center' };
    row.getCell(4).alignment = { horizontal: 'center' };
    row.eachCell((cell) => { cell.border = border; });
  }

  ws.views = [{ state: 'frozen', ySplit: headerRowNo }];
  if (rowNo > headerRowNo + 1) {
    ws.autoFilter = { from: { row: headerRowNo, column: 1 }, to: { row: rowNo - 1, column: 4 } };
  }

  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), count, totalPaise, formattedTotal: formatINR(totalPaise) };
}

module.exports = { buildExcelBuffer };
