const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, 'debug_output.html');
const dest = path.join(__dirname, 'public', 'debug_output.html');

if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log("Copied debug_output.html to public/debug_output.html");
} else {
    console.log("Source debug_output.html not found.");
}
