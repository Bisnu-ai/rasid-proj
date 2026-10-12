'use strict';

const path = require('path');
const PDFDocument = require('pdfkit');
const { formatDate, formatTime, formatINR } = require('./format');

// Embedded Unicode font that covers Odia + Latin + the ₹ sign.
const FONT_REGULAR = path.join(__dirname, '..', 'fonts', 'NotoSansOriya-Regular.ttf');
const FONT_BOLD = path.join(__dirname, '..', 'fonts', 'NotoSansOriya-Bold.ttf');

// Exact committee header (do not edit the spelling).
const HEADER_LINES = [
  'ଜୟ ଦୁର୍ଗା ସାଂସ୍କୃତିକ ପରିଷଦ',
  'କରିଲୋପାଟଣା, କେନ୍ଦ୍ରାପଡ଼ା',
  '୬୧ତମ ସାରଦୀୟ ଦୁର୍ଗାପୂଜା',
];

const C = {
  cream: '#FFF8E6',
  deepRed: '#8E1B1B',
  red: '#B71C1C',
  orange: '#E65100',
  amber: '#F57C00',
  yellow: '#FFC107',
  paleYellow: '#FFE9A0',
  gold: '#C9971C',
  ink: '#3B1A0B',
  muted: '#8A5A2B',
};

const W = 595;
const H = 400;

function diamond(doc, cx, cy, r, color) {
  doc.save().moveTo(cx, cy - r).lineTo(cx + r, cy).lineTo(cx, cy + r).lineTo(cx - r, cy).closePath().fill(color).restore();
}

function diamondRow(doc, y, x1, x2, step, r) {
  let i = 0;
  for (let x = x1; x <= x2; x += step, i++) {
    diamond(doc, x, y, r, i % 2 === 0 ? C.amber : C.yellow);
  }
}

/** Soft rosette watermark behind the details. */
function rosette(doc, cx, cy, radius) {
  doc.save();
  doc.opacity(0.07);
  for (let i = 0; i < 12; i++) {
    doc.save();
    doc.translate(cx, cy).rotate((360 / 12) * i);
    doc.ellipse(0, -radius * 0.6, radius * 0.17, radius * 0.4).fill(C.orange);
    doc.restore();
  }
  doc.circle(cx, cy, radius * 0.22).fill(C.red);
  doc.restore();
}

function drawReceipt(doc, receipt) {
  // Background
  doc.rect(0, 0, W, H).fill(C.cream);

  // Borders: gold outer, red inner
  doc.save().lineWidth(4).strokeColor(C.gold).rect(10, 10, W - 20, H - 20).stroke().restore();
  doc.save().lineWidth(1.2).strokeColor(C.red).rect(17, 17, W - 34, H - 34).stroke().restore();
  [[10, 10], [W - 10, 10], [10, H - 10], [W - 10, H - 10]].forEach(([x, y]) => {
    doc.circle(x, y, 7).fill(C.gold);
    doc.circle(x, y, 3.2).fill(C.deepRed);
  });

  // Header band (red -> orange -> red gradient)
  const bandTop = 17;
  const bandH = 138;
  const grad = doc.linearGradient(17, 0, W - 17, 0);
  grad.stop(0, C.deepRed).stop(0.5, C.orange).stop(1, C.deepRed);
  doc.rect(17, bandTop, W - 34, bandH).fill(grad);
  doc.rect(17, bandTop + bandH, W - 34, 5).fill(C.gold);
  doc.rect(17, bandTop + bandH + 5, W - 34, 2).fill(C.yellow);

  // Odia header (exact text)
  const tw = W - 80;
  doc.font(FONT_BOLD).fillColor(C.paleYellow).fontSize(29);
  doc.text(HEADER_LINES[0], 40, 36, { width: tw, align: 'center', lineBreak: false });
  doc.font(FONT_BOLD).fillColor('#FFFFFF').fontSize(18);
  doc.text(HEADER_LINES[1], 40, 82, { width: tw, align: 'center', lineBreak: false });
  doc.font(FONT_BOLD).fillColor(C.yellow).fontSize(18);
  doc.text(HEADER_LINES[2], 40, 114, { width: tw, align: 'center', lineBreak: false });

  // Ornament rows
  diamondRow(doc, 175, 60, W - 60, 22, 4.5);

  // Watermark
  rosette(doc, W / 2, 280, 120);

  // Details
  const left = 72;
  const valueX = 215;
  const rowsY = [200, 248, 296];
  const rows = [
    ['Donor Name:', receipt.donorName, 20, C.ink],
    ['Amount:', formatINR(receipt.amount), 26, C.red],
    ['Date:', formatDate(receipt.dateTime), 18, C.ink],
    ['Time:', formatTime(receipt.dateTime), 18, C.ink],
  ];
  // Layout: Name, Amount on their own lines; Date and Time share the third line group.
  const ys = [196, 238, 284, 318];
  rows.forEach(([label, value, size, color], i) => {
    const y = ys[i];
    doc.font(FONT_REGULAR).fontSize(14).fillColor(C.muted);
    doc.text(label, left, y + (size > 18 ? 6 : 3), { lineBreak: false });
    doc.font(FONT_BOLD).fontSize(size).fillColor(color);
    doc.text(value, valueX, y, { width: W - valueX - 60, lineBreak: false, ellipsis: true });
    if (i < rows.length - 1) {
      doc.save().dash(1.5, { space: 3 }).lineWidth(0.8).strokeColor(C.gold)
        .moveTo(left, y + size + 12).lineTo(W - 60, y + size + 12).stroke().undash().restore();
    }
  });
  void rowsY;

  // Footer ornament
  diamondRow(doc, H - 37, 60, W - 60, 22, 4.5);
}

/** Generate the receipt PDF for a saved receipt record. Resolves to a Buffer. */
function generateReceiptPdf(receipt) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [W, H],
      margin: 0,
      compress: true,
      info: { Title: 'Donation Receipt' },
    });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      drawReceipt(doc, receipt);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generateReceiptPdf, HEADER_LINES };
