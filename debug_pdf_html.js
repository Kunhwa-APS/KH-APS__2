const fs = require('fs');
const path = require('path');
const handlebars = require('handlebars');

handlebars.registerHelper('eq', (a, b) => a === b);

// Get first comparison issue
const dataPath = path.join(__dirname, 'data', 'issues.json');
const issuesData = JSON.parse(fs.readFileSync(dataPath, 'utf8') || '[]');
const compIssues = issuesData.filter(i => i.isComparison === true);

if (compIssues.length === 0) {
    console.log("No comparison issues found in data/issues.json");
    process.exit(1);
}

const issue = compIssues[0];
console.log("Selected issue for debug:", issue.title);

const beforeImg = issue.beforeImage || '';
const afterImg = issue.afterImage || '';

var beforeTag = "<span>이미지 없음</span>";
if (beforeImg) {
    beforeTag = "<img src='" + beforeImg + "' style='max-width:100%; max-height:280px; object-fit:contain;'>";
}

var afterTag = "<span>이미지 없음</span>";
if (afterImg) {
    afterTag = "<img src='" + afterImg + "' style='max-width:100%; max-height:280px; object-fit:contain;'>";
}

var imageTableRows = "" +
"<tr style='background-color: #eaecf0;'>" +
    "<td colspan='2' style='width: 50%; text-align: center; font-weight: bold; padding: 8px; border: 1px solid #ccc;'>변경 전 (Before)</td>" +
    "<td colspan='2' style='width: 50%; text-align: center; font-weight: bold; padding: 8px; border: 1px solid #ccc;'>변경 후 (After)</td>" +
"</tr>" +
"<tr>" +
    "<td colspan='2' style='width: 50%; text-align: center; vertical-align: middle; padding: 10px; border: 1px solid #ccc; height: 300px;'>" + beforeTag + "</td>" +
    "<td colspan='2' style='width: 50%; text-align: center; vertical-align: middle; padding: 10px; border: 1px solid #ccc; height: 300px;'>" + afterTag + "</td>" +
"</tr>";

const processedIssue = {
    issueId: "1",
    status: issue.status || 'Open',
    pdf_structure: issue.structureName || '-',
    pdf_work_type: issue.workType || '-',
    description: issue.description || '내용 없음',
    resolution_description: issue.resolutionDesc || '내용 없음',
    thumbnail: beforeImg,
    after_snapshot_url: afterImg,
    isDualImage: true,
    versionA: issue.versionA || 'V00',
    versionB: issue.versionB || 'V00',
    imageTableRows: ""
};

const sf = {
    no: true,
    structure: true,
    work_type: true,
    description: true,
    resolution: true,
    screenshot: true,
    hasMetaRow: true
};

let totalColsCount = 0;
if (sf.no) totalColsCount += 2;
if (sf.structure) totalColsCount += 2;
if (sf.work_type) totalColsCount += 2;

sf.colspan = Math.max(1, totalColsCount - 1);
sf.totalCols = Math.max(1, totalColsCount);
sf.halfCols = Math.max(1, Math.floor(totalColsCount / 2));

const templateData = {
    title: '버전비교 이슈 해결 결과 보고서',
    logoBase64: '',
    issues: [processedIssue],
    sf: sf
};

const templatePath = path.join(__dirname, 'views', 'issue-report.hbs');
const templateHtml = fs.readFileSync(templatePath, 'utf8');
const template = handlebars.compile(templateHtml);
const html = template(templateData);

fs.writeFileSync(path.join(__dirname, 'debug_output.html'), html, 'utf8');
console.log("HTML generated successfully and saved to debug_output.html");
