/**
 * explorer.js
 * Manages the folder-based table view within the main viewer area.
 */
import { unreadManager } from './unread-manager.js';

class FolderExplorer {
    constructor() {
        this.container = document.getElementById('explorer-container');
        this.breadcrumb = document.getElementById('explorer-breadcrumb');
        this.list = document.getElementById('explorer-list');
        this.viewerContainer = document.getElementById('preview');
        this.refreshBtn = document.getElementById('refresh-explorer-btn');
        this.backBtn = document.getElementById('back-to-explorer-btn');
        this.infoBar = document.getElementById('viewer-info-bar');

        this.currentHubId = null;
        this.currentProjectId = null;
        this.currentFolderId = null;
        this.history = []; // For breadcrumbs

        this.init();
    }

    init() {
        if (this.refreshBtn) {
            this.refreshBtn.onclick = () => this.refresh();
        }
        if (this.backBtn) {
            this.backBtn.onclick = () => this.handleBackToExplorer();
        }

        // Restore context if available, otherwise show projects root
        const storedHubId = localStorage.getItem('aps_last_hub_id');
        const storedProjectId = localStorage.getItem('aps_last_project_id');
        if (storedHubId && storedProjectId) {
            this.history = [
                { id: 'projects-root', name: 'Root', type: 'projects-root' }
            ];
            this.showFolder(storedHubId, storedProjectId, null, 'Project');
        } else {
            this.showRootProjects();
        }
    }

    async showRootProjects() {
        this.currentHubId = null;
        this.currentProjectId = null;
        this.currentFolderId = null;
        this.history = [{ id: 'projects-root', name: 'Root', type: 'projects-root' }];
        this.updateBreadcrumbs();
        this.switchMode('explorer');
        this.renderLoading();

        try {
            const hubsResponse = await fetch('/api/hubs');
            if (!hubsResponse.ok) {
                this.renderError(`서버 오류 (${hubsResponse.status})`);
                return;
            }
            const hubs = await hubsResponse.json();
            if (!Array.isArray(hubs) || hubs.length === 0) {
                this.renderError('허브 정보를 찾을 수 없습니다.');
                return;
            }

            const projectPromises = hubs.map(async (hub) => {
                try {
                    const projectsResponse = await fetch(`/api/hubs/${hub.id}/projects`);
                    if (projectsResponse.ok) {
                        const projects = await projectsResponse.json();
                        return projects.map(p => ({ ...p, hubName: hub.name, hubId: hub.id }));
                    }
                } catch (e) {
                    console.warn(`Failed to fetch projects for hub ${hub.id}:`, e);
                }
                return [];
            });

            const results = await Promise.all(projectPromises);
            const allProjects = results.flat();

            allProjects.sort((a, b) => new Date(b.created || 0) - new Date(a.created || 0));

            this.renderProjects(allProjects);
        } catch (err) {
            console.error('[Explorer] Failed to load projects list:', err);
            this.renderError('프로젝트 목록을 가져오지 못했습니다.');
        }
    }

    async showProjects(hubId, hubName) {
        this.currentHubId = hubId;
        this.currentProjectId = null;
        this.currentFolderId = null;
        this.history = [
            { id: 'projects-root', name: 'Root', type: 'projects-root' },
            { id: hubId, name: hubName, type: 'projects', hubId: hubId }
        ];
        this.updateBreadcrumbs();
        this.switchMode('explorer');
        this.renderLoading();

        try {
            const response = await fetch(`/api/hubs/${hubId}/projects`);
            if (!response.ok) {
                this.renderError(`서버 오류 (${response.status})`);
                return;
            }
            const projects = await response.json();
            if (!Array.isArray(projects)) {
                this.renderError('데이터 형식이 올바르지 않습니다.');
                return;
            }

            const mappedProjects = projects.map(p => ({ ...p, hubId }));
            this.renderProjects(mappedProjects);
        } catch (err) {
            console.error('[Explorer] Failed to load projects:', err);
            this.renderError('프로젝트 정보를 가져오지 못했습니다.');
        }
    }

