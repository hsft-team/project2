const fs = require("fs");
const path = require("path");

const QRCode = require("../node_modules/qrcode-terminal/vendor/QRCode");
const QRErrorCorrectLevel = require("../node_modules/qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel");

const targetUrl = process.argv[2];
const outputPath = process.argv[3];

if (!targetUrl || !outputPath) {
  console.error("Usage: node generate-qr-svg.js <url> <outputPath>");
  process.exit(1);
}

const qrcode = new QRCode(-1, QRErrorCorrectLevel.L);
qrcode.addData(targetUrl);
qrcode.make();

const modules = qrcode.modules;
const moduleCount = qrcode.getModuleCount();
const moduleSize = 12;
const quietZone = 4;
const imageSize = (moduleCount + quietZone * 2) * moduleSize;

const rects = [];
for (let row = 0; row < moduleCount; row += 1) {
  for (let col = 0; col < moduleCount; col += 1) {
    if (!modules[row][col]) {
      continue;
    }

    const x = (col + quietZone) * moduleSize;
    const y = (row + quietZone) * moduleSize;
    rects.push(`<rect x="${x}" y="${y}" width="${moduleSize}" height="${moduleSize}" />`);
  }
}

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${imageSize}" height="${imageSize}" viewBox="0 0 ${imageSize} ${imageSize}" role="img" aria-label="Expo Go QR Code">
  <rect width="${imageSize}" height="${imageSize}" fill="#ffffff" />
  <g fill="#000000">
    ${rects.join("\n    ")}
  </g>
</svg>
`;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, svg, "utf8");
console.log(outputPath);
