const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, 'debug_output.html');
if (!fs.existsSync(htmlPath)) {
    console.log("No debug_output.html found.");
    process.exit(1);
}

const html = fs.readFileSync(htmlPath, 'utf8');
console.log("HTML length:", html.length);

// Count occurrences of image tags or base64 data
const matches = [];
const regex = /<img src=["']data:image\/[^"']+/g;
let match;
while ((match = regex.exec(html)) !== null) {
    matches.push(match[0].substring(0, 100));
}

console.log("Found matches starting with base64 img tags:", matches.length);
matches.forEach((m, idx) => {
    console.log(`Match ${idx+1}:`, m);
});

// Let's also check if "이미지 없음" is in the HTML
const noImageCount = (html.match(/이미지 없음/g) || []).length;
console.log("Occurrences of '이미지 없음':", noImageCount);