    renderProjects(projects) {
        if (!projects || projects.length === 0) {
            this.list.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:40px; color:var(--text-muted);">프로젝트가 존재하지 않습니다.</td></tr>';
            return;
        }

        this.list.innerHTML = '';
        projects.forEach(project => {
            const tr = document.createElement('tr');
            tr.className = 'row-project';
            tr.style.cursor = 'pointer';

            const createdDate = project.created ? new Date(project.created).toLocaleDateString() : '-';

            tr.innerHTML = `
                <td class="col-name">
                    <span class="explorer-icon icon-project" style="color: var(--accent-blue); margin-right: 10px;">
                        <i class="fas fa-project-diagram"></i>
                    </span>
                    <span class="item-name" style="font-weight:600;">${project.name}</span>
                </td>
                <td class="col-version">-</td>
                <td class="col-date">${createdDate}</td>
                <td class="col-user">-</td>
                <td class="col-actions"></td>
            `;

            tr.onclick = () => {
                const finalHubId = project.hubId || this.currentHubId;
                localStorage.setItem('aps_last_hub_id', finalHubId);
                localStorage.setItem('aps_last_project_id', project.id);
                this.showFolder(finalHubId, project.id, null, project.name);
            };
            this.list.appendChild(tr);
        });
    }

    async showFolder(hubId, projectId, folderId, folderName = 'Root') {
        this.currentHubId = hubId;
        this.currentProjectId = projectId;
        this.currentFolderId = folderId;

        // Rebuild history if empty or not containing projects-root
        const hasRoot = this.history.some(h => h.type === 'projects-root');
        if (!hasRoot) {
            this.history = [
                { id: 'projects-root', name: 'Root', type: 'projects-root' }
            ];
        }

        if (!folderId) {
            const projectsIdx = this.history.findIndex(h => h.type === 'projects');
            const rootIdx = this.history.findIndex(h => h.type === 'projects-root');
            const sliceIdx = projectsIdx !== -1 ? projectsIdx : rootIdx;

            this.history = this.history.slice(0, sliceIdx + 1);
            this.history.push({ id: projectId, name: folderName, type: 'folder', hubId, projectId });
        } else {
            const lastIdx = this.history.findIndex(h => h.id === folderId);
            if (lastIdx !== -1) {
                this.history = this.history.slice(0, lastIdx + 1);
            } else {
                this.history.push({ id: folderId, name: folderName, type: 'folder', hubId, projectId });
            }
        }

        this.updateBreadcrumbs();
        this.switchMode('explorer');
        this.renderLoading();

        try {
            const url = `/api/hubs/${hubId}/projects/${projectId}/contents${folderId ? `?folder_id=${folderId}` : ''}`;
            const response = await fetch(url);

            if (!response.ok) {
                console.warn('[Explorer] API Response not OK:', response.status);
                this.renderError(`서버 오류 (${response.status}) - 상위 폴더로 이동하거나 나중에 시도해주세요.`);
                return;
            }

            const items = await response.json();
            if (!Array.isArray(items)) {
                console.warn('[Explorer] Received non-array items:', items);
                this.renderError('데이터 형식이 올바르지 않습니다.');
                return;
            }

            this.renderTable(items);
        } catch (err) {
            console.error('[Explorer] Failed to load folder:', err);
            this.renderError('폴더 정보를 가져오지 못했습니다.');
        }
    }

    switchMode(mode) {
        const sidebarLeft = document.getElementById('sidebar-left');
        const topBar = document.getElementById('viewer-top-bar');
        const btnProjects = document.getElementById('header-projects-btn');

        // Reset all
        this.container.style.display = 'none';
        this.viewerContainer.style.display = 'none';
        if (topBar) topBar.style.display = 'none';

        if (btnProjects) btnProjects.classList.remove('active');

        if (mode === 'explorer') {
            this.container.style.display = 'flex';
            if (sidebarLeft) sidebarLeft.style.display = 'flex';
            if (btnProjects) btnProjects.classList.add('active');
        } else if (mode === 'viewer') {
            this.viewerContainer.style.display = 'block';
            if (topBar) topBar.style.display = 'flex';
            if (btnProjects) btnProjects.classList.add('active');
        }
    }

