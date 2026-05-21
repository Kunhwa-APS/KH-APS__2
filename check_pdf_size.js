const fs = require('fs');
const path = require('path');

const pdfPath = path.join(__dirname, 'debug_pdf.pdf');
if (fs.existsSync(pdfPath)) {
    const stats = fs.statSync(pdfPath);
    console.log("PDF File Size:", stats.size, "bytes", `(${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
} else {
    console.log("PDF not found.");
}
