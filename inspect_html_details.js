const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, 'debug_output.html');
const html = fs.readFileSync(htmlPath, 'utf8');

const regex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
let match;
let trCount = 0;
while ((match = regex.exec(html)) !== null) {
    const trContent = match[1];
    if (trContent.includes("변경 전 (")) {
        console.log(`\n=== Found Table Row ${trCount} ===`);
        const cleanTr = match[0].replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/g, (m) => {
            return m.substring(0, 30) + "... [base64 data size: " + m.length + "]";
        });
        console.log(cleanTr);
        
        // Also print the next sibling row
        const nextMatch = regex.exec(html);
        if (nextMatch) {
            const cleanNext = nextMatch[0].replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/g, (m) => {
                return m.substring(0, 30) + "... [base64 data size: " + m.length + "]";
            });
            console.log(`\n=== Next Row ===`);
            console.log(cleanNext);
        }
        break;
    }
    trCount++;
}