    handleBackToExplorer() {
        console.log('[Explorer] Returning to folder list...');
        this.switchMode('explorer');
    }

    updateBreadcrumbs() {
        this.breadcrumb.innerHTML = '';
        this.history.forEach((h, i) => {
            const item = document.createElement('span');
            item.className = `breadcrumb-item ${i === this.history.length - 1 ? 'active' : ''}`;
            item.textContent = h.name;
            item.onclick = () => {
                if (h.type === 'hubs') {
                    this.showHubs();
                } else if (h.type === 'projects') {
                    this.showProjects(h.hubId, h.name);
                } else {
                    this.showFolder(this.currentHubId, this.currentProjectId, h.id, h.name);
                }
            };

            this.breadcrumb.appendChild(item);

            if (i < this.history.length - 1) {
                const sep = document.createElement('span');
                sep.className = 'breadcrumb-separator';
                sep.textContent = ' / ';
                this.breadcrumb.appendChild(sep);
            }
        });
    }


    renderLoading() {
        this.list.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:40px; color:var(--text-muted);">Loading folder contents...</td></tr>';
    }

    renderError(msg) {
        this.list.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:40px; color:var(--accent-red);">${msg}</td></tr>`;
    }

    renderTable(items) {
        if (!items || !Array.isArray(items) || items.length === 0) {
            this.list.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:40px; color:var(--text-muted);">이 폴더는 비어 있거나 데이터를 불러오지 못했습니다.</td></tr>';
            return;
        }

        this.list.innerHTML = '';
        items.forEach(item => {
            const tr = document.createElement('tr');
            tr.className = item.folder ? 'row-folder' : 'row-item';

            const iconClass = this.getIconClass(item);
            const dateStr = item.lastModifiedTime ? new Date(item.lastModifiedTime).toLocaleDateString() : '-';

            const isRead = item.folder || unreadManager.isRead(item.id);
            const nameClass = isRead ? 'read-item-name' : 'unread-item-name';
            const badgeHtml = isRead ? '' : '<span class="unread-badge">N</span>';

            tr.innerHTML = `
                <td class="col-name">
                    <span class="explorer-icon ${iconClass}">
                        <i class="${item.folder ? 'fas fa-folder' : 'fas fa-file-alt'}"></i>
                    </span>
                    <span class="item-name ${nameClass}">${item.name}</span>
                    ${badgeHtml}
                </td>
                <td class="col-version">
                    ${item.folder ? '-' : `<span class="badge-version" data-item-id="${item.id}" data-item-name="${item.name}">v${item.vNumber || 1}</span>`}
                </td>
                <td class="col-date"><span class="text-date">${dateStr}</span></td>
                <td class="col-user"><span class="text-user">${item.lastModifiedUserName || 'Unknown'}</span></td>
                <td class="col-actions">
                    ${item.folder ? '' : '<button class="tool-btn" title="Open in Viewer">Load</button>'}
                </td>
            `;

            if (item.folder) {
                tr.onclick = () => this.showFolder(this.currentHubId, this.currentProjectId, item.id, item.name);
            } else {
                tr.onclick = (e) => {
                    // Prevent loading if clicking on the version badge
                    if (e.target.classList.contains('badge-version')) return;

                    // Set globals for version dropdown loading
                    window.currentHubId = this.currentHubId;
                    window.currentProjectId = this.currentProjectId;
                    window.currentItemId = item.id;
                    window.currentVersionId = item.id;

                    // Mark as read
                    if (!item.folder) {
                        if (unreadManager.markAsRead(item.id)) {
                            this.renderTable(items); // Re-render to update UI
                        }
                    }
                    this.loadIntoViewer(item.urn, item.name);
                };

                const badge = tr.querySelector('.badge-version');
                if (badge) {
                    badge.onclick = (e) => {
                        e.stopPropagation();
                        this.handleVersionClick(e.target, item.id, item.name);
                    };
                }
            }

            this.list.appendChild(tr);
        });
    }

