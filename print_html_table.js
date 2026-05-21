const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, 'debug_output.html');
const html = fs.readFileSync(htmlPath, 'utf8');

// Find the section containing "변경 전 (Before)"
const index = html.indexOf("변경 전 (Before)");
if (index === -1) {
    console.log("Not found");
    process.exit(1);
}

// Print 2000 characters around the index, but replacing large base64 strings with placeholders
const snippet = html.substring(index - 500, index + 3000);
const cleanSnippet = snippet.replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/g, (match) => {
    return match.substring(0, 50) + "... [TRUNCATED " + match.length + " chars]";
});

console.log(cleanSnippet);
