const express = require('express');
const { authRefreshMiddleware, getHubs, getProjects, getProjectContents, getItemVersions, getInternalTwoLeggedToken, getIssueContainerInfo, getProjectIssues } = require('../services/aps.js');

let router = express.Router();

// 모든 /api/hubs 요청에 인증 확인 미들웨어 적용
router.use('/api/hubs', authRefreshMiddleware);

/**
 * GET /api/hubs
 * 사용자 허브 목록 (ACC, BIM360 등)
 */
router.get('/api/hubs', async function (req, res, next) {
    try {
        const hubs = await getHubs(req.internalOAuthToken.access_token);
        res.json(hubs.map(hub => ({
            id: hub.id,
            name: hub.attributes.name
        })));
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/hubs/:hub_id/projects
 * 허브 내 프로젝트 목록
 */
router.get('/api/hubs/:hub_id/projects', async function (req, res, next) {
    try {
        const projects = await getProjects(req.params.hub_id, req.internalOAuthToken.access_token);
        const mappedProjects = projects.map(project => {
            const ext = project.attributes.extension?.data || {};
            return {
                id: project.id,
                name: project.attributes.name,
                addressLine1: ext.addressLine1 || '',
                addressLine2: ext.addressLine2 || '',
                city: ext.city || '',
                stateOrProvince: ext.stateOrProvince || '',
                postalCode: ext.postalCode || '',
                country: ext.country || '',
                latitude: ext.latitude || null,
                longitude: ext.longitude || null,
            };
        });

        let twoLeggedToken = null;
        try {
            twoLeggedToken = await getInternalTwoLeggedToken();
        } catch (e) {
            console.error('[ACC HQ API] Failed to get 2-legged token:', e.message);
        }

        const EnhancedProjects = await Promise.all(mappedProjects.map(async p => {
            if (p.addressLine1 || p.city) return p;
            if (!twoLeggedToken) return p;

            try {
                const accountId = req.params.hub_id.replace(/^b\./, '');
                const projectId = p.id.replace(/^b\./, '');

                const response = await fetch(`https://developer.api.autodesk.com/hq/v1/accounts/${accountId}/projects/${projectId}`, {
                    headers: { 'Authorization': `Bearer ${twoLeggedToken}` }
                });

                if (response.ok) {
                    const hqData = await response.json();
                    if (hqData.address_line_1 || hqData.city) {
                        p.addressLine1 = hqData.address_line_1 || p.addressLine1;
                        p.addressLine2 = hqData.address_line_2 || p.addressLine2;
                        p.city = hqData.city || p.city;
                        p.stateOrProvince = hqData.state_or_province || p.stateOrProvince;
                        p.postalCode = hqData.postal_code || p.postalCode;
                        p.country = hqData.country || p.country;
                    }
                }
            } catch (e) { }
            return p;
        }));

        res.json(EnhancedProjects);
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/hubs/:hub_id/projects/:project_id/contents
 */
router.get('/api/hubs/:hub_id/projects/:project_id/contents', async function (req, res, next) {
    try {
        const entries = await getProjectContents(
            req.params.hub_id,
            req.params.project_id,
            req.query.folder_id,
            req.internalOAuthToken.access_token
        );
        res.json(entries.map(entry => {
            const isFolder = entry.type === 'folders';
            let vNumber = 1;
            let urn = null;
            if (!isFolder && entry.relationships && entry.relationships.tip) {
                const tipId = entry.relationships.tip.data.id;
                const match = tipId.match(/[?&]version=(\d+)/i) || tipId.match(/:v(\d+)$/i) || tipId.match(/\.vf\..+v(\d+)$/i);
                vNumber = match ? parseInt(match[1]) : 1;
                urn = Buffer.from(tipId).toString('base64').replace(/=/g, '');
            }
            return {
                id: entry.id,
                name: entry.attributes.displayName,
                folder: isFolder,
                vNumber,
                urn
            };
        }));
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/hubs/:hub_id/projects/:project_id/contents/:item_id/versions
 */
router.get('/api/hubs/:hub_id/projects/:project_id/contents/:item_id/versions', async function (req, res, next) {
    try {
        const rawItemId = req.params.item_id;
        const projectId = req.params.project_id;
        const versions = await getItemVersions(projectId, rawItemId, req.internalOAuthToken.access_token);

        const result = versions.map(version => {
            let vNumber = version.attributes.versionNumber;
            if (vNumber === undefined || vNumber === null) {
                const match = version.id.match(/[?&]version=(\d+)/i) || version.id.match(/:v(\d+)$/i);
                vNumber = match ? parseInt(match[1]) : 0;
            }
            return {
                id: version.id,
                name: version.attributes.createTime,
                displayName: version.attributes.displayName || version.attributes.createTime,
                vNumber: vNumber,
                createUserName: version.attributes.createUserName,
                urn: Buffer.from(version.id).toString('base64').replace(/=/g, '')
            };
        });
        res.json(result);
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/hubs/:hub_id/projects/:project_id/issues
 * 프로젝트 내 ACC Issues 목록 조회 (실시간)
 */
router.get('/api/hubs/:hub_id/projects/:project_id/issues', async function (req, res, next) {
    try {
        const hubId = req.params.hub_id;
        const projectId = req.params.project_id;
        const accessToken = req.internalOAuthToken.access_token;

        const containerId = await getIssueContainerInfo(hubId, projectId, accessToken);
        if (!containerId) return res.json([]);

        const issues = await getProjectIssues(containerId, accessToken);
        const formattedIssues = issues.map(i => ({
            id: i.id,
            title: i.title || i.attributes?.title || 'No Title',
            status: i.attributes?.status || 'Open',
            description: i.attributes?.description || '',
            structure_name: i.attributes?.customAttributes?.find(attr => attr.title === 'Structure' || attr.title === '건물명')?.value || '-',
            work_type: i.attributes?.customAttributes?.find(attr => attr.title === '공종' || attr.title === 'Work Type')?.value || '-',
            raw: i
        }));

        res.json(formattedIssues);
    } catch (err) {
        // [Fix] ACC Issues 모듈 미지원/토큰 만료 시 500 전파 대신 빈 배열 반환
        console.warn('[ACC Issues API] 이슈 조회 실패 (빈 배열 반환):', err.message || err);
        return res.json([]);
    }
});
/**
 * GET /api/hubs/:hub_id/projects/:project_id/users
 * 프로젝트 구성원 목록 조회 (HQ Admin API)
 */
router.get('/api/hubs/:hub_id/projects/:project_id/users', async function (req, res, next) {
    try {
        const hubId = req.params.hub_id;
        const projectId = req.params.project_id;
        
        let twoLeggedToken = null;
        try {
            twoLeggedToken = await getInternalTwoLeggedToken();
        } catch (e) {
            console.error('[ACC HQ API] Failed to get 2-legged token for users:', e.message);
            return res.json([]);
        }

        const accountId = hubId.replace(/^b\./, '');
        const projId = projectId.replace(/^b\./, '');

        const response = await fetch(`https://developer.api.autodesk.com/hq/v1/accounts/${accountId}/projects/${projId}/users`, {
            headers: { 'Authorization': `Bearer ${twoLeggedToken}` }
        });

        if (response.ok) {
            const data = await response.json();
            res.json(data);
        } else {
            console.warn('[ACC HQ API] Failed to fetch users:', response.statusText);
            res.json([]);
        }
    } catch (err) {
        console.warn('[ACC HQ API] Exception fetching users:', err.message);
        res.json([]);
    }
});
/**
 * GET /api/forge/members
 * 403 에러 우회를 위한 프론트엔드용 백엔드 프록시 라우트
 */
router.get('/api/forge/members', async function (req, res, next) {
    try {
        let twoLeggedToken = null;
        try {
            twoLeggedToken = await getInternalTwoLeggedToken();
        } catch (e) {
            console.error('[ACC Proxy API] 관리자 토큰(2-legged) 획득 실패:', e.message);
            return res.status(403).json({ error: 'Token missing' });
        }

        const apiUrl = 'https://developer.api.autodesk.com/construction/admin/v1/projects/374bde3a-83a3-4dd5-80c2-2e01ddeac719/users?limit=200';
        const response = await fetch(apiUrl, {
            headers: { 'Authorization': `Bearer ${twoLeggedToken}` }
        });

        if (response.ok) {
            const data = await response.json();
            res.json(data);
        } else {
            console.warn('[ACC Proxy API] ACC Admin API 통신 실패:', response.statusText);
            res.status(response.status).json({ error: response.statusText });
        }
    } catch (err) {
        console.warn('[ACC Proxy API] 내부 오류 발생:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