    getIconClass(item) {
        if (item.folder) return 'icon-folder';
        const name = item.name.toLowerCase();
        if (name.endsWith('.rvt')) return 'icon-rvt';
        if (name.endsWith('.dwg')) return 'icon-dwg';
        return 'icon-file';
    }

    async handleVersionClick(target, itemId, itemName) {
        const modal = document.getElementById('version-modal');
        const filenameLabel = document.getElementById('version-modal-filename');
        const listBody = document.getElementById('version-list-body');
        const closeBtn = document.getElementById('close-version-modal');
        const closeBtn2 = document.getElementById('close-version-btn');

        if (!modal || !listBody) return;

        // Reset and Show Modal
        filenameLabel.textContent = itemName;
        listBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:40px;">Loading versions...</td></tr>';
        modal.style.display = 'flex';

        const hide = () => { modal.style.display = 'none'; };
        closeBtn.onclick = hide;
        closeBtn2.onclick = hide;

        // Compare Mode State
        this.isCompareMode = false;
        this.compareSelection = [];
        const toggleBtn = document.getElementById('toggle-compare-mode');
        if (toggleBtn) {
            toggleBtn.classList.remove('active');
            toggleBtn.innerHTML = '<i class="fas fa-columns"></i> 버전 비교';
            toggleBtn.onclick = () => {
                this.isCompareMode = !this.isCompareMode;
                this.compareSelection = [];
                toggleBtn.classList.toggle('active', this.isCompareMode);
                toggleBtn.innerHTML = this.isCompareMode ? '<i class="fas fa-times"></i> 비교 취소' : '<i class="fas fa-columns"></i> 버전 비교';
                if (this.currentVersions) {
                    this.renderVersionTable(listBody, this.currentVersions, itemName, itemId);
                }
            };
        }

        try {
            const url = `/api/hubs/${this.currentHubId}/projects/${this.currentProjectId}/contents/${encodeURIComponent(itemId)}/versions`;
            const response = await fetch(url);
            if (!response.ok) throw new Error('Failed to fetch versions');
            const versions = await response.json();

            this.currentVersions = versions;
            this.renderVersionTable(listBody, versions, itemName, itemId);
        } catch (err) {
            console.error('[Explorer] Version fetch error:', err);
            listBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:40px; color:var(--accent-red);">버전 정보를 가져올 수 없습니다.</td></tr>';
        }
    }

    renderVersionTable(container, versions, itemName, itemId) {
        container.innerHTML = '';
        versions.forEach(v => {
            const tr = document.createElement('tr');
            const dateStr = this.formatDate(v.name || v.displayName);

            // localStorage에서 해당 버전의 메모 조회
            const localKey = `memo-${v.id}`;
            const localMemo = localStorage.getItem(localKey) || v.description || '';

            const isSelected = this.compareSelection.includes(v.id);
            const btnText = this.isCompareMode ? (isSelected ? 'Selected' : 'Compare') : 'View';
            const btnStyle = (this.isCompareMode && isSelected) ? 'background-color: var(--accent-green); color: #fff;' : '';

            tr.innerHTML = `
                <td><span class="v-num-badge">V${v.vNumber}</span></td>
                <td>${dateStr}</td>
                <td>${v.createUserName || 'Unknown'}</td>
                <td>
                    <div class="v-desc-cell">
                        <input type="text" class="editable-desc" value="${localMemo}" placeholder="변경 사항 입력...">
                        <button class="btn-save-v" id="save-v-${v.vNumber}">Save</button>
                    </div>
                </td>
                <td class="col-vaction">
                    <button class="btn-view-v" id="btn-view-${v.vNumber}" style="${btnStyle}">${btnText}</button>
                </td>
            `;

            const saveBtn = tr.querySelector('.btn-save-v');
            const input = tr.querySelector('.editable-desc');
            saveBtn.onclick = async () => {
                const newDesc = input.value.trim();
                saveBtn.classList.add('saving');
                saveBtn.textContent = '...';
                try {
                    localStorage.setItem(`memo-${v.id}`, newDesc);
                    const memoUrl = '/api/version-memo';
                    await fetch(memoUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ versionUrn: v.id, memoText: newDesc })
                    }).catch(e => console.warn('[Explorer] Server sync failed, but localStorage updated.', e));

                    saveBtn.textContent = '✓';
                    setTimeout(() => { saveBtn.textContent = 'Save'; }, 2000);
                } catch (err) {
                    console.error('[Explorer] Save failed:', err);
                    saveBtn.textContent = 'Err';
                    setTimeout(() => { saveBtn.textContent = 'Save'; }, 2000);
                } finally {
                    saveBtn.classList.remove('saving');
                }
            };

