/**
 * Issues Routes — 이슈 보고서 PDF 내보내기 및 CRUD
 */
'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');
const handlebars = require('handlebars');
const { asyncHandler, AppError, rateLimit } = require('../middleware');

// PDF 생성은 리소스 집약적이므로 IP 당 분당 10회로 제한
const pdfRateLimit = rateLimit({
    windowMs: 60_000,
    max: 10,
    message: 'PDF 내보내기 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
});

const router = express.Router();

// Handlebars 헬퍼
handlebars.registerHelper('eq', (a, b) => a === b);

// GET: Fetch all issues
router.get('/api/issues', (req, res) => {
    try {
        const dataPath = path.join(__dirname, '..', 'data', 'issues.json');
        if (!fs.existsSync(dataPath)) {
            return res.json([]);
        }
        const data = fs.readFileSync(dataPath, 'utf8');
        res.json(JSON.parse(data || '[]'));
    } catch (err) {
        res.status(500).json({ error: 'Failed to read issues' });
    }
});

// POST: Add or Update issue
router.post('/api/issues', (req, res) => {
    try {
        const dataPath = path.join(__dirname, '..', 'data', 'issues.json');
        const issues = fs.existsSync(dataPath) ? JSON.parse(fs.readFileSync(dataPath, 'utf8') || '[]') : [];

        const newIssue = req.body;
        const index = issues.findIndex(i => i.id === newIssue.id);

        if (index !== -1) {
            issues[index] = { ...issues[index], ...newIssue, updatedAt: new Date().toISOString() };
        } else {
            issues.push({ ...newIssue, createdAt: new Date().toISOString() });
        }

        fs.writeFileSync(dataPath, JSON.stringify(issues, null, 2), 'utf8');
        res.status(201).json(newIssue);
    } catch (err) {
        console.error('[Issues API] Save error:', err);
        res.status(500).json({ error: 'Failed to save issue' });
    }
});

// DELETE: Remove issue
router.delete('/api/issues/:id', (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const dataPath = path.join(__dirname, '..', 'data', 'issues.json');
        if (!fs.existsSync(dataPath)) return res.status(404).json({ error: 'Not found' });

        let issues = JSON.parse(fs.readFileSync(dataPath, 'utf8') || '[]');
        issues = issues.filter(i => i.id !== id);

        fs.writeFileSync(dataPath, JSON.stringify(issues, null, 2), 'utf8');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete issue' });
    }
});

// ── POST /api/issues/export-pdf ────────────────────────────────
router.post('/api/issues/export-pdf', pdfRateLimit, asyncHandler(async (req, res) => {
    const data = req.body || {};
    console.log('[Issues PDF] Export requested.');

    // Normalize: support both single-issue and array-of-issues
    const issuesRaw = Array.isArray(data.issues) ? data.issues : [data];
    if (!issuesRaw.length) throw new AppError('이슈 데이터가 비어 있습니다.', 400, 'VALIDATION_ERROR');

    const title = data.title || '이슈 해결 결과 보고서';
    const logoBase64 = data.logoBase64 || '';

    // [Field Selector] Build field visibility flags
    const rawSf = data.selectedFields || data.sf || {};
    const sf = {
        no: rawSf.no !== false && String(rawSf.no) !== 'false',
        structure: rawSf.structure !== false && String(rawSf.structure) !== 'false',
        work_type: rawSf.work_type !== false && String(rawSf.work_type) !== 'false',
        description: rawSf.description !== false && String(rawSf.description) !== 'false',
        resolution: rawSf.resolution !== false && String(rawSf.resolution) !== 'false',
        screenshot: rawSf.screenshot !== false && String(rawSf.screenshot) !== 'false'
    };

    // Pre-compute combined flag for use in HBS
    sf.hasMetaRow = sf.no || sf.structure || sf.work_type;

    // Calculate layout properties
    let totalColsCount = 0;
    if (sf.no) totalColsCount += 2;
    if (sf.structure) totalColsCount += 2;
    if (sf.work_type) totalColsCount += 2;

    sf.colspan = Math.max(1, totalColsCount - 1);
    sf.totalCols = Math.max(1, totalColsCount);
    sf.halfCols = Math.max(1, Math.floor(totalColsCount / 2));

    // Map each raw issue to the template fields
    const issues = issuesRaw.map((issue, idx) => {
        // [Greedy Extraction Strategy]
        const rawStruct = (issue.structure_name || issue.structureName || issue.structure || issue.struct || issue.Structure || '').toString().trim();
        const rawWork = (issue.work_type || issue.workType || issue.work_Type || issue.worktype || issue.WorkType || '').toString().trim();

        const valStruct = rawStruct || '-';
        const valWork = rawWork || '-';
        const valIssueNum = (issue.issue_number || issue.issueNumber || issue.dbId || issue.id || (idx + 1)).toString().trim();

        return {
            issueId: valIssueNum,
            status: issue.status || 'Open',
            pdf_structure: valStruct,
            pdf_work_type: valWork,
            description: issue.description || '내용 없음',
            resolution_description: issue.resolutionDesc || issue.resolution_description || '내용 없음',
            thumbnail: issue.thumbnail || '',
            after_snapshot_url: issue.afterThumbnail || issue.after_snapshot_url || '',
            isDualImage: (issue.isComparison === true || issue.isComparison === 'true') || (issue.status === 'Closed'),
            versionA: issue.versionA || 'Before',
            versionB: issue.versionB || 'After',
            imageTableRows: issue.imageTableRows || ''
        };
    });

    const templateData = { title, logoBase64, issues, sf };
    const templatePath = path.join(__dirname, '..', 'views', 'issue-report.hbs');

    const templateHtml = fs.readFileSync(templatePath, 'utf8');
    const template = handlebars.compile(templateHtml);
    const html = template(templateData);

    // Puppeteer: Windows/ngrok 환경 호환성 유지, 안전한 타임아웃
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        timeout: 90000
    });

    try {
        const page = await browser.newPage();
        page.setDefaultNavigationTimeout(90000);
        await page.setContent(html, { waitUntil: 'networkidle0', timeout: 90000 });

        const pdfBuffer = await page.pdf({
            format: 'A4',
            landscape: true,
            printBackground: true,
            margin: { top: '0', right: '0', bottom: '0', left: '0' },
        });

        const filename = issues.length === 1
            ? `issue_report_${issuesRaw[0].id || 'export'}.pdf`
            : `issue_report_batch_${Date.now()}.pdf`;

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(Buffer.from(pdfBuffer));
    } finally {
        await browser.close().catch(() => {});
    }
}));

module.exports = router;
