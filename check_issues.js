const fs = require('fs');
const path = require('path');

const dataPath = path.join(__dirname, 'data', 'issues.json');
if (!fs.existsSync(dataPath)) {
    console.log("No issues.json found.");
    process.exit(0);
}

const data = JSON.parse(fs.readFileSync(dataPath, 'utf8') || '[]');
console.log("Total issues:", data.length);

const compIssues = data.filter(i => i.isComparison === true);
console.log("Comparison issues:", compIssues.length);

compIssues.forEach((issue, idx) => {
    console.log(`\n--- Issue ${idx + 1} (ID: ${issue.id}) ---`);
    console.log("Title:", issue.title);
    console.log("isComparison:", issue.isComparison);
    console.log("beforeImage exists:", !!issue.beforeImage, issue.beforeImage ? issue.beforeImage.substring(0, 50) : null);
    console.log("afterImage exists:", !!issue.afterImage, issue.afterImage ? issue.afterImage.substring(0, 50) : null);
    console.log("thumbnail exists:", !!issue.thumbnail, issue.thumbnail ? issue.thumbnail.substring(0, 50) : null);
    console.log("afterThumbnail exists:", !!issue.afterThumbnail, issue.afterThumbnail ? issue.afterThumbnail.substring(0, 50) : null);
});