            const viewBtn = tr.querySelector('.btn-view-v');
            if (this.isCompareMode) {
                viewBtn.onclick = () => {
                    const idx = this.compareSelection.indexOf(v.id);
                    if (idx > -1) {
                        this.compareSelection.splice(idx, 1);
                    } else {
                        if (this.compareSelection.length >= 2) return alert('이미 2개의 버전이 선택되었습니다.');
                        this.compareSelection.push(v.id);
                    }
                    this.renderVersionTable(container, versions, itemName, itemId);

                    if (this.compareSelection.length === 2) {
                        this.executeCompare(this.compareSelection[0], this.compareSelection[1]);
                        document.getElementById('version-modal').style.display = 'none';
                        this.isCompareMode = false;
                        this.compareSelection = [];
                    }
                };
            } else {
                viewBtn.onclick = async () => {
                    document.getElementById('version-modal').style.display = 'none';
                    await new Promise(r => setTimeout(r, 300));

                    const decodedId = this.decodeUrn(v.id);
                    try {
                        const { getSafeUrn } = await import('./viewer.js');
                        const finalUrn = getSafeUrn(decodedId);
                        console.log(`[FINAL ATTEMPT] 최종URN: ${finalUrn}`);

                        // Set globals for version dropdown loading
                        window.currentHubId = this.currentHubId;
                        window.currentProjectId = this.currentProjectId;
                        window.currentItemId = itemId;
                        window.currentVersionId = v.id;

                        this.loadVersionWithStatusCheck(finalUrn, `${itemName} (V${v.vNumber})`);
                    } catch (e) {
                        console.error('[Explorer] Failed to process URN:', e);
                    }
                };
            }

