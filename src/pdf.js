'use strict';

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { formatDate, formatTime, formatINR } = require('./format');

function resolveAsset(...parts) {
  const p1 = path.join(__dirname, '..', ...parts);
  if (fs.existsSync(p1)) return p1;
  const p2 = path.join(process.cwd(), ...parts);
  if (fs.existsSync(p2)) return p2;
  return p1;
}

// Embedded Unicode font that covers Odia + Latin + the ₹ sign.
const FONT_REGULAR = resolveAsset('fonts', 'NotoSansOriya-Regular.ttf');
const FONT_BOLD = resolveAsset('fonts', 'NotoSansOriya-Bold.ttf');

// Sacred image of Maa Durga
const MAA_IMAGE = resolveAsset('assets', 'maa_durga.jpg');

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

/** Soft rosette watermark behind the details (fallback if image is missing). */
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

/** Draws an authentic Odia temple shrine arch path. */
function templeArchPath(doc, x, y, w, h, r) {
  const topR = w / 2;
  doc.moveTo(x, y + h - r)
     .lineTo(x, y + topR)
     .arc(x + topR, y + topR, topR, Math.PI, 0, false)
     .lineTo(x + w, y + h - r)
     .quadraticCurveTo(x + w, y + h, x + w - r, y + h)
     .lineTo(x + r, y + h)
     .quadraticCurveTo(x, y + h, x, y + h - r)
     .closePath();
}

/** Draws the sacred portrait of Maa Durga inside an ornate golden temple shrine. */
function drawMaaPortrait(doc, x, y, w, h) {
  const hasImage = fs.existsSync(MAA_IMAGE);
  const r = 10;
  const topR = w / 2;
  const cx = x + topR;
  const cy = y + topR;

  // 1. Radiant golden halo rays around the temple arch
  doc.save();
  const numRays = 14;
  for (let i = 0; i < numRays; i++) {
    const angle = Math.PI + (Math.PI / (numRays - 1)) * i;
    const rayDist = topR + 6;
    const rx = cx + Math.cos(angle) * rayDist;
    const ry = cy + Math.sin(angle) * rayDist;
    diamond(doc, rx, ry, 2.8, i % 2 === 0 ? C.yellow : C.amber);
  }
  doc.restore();

  // 2. Temple arch frame background
  doc.save();
  templeArchPath(doc, x, y, w, h, r);
  doc.fill('#4A0808'); // Rich sanctum sanctorum backdrop
  doc.restore();

  // 3. Maa Durga's sacred image (clipped to the arch)
  if (hasImage) {
    doc.save();
    templeArchPath(doc, x + 1.5, y + 1.5, w - 3, h - 3, r - 1);
    doc.clip();
    doc.image(MAA_IMAGE, x, y, { cover: [w, h], align: 'center', valign: 'center' });
    doc.restore();
  }

  // 4. Double ornate golden shrine borders
  doc.save();
  doc.lineWidth(3).strokeColor(C.gold);
  templeArchPath(doc, x, y, w, h, r);
  doc.stroke();
  doc.restore();

  doc.save();
  doc.lineWidth(1.2).strokeColor(C.paleYellow);
  templeArchPath(doc, x + 1.8, y + 1.8, w - 3.6, h - 3.6, r - 1);
  doc.stroke();
  doc.restore();

  // 5. Small golden corner accents at base
  diamond(doc, x, y + h, 3.2, C.gold);
  diamond(doc, x + w, y + h, 3.2, C.gold);
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

  // Sacred portrait of Maa Durga in the header (Left Side)
  const portraitX = 30;
  const portraitY = 24;
  const portraitW = 96;
  const portraitH = 124;
  drawMaaPortrait(doc, portraitX, portraitY, portraitW, portraitH);

  // Odia header text (centered in the area next to Maa Durga's portrait)
  const textX = portraitX + portraitW + 12; // ~138
  const textW = W - 17 - textX - 10;       // ~413
  doc.font(FONT_BOLD).fillColor(C.paleYellow).fontSize(27);
  doc.text(HEADER_LINES[0], textX, 35, { width: textW, align: 'center', lineBreak: false });
  doc.font(FONT_BOLD).fillColor('#FFFFFF').fontSize(18);
  doc.text(HEADER_LINES[1], textX, 81, { width: textW, align: 'center', lineBreak: false });
  doc.font(FONT_BOLD).fillColor(C.yellow).fontSize(18);
  doc.text(HEADER_LINES[2], textX, 113, { width: textW, align: 'center', lineBreak: false });

  // Ornament divider row
  diamondRow(doc, 175, 40, W - 40, 22, 4.5);

  // Watermark (Maa Durga divine watermark across center, or rosette fallback)
  const hasImage = fs.existsSync(MAA_IMAGE);
  if (hasImage) {
    doc.save();
    doc.opacity(0.08);
    const wmWidth = 150;
    const wmHeight = 185;
    const wmX = (W - wmWidth) / 2 + 60;
    const wmY = 180;
    doc.roundedRect(wmX, wmY, wmWidth, wmHeight, 16).clip();
    doc.image(MAA_IMAGE, wmX, wmY - 15, { width: wmWidth });
    doc.restore();
  } else {
    rosette(doc, W / 2, 280, 120);
  }

  // Details
  const left = 65;
  const valueX = 205;
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
    doc.text(value, valueX, y, { width: W - valueX - 160, lineBreak: false, ellipsis: true });
    if (i < rows.length - 1) {
      doc.save().dash(1.5, { space: 3 }).lineWidth(0.8).strokeColor(C.gold)
        .moveTo(left, y + size + 12).lineTo(W - 160, y + size + 12).stroke().undash().restore();
    }
  });

  // Authorized Signatory section (Right side)
  doc.save();
  const sigX = W - 155;
  const sigY = 328;
  doc.dash(2, { space: 3 }).lineWidth(0.8).strokeColor(C.muted)
    .moveTo(sigX, sigY).lineTo(sigX + 115, sigY).stroke().undash();
  doc.font(FONT_BOLD).fontSize(11).fillColor(C.muted);
  doc.text('କର୍ମକର୍ତ୍ତାଙ୍କ ସ୍ୱାକ୍ଷର', sigX, sigY + 5, { width: 115, align: 'center', lineBreak: false });
  doc.restore();

  // Footer ornament
  diamondRow(doc, H - 37, 40, W - 40, 22, 4.5);
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
