const fs = require('fs');
const path = require('path');

const dataPath = path.join(__dirname, 'data', 'issues.json');
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8') || '[]');

const compIssues = data.filter(i => i.isComparison === true);

compIssues.forEach((issue, idx) => {
    console.log(`\n--- Issue ${idx + 1} (ID: ${issue.id}) ---`);
    console.log("beforeImage length:", issue.beforeImage ? issue.beforeImage.length : 0);
    console.log("afterImage length:", issue.afterImage ? issue.afterImage.length : 0);
    console.log("Are they identical?", issue.beforeImage === issue.afterImage);
});