            container.appendChild(tr);
        });
    }

    executeCompare(urn1, urn2) {
        const v1 = (this.currentVersions || []).find(v => v.id === urn1);
        const v2 = (this.currentVersions || []).find(v => v.id === urn2);
        const itemName = document.getElementById('version-modal-filename')?.textContent || 'Model';

        const raw1 = this.decodeUrn(urn1);
        const raw2 = this.decodeUrn(urn2);

        // 🌟 [Data Extraction] 전역 헬퍼 함수를 사용하여 이름 생성
        const nameA = v1 ? window.formatBimModelName(itemName, v1.vNumber) : 'Version A';
        const nameB = v2 ? window.formatBimModelName(itemName, v2.vNumber) : 'Version B';

        if (typeof window.compareModels === 'function') {
            window.compareModels(raw1, raw2, nameA, nameB);
        } else {
            alert('compareModels 함수를 찾을 수 없습니다.');
        }
    }

    decodeUrn(encUrn) {
        if (!encUrn) return encUrn;
        if (encUrn.startsWith('urn:dXJu') || encUrn.startsWith('dXJu')) {
            try {
                const b64 = encUrn.replace('urn:', '').replace(/-/g, '+').replace(/_/g, '/');
                let decoded = atob(b64);
                return decoded.startsWith('urn:') ? decoded : 'urn:' + decoded;
            } catch (e) {
                return encUrn;
            }
        }
        return encUrn;
    }

    formatDate(dateString) {
        if (!dateString) return '-';
        const d = new Date(dateString);
        if (isNaN(d.getTime())) return dateString;
        const pad = (num) => String(num).padStart(2, '0');
        const yyyy = d.getFullYear();
        const mm = pad(d.getMonth() + 1);
        const dd = pad(d.getDate());
        const hh = pad(d.getHours());
        const min = pad(d.getMinutes());
        return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
    }

    async loadVersionWithStatusCheck(urn, label) {
        if (!urn) {
            alert('이 버전에는 뷰어용 데이터가 없습니다.');
            return;
        }
        const loading = document.getElementById('viewer-loading');
        if (loading) loading.style.display = 'flex';
        try {
            const cleanUrnForApi = urn.replace('urn:', '');
            const statusResp = await fetch(`/api/aps/model/${cleanUrnForApi}/status`, {
                headers: { 'Accept': 'application/json' }
            });
            if (!statusResp.ok) return this.loadIntoViewer(urn, label);
            const contentType = statusResp.headers.get("content-type");
            if (!contentType || !contentType.includes("application/json")) return this.loadIntoViewer(urn, label);
            const statusData = await statusResp.json();
            if (statusData.status === 'success' || statusData.progress === 'complete') {
                this.loadIntoViewer(urn, label);
            } else if (statusData.status === 'inprogress' || statusData.status === 'pending') {
                if (loading) loading.style.display = 'none';
                alert(`모델 변환 중입니다 (${statusData.progress}). 잠시 후 다시 시도해주세요.`);
            } else {
                if (loading) loading.style.display = 'none';
                alert('모델 변환에 실패했거나 데이터가 없습니다.');
            }
        } catch (err) {
            this.loadIntoViewer(urn, label);
        }
    }

    async loadIntoViewer(urn, name) {
        this.switchMode('viewer');
        const comparisonContainer = document.getElementById('comparison-container');
        if (comparisonContainer) comparisonContainer.style.display = 'none';
        if (this.viewerContainer) this.viewerContainer.style.display = 'block';

        if (window._viewer) {
            try {
                if (window.viewerLeft) { window.viewerLeft.finish(); window.viewerLeft = null; }
                if (window.viewerRight) { window.viewerRight.finish(); window.viewerRight = null; }
                if (window._viewer.model) window._viewer.unloadModel(window._viewer.model);
            } catch (e) { }
        }

        const { loadModel } = await import('./viewer.js');
        if (window._viewer) {
            try {
                if (!window._viewer.running) window._viewer.start();
                await loadModel(window._viewer, urn);
                const label = document.getElementById('model-name-label');
                if (label) label.textContent = name;
                const topBarName = document.getElementById('viewer-model-name');
                if (topBarName) topBarName.textContent = name;

                if (window.currentHubId && window.currentProjectId && window.currentItemId) {
                    try {
                        const { loadVersionsDropdown } = await import('./version-manager.js');
                        loadVersionsDropdown(window.currentHubId, window.currentProjectId, window.currentItemId, window.currentVersionId);
                    } catch (e) { }
                }
                window.dispatchEvent(new Event('resize'));
            } catch (err) {
                alert('모델을 로드하는 중 오류가 발생했습니다.');
            } finally {
                const loading = document.getElementById('viewer-loading');
                if (loading) loading.style.display = 'none';
            }
        }
    }

    refresh() {
        if (this.currentFolderId) {
            this.showFolder(this.currentHubId, this.currentProjectId, this.currentFolderId, this.history[this.history.length - 1].name);
        }
    }
}

export const explorer = new FolderExplorer();
window.explorer = explorer;
