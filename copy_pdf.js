const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, 'debug_pdf.pdf');
const dest = path.join(__dirname, 'public', 'debug_pdf.pdf');

if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log("Copied debug_pdf.pdf to public/debug_pdf.pdf");
} else {
    console.log("Source debug_pdf.pdf not found.");
}
