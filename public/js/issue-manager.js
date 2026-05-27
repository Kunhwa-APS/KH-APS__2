/**
 * public/js/issue-manager.js
 * Manages custom 3D issues, markers, and local storage persistence with PDF Item Selection.
 */
import { unreadManager } from './unread-manager.js';

const WORK_TYPE_MAPPING = {
    'C': '토목',
    'A': '건축',
    'AM': '건축설비',
    'E': '전기',
    'M': '기계'
};

/**
 * IDBStorage: Promise-based wrapper for IndexedDB
 */
class IDBStorage {
    constructor(dbName = 'APS_DATABASE', storeName = 'issues_store') {
        this.dbName = dbName;
        this.storeName = storeName;
        this.db = null;
    }

    init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName);
                }
            };
            request.onsuccess = (e) => {
                this.db = e.target.result;
                resolve();
            };
            request.onerror = (e) => reject(e.target.error);
        });
    }

    get(key) {
        return new Promise((resolve, reject) => {
            if (!this.db) return resolve(null);
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.get(key);
            request.onsuccess = (e) => resolve(e.target.result);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    set(key, value) {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject(new Error('DB not initialized'));
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.put(value, key);
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
    }
}

export class IssueManager {
    constructor(viewer) {
        this.viewer = viewer;
        this.storage = new IDBStorage();
        this.issues = [];
        this.isCreationMode = false;
        this.exportPayload = null;
        this._onIssueClick = this._onIssueClick.bind(this);
        this._onCameraChange = this._onCameraChange.bind(this);
        this.tempIssueMarker = null;
        this.tempIssuePosition = null;
        this.htmlMarkersMap = new Map();
        this.activeStructureFilter = null;
        this.activeWorkTypeFilter = null;
        this.markersVisible = true;
        this.initOverlays();

        // [Fix] 마크업 관련 전역 이벤트 위임 바인딩
        this._bindGlobalMarkupEvents();

        this._syncLoop = this._syncLoop.bind(this);
        requestAnimationFrame(this._syncLoop);
    }

    _bindGlobalMarkupEvents() {
        // [Fix] Event Delegation을 통한 양방향 동기화 및 스타일 적용
        document.body.addEventListener('input', (e) => {
            if (!this.markupsExt) return; // 마크업 활성화 상태 확인

            if (e.target.id === 'markup-width-slider' || e.target.id === 'markup-width-input') {
                const val = parseFloat(e.target.value);
                if (isNaN(val)) return;
                
                // 양방향 UI 동기화
                if (e.target.id === 'markup-width-slider') {
                    const numInput = document.getElementById('markup-width-input');
                    if (numInput) numInput.value = val.toFixed(1);
                } else {
                    const slider = document.getElementById('markup-width-slider');
                    if (slider) slider.value = val;
                }
                
                // API 적용 (반드시 Number 타입, 호환성을 위해 속성 이름 이중화)
                this.markupsExt.setStyle({ 
                    strokeWidth: val,
                    'stroke-width': val
                });
            }

            if (e.target.id === 'markup-color-picker') {
                const hexColor = e.target.value;
                this.markupsExt.setStyle({ 
                    strokeColor: hexColor,
                    'stroke-color': hexColor
                });
            }
        });

        // [Fix] 전역 키보드 훅 (Del 키 마크업 삭제 - Capture 모드 적용)
        document.addEventListener('keydown', (e) => {
            // 사용자가 input 태그에 타이핑 중일 때는 삭제 방지
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            if ((e.key === 'Delete' || e.key === 'Backspace') && this.markupsExt) {
                const selection = this.markupsExt.getSelection();
                // 단일 객체이므로 length 검사를 제거하고 존재 여부만 확인
                if (selection) {
                    this.markupsExt.deleteMarkup(selection);
                    console.log('[Markup-Log] 선택된 마크업 삭제 완료');
                }
            }
        }, { capture: true }); // 이벤트 버블링을 삼키는 뷰어를 우회하기 위해 캡처링 단계에서 캐치
    }

    async init() {
        try {
            await this.storage.init();
            const legacyData = localStorage.getItem('aps-viewer-issues');
            if (legacyData) {
                const legacyIssues = JSON.parse(legacyData);
                await this.storage.set('issues', legacyIssues);
                localStorage.removeItem('aps-viewer-issues');
            }
            const saved = await this.storage.get('issues');
            this.issues = (saved || []).filter(i => !i.isComparison);
            this.renderIssueList();
            this.restorePins();

            const syncEvents = [
                Autodesk.Viewing.CAMERA_CHANGE_EVENT,
                Autodesk.Viewing.VIEWER_STATE_RESTORED_EVENT,
                Autodesk.Viewing.TRANSITION_COMPLETED_EVENT,
                Autodesk.Viewing.FOCAL_LENGTH_CHANGED_EVENT,
                Autodesk.Viewing.MODEL_ROOT_LOADED_EVENT,
                Autodesk.Viewing.GEOMETRY_LOADED_EVENT
            ];
            syncEvents.forEach(evt => {
                this.viewer.removeEventListener(evt, this._onCameraChange);
                this.viewer.addEventListener(evt, this._onCameraChange);
            });

            this.viewer.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, () => {
                try {
                    this.restorePins();
                } catch (e) {
                    console.error('[IssueManager] GEOMETRY_LOADED_EVENT 핸들러 오류 (다른 이벤트에 영향 없음):', e);
                }
            });

            // [Fix] #bulk-pdf-btn 전체/선택 내보내기 버튼 이벤트 바인딩 복구
            const bulkBtn = document.getElementById('bulk-pdf-btn');
            if (bulkBtn) bulkBtn.onclick = () => this.openPdfExportModal();

            // Sync with Server on Init
            await this.syncWithServer();

            this._injectMarkerToggle();
        } catch (err) {
            console.error('[IssueManager] Init failed:', err);
        }
    }

    _injectMarkerToggle() {
        if (document.getElementById('issue-marker-toggle-wrap')) return;
        const container = this.viewer.container;
        const wrap = document.createElement('div');
        wrap.id = 'issue-marker-toggle-wrap';
        wrap.innerHTML = `
            <label class="issue-toggle-label" title="이슈 마커 표시/숨기기">
                <i class="fas fa-map-marker-alt"></i>
                <span>이슈</span>
                <div class="issue-toggle-track">
                    <input type="checkbox" id="issue-marker-toggle-cb" checked>
                    <span class="issue-toggle-thumb"></span>
                </div>
            </label>
        `;
        container.style.position = 'relative';
        container.appendChild(wrap);
        document.getElementById('issue-marker-toggle-cb').addEventListener('change', (e) => {
            this.toggleMarkerVisibility(e.target.checked);
        });
    }

    toggleMarkerVisibility(visible) {
        this.markersVisible = visible;
        this.htmlMarkersMap.forEach((data) => {
            if (data.element) {
                data.element.style.visibility = visible ? 'visible' : 'hidden';
            }
        });
        if (this.tempIssueMarker) {
            this.tempIssueMarker.style.visibility = visible ? 'visible' : 'hidden';
        }
    }

    initOverlays() {
        if (!this.viewer.impl.overlayScenes['issue-markers']) {
            this.viewer.impl.createOverlayScene('issue-markers');
        }
    }

    async saveIssues(issue = null) {
        try {
            await this.storage.set('issues', this.issues);

            if (issue) {
                const response = await fetch('/api/issues', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(issue)
                });
                if (!response.ok) {
                    console.error('[IssueManager] 이슈 서버 동기화 실패:', response.status, response.statusText);
                }
            }
        } catch (e) {
            console.error('[IssueManager] Save failed:', e);
        } finally {
            // 서버 저장이나 로컬 저장 중 에러가 발생해도 렌더링이 멈추지 않도록 보호
            try {
                this.renderIssueList();
            } catch (renderError) {
                console.error('[IssueManager] renderIssueList 에러 발생 (렌더링 보호):', renderError);
            }
        }
    }

    async syncWithServer() {
        try {
            const resp = await fetch('/api/issues');
            if (resp.ok) {
                const serverIssues = await resp.json();
                // Merge or replace local issues
                this.issues = serverIssues.filter(i => !i.isComparison);
                await this.storage.set('issues', this.issues);
                this.renderIssueList();
                this.restorePins();
                console.log('[IssueManager] Synced with server:', this.issues.length);
            }
        } catch (err) {
            console.warn('[IssueManager] Server sync failed (offline?):', err);
        }
    }

    toggleCreationMode(on) {
        this.isCreationMode = (on !== undefined) ? on : !this.isCreationMode;
        const targetElement = this.viewer.canvas;
        targetElement.removeEventListener('click', this._onIssueClick);
        if (this.isCreationMode) {
            targetElement.style.setProperty('cursor', 'crosshair', 'important');
            this.viewer.container.style.setProperty('cursor', 'crosshair', 'important');
            targetElement.addEventListener('click', this._onIssueClick);
        } else {
            targetElement.style.cursor = '';
            this.viewer.container.style.cursor = '';
        }
        const btn = document.getElementById('add-issue-tool-btn');
        if (btn) btn.classList.toggle('active', this.isCreationMode);
    }

    _onIssueClick(e) {
        const rect = this.viewer.container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const result = this.viewer.impl.hitTest(x, y, true);

        if (result && result.dbId) {
            const dbId = result.dbId;
            this.removeTempMarker();
            this.tempIssuePosition = result.intersectPoint.clone();

            const marker = document.createElement('div');
            marker.id = 'temp-issue-marker-div';
            marker.className = 'issue-temp-marker';
            this.viewer.container.appendChild(marker);
            this.tempIssueMarker = marker;

            this.syncAllMarkers();
            this.toggleCreationMode(false);

            // Enter Markup Mode
            this.enterMarkupMode(dbId, result.intersectPoint);

            // [Fix] 캡처 완료 시 모달 표시 여부와 무관하게 dataset에 저장
            this.captureIssueThumbnail((base64) => {
                const modal = document.getElementById('issue-modal');
                if (modal && base64) {
                    modal.dataset.thumbnail = base64;
                    console.log('[IssueManager] thumbnail 저장 완료, 길이:', base64.length);
                    const preview = document.getElementById('issue-preview-img');
                    if (preview && modal.style.display === 'flex') {
                        preview.src = base64;
                        const previewWrap = document.getElementById('modal-image-preview');
                        if (previewWrap) previewWrap.style.display = 'flex';
                    }
                }
            });
        } else {
            this.toggleCreationMode(false);
        }
    }

    _onCameraChange() {
        this.syncAllMarkers();
    }

    _syncLoop() {
        this.syncAllMarkers();
        requestAnimationFrame(this._syncLoop);
    }

    syncAllMarkers() {
        if (this.tempIssueMarker && this.tempIssuePosition) {
            const screenPos = this.viewer.worldToClient(this.tempIssuePosition);
            this.tempIssueMarker.style.left = `${Math.round(screenPos.x)}px`;
            this.tempIssueMarker.style.top = `${Math.round(screenPos.y)}px`;

            // 화면 밖으로 나갔는지 2D 좌표로만 단순 확인 (너무 엄격한 Z축 깊이 검사 제거)
            if (screenPos.x >= 0 && screenPos.y >= 0 && 
                screenPos.x <= this.viewer.container.clientWidth && 
                screenPos.y <= this.viewer.container.clientHeight) {
                this.tempIssueMarker.style.display = 'block';
                this.tempIssueMarker.style.visibility = 'visible';
            } else {
                this.tempIssueMarker.style.visibility = 'hidden';
            }
        }

        this.htmlMarkersMap.forEach((data) => {
            const worldPos = data.position;
            const screenPoint = this.viewer.worldToClient(new THREE.Vector3(worldPos.x, worldPos.y, worldPos.z));

            if (!screenPoint || (screenPoint.x === 0 && screenPoint.y === 0)) {
                data.element.style.display = 'none';
                return;
            }

            data.element.style.left = `${Math.round(screenPoint.x)}px`;
            data.element.style.top = `${Math.round(screenPoint.y)}px`;

            // 화면 밖으로 나갔는지 2D 좌표로만 단순 확인 (너무 엄격한 Z축 깊이 검사 제거)
            if (screenPoint.x >= 0 && screenPoint.y >= 0 && 
                screenPoint.x <= this.viewer.container.clientWidth && 
                screenPoint.y <= this.viewer.container.clientHeight) {
                data.element.style.display = 'block';
                data.element.style.visibility = 'visible';
            } else {
                data.element.style.visibility = 'hidden';
            }
        });
    }

    removeTempMarker() {
        if (this.tempIssueMarker) {
            this.tempIssueMarker.remove();
            this.tempIssueMarker = null;
        }
        this.tempIssuePosition = null;
    }

    captureIssueThumbnail(callback, markupExt = null) {
        try {
            this.viewer.impl.invalidate(true, true, true);
        } catch (e) {
            console.warn('[IssueManager] 뷰어 갱신 중 예외:', e);
        }

        requestAnimationFrame(() => {
            const width = this.viewer.container.clientWidth;
            const height = this.viewer.container.clientHeight;
            this.viewer.getScreenShot(width, height, async (blobData) => {
                if (!blobData) {
                    console.error('[IssueManager] 썸네일 캡처 실패: 반환값 없음');
                    return callback(null);
                }

                try {
                    let base64data = blobData;

                    // 1. blob URL 문자열인 경우 원본 Blob 객체를 fetch로 확보
                    if (typeof blobData === 'string' && blobData.startsWith('blob:')) {
                        const res = await fetch(blobData);
                        const rawBlob = await res.blob();
                        base64data = await new Promise(resolve => {
                            const reader = new FileReader();
                            reader.onloadend = () => resolve(reader.result);
                            reader.readAsDataURL(rawBlob);
                        });
                    }
                    // 2. 이미 순수 Blob 객체인 경우
                    else if (blobData instanceof Blob) {
                        base64data = await new Promise(resolve => {
                            const reader = new FileReader();
                            reader.onloadend = () => resolve(reader.result);
                            reader.readAsDataURL(blobData);
                        });
                    }

                    if (!base64data) return callback(null);

                    // 확보된 안정적 Base64로 마크업 병합 엔진 호출
                    this._performHardCanvasCompositing(base64data, width, height, markupExt, callback);
                } catch (error) {
                    console.error('[IssueManager] Base64 변환 실패:', error);
                    callback(null);
                }
            });
        });
    }

    async _performHardCanvasCompositing(base64data, w, h, markupExt, callback) {
        const img = new Image();

        img.onload = async () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = w; canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(0, 0, w, h);
                ctx.drawImage(img, 0, 0, w, h);

                if (markupExt) {
                    await new Promise(resolve => markupExt.renderToCanvas(ctx, resolve));
                }
                const finalB64 = canvas.toDataURL('image/jpeg', 0.85);
                callback(finalB64);
            } catch (err) {
                console.error('[IssueManager] 캔버스 컴포지팅 중 보안 에러(Tainted):', err);
                // 에러 발생 시 원본 base64data(마크업 없음)라도 반환
                callback(base64data);
            }
        };

        img.onerror = () => {
            console.warn('[IssueManager] 썸네일 컴포지트 img 로드 실패 방어 코드 발동');
            // 로드 실패 시에도 최하위 원본은 살려서 반환
            callback(base64data);
        };

        // 절대적으로 안전한 Base64 데이터를 src로 할당
        img.src = base64data;
    }

    showCreateModal(dbId, point, thumbnail) {
        const modal = document.getElementById('issue-modal');
        if (!modal) return;

        // 동적 Assignee 드롭다운 바인딩
        this.populateAssigneeDropdown();

        // [Fix] 신규 모달 열기 전 폼 초기화 (Stale State 버그 방지)
        const titleInput = document.getElementById('issue-title');
        if (titleInput) titleInput.value = '';
        const descInput = document.getElementById('issue-desc');
        if (descInput) descInput.value = '';
        const statusSelect = document.getElementById('issue-status');
        if (statusSelect) statusSelect.value = 'Open';
        const assigneeInput = document.getElementById('issue-assignee');
        if (assigneeInput) assigneeInput.value = '';
        const resDescInput = document.getElementById('issue-resolution-desc');
        if (resDescInput) resDescInput.value = '';

        const resSection = document.getElementById('issue-resolution-section');
        if (resSection) resSection.style.display = 'none';
        const afterPreviewWrap = document.getElementById('modal-after-image-preview');
        if (afterPreviewWrap) afterPreviewWrap.style.display = 'none';

        delete modal.dataset.afterThumbnail;
        delete modal.dataset.afterViewstate;
        delete modal.dataset.editId;

        modal.dataset.mode = 'create';
        modal.dataset.dbId = dbId;
        modal.dataset.point = JSON.stringify(point);
        modal.dataset.viewstate = JSON.stringify(this.viewer.getState());
        modal.dataset.urn = this.viewer.model?.getData().urn;
        modal.dataset.itemId = window.currentItemId || null;

        // [Fix] showCreateModal에서 thumbnail을 modal.dataset에 반드시 저장
        if (thumbnail) {
            modal.dataset.thumbnail = thumbnail;
            const img = document.getElementById('issue-preview-img');
            if (img) img.src = thumbnail;
            const previewWrap = document.getElementById('modal-image-preview');
            if (previewWrap) previewWrap.style.display = 'flex';
        } else {
            modal.dataset.thumbnail = '';
        }
        modal.style.display = 'flex';

        // [Safety UI Injection] 작성 시간 독립 주입 (Non-blocking)
        setTimeout(() => safelyInjectIssueTime(), 100);

        // Metadata extraction
        const parts = (document.getElementById('viewer-model-name')?.innerText || '').split('_');
        if (parts.length >= 6) {
            const structure = document.getElementById('issue-structure');
            const workType = document.getElementById('issue-work-type');
            if (structure) structure.value = parts[4].split('.')[0];
            if (workType) {
                const code = parts[5].split('.')[0].toUpperCase();
                workType.value = WORK_TYPE_MAPPING[code] || code;
            }
        }
    }

    async populateAssigneeDropdown(selectedValue = "") {
        const assigneeSelect = document.getElementById('issue-assignee');
        if (!assigneeSelect || assigneeSelect.tagName !== 'SELECT') return;

        assigneeSelect.innerHTML = '<option value="">서버에서 데이터 로딩 중...</option>';

        try {
            // 🌟 Autodesk에 직접 가지 않고, 우리 백엔드 프록시 서버에 요청!
            const projectId = window.currentProjectId || '';
            const hubId = window.currentHubId || '';
            const response = await fetch(`/api/auth/profile?projectId=${projectId}&hubId=${hubId}`); 
            if (!response.ok) throw new Error('백엔드 프록시 통신 실패');

            const data = await response.json();
            console.log("🕵️‍♂️ 서버가 보내준 멤버 데이터 원본:", data);

            // 데이터 파싱 방어 로직 (객체 형태의 프로필 대응 및 다양한 필드 지원)
            const memberList = data.results || data.users || data.data || data.items || data.result || (Array.isArray(data) ? data : (data.name ? [data] : []));

            if (memberList.length === 0) {
                assigneeSelect.innerHTML = '<option value="">등록된 프로젝트 구성원이 없습니다</option>';
                return;
            }

            assigneeSelect.innerHTML = '<option value="">담당자 선택</option>'; 
            memberList.forEach(user => {
                const memberName = user.name || user.nickname || user.userName || '알 수 없음'; 
                if (memberName) {
                    const option = document.createElement('option');
                    option.value = memberName;
                    option.textContent = memberName;
                    if (memberName === selectedValue) option.selected = true;
                    assigneeSelect.appendChild(option);
                }
            });
        } catch (error) {
            console.error("[서버 연동 실패]", error);
            assigneeSelect.innerHTML = '<option value="">⚠️ 서버 API 에러</option>';
        }
    }

    addIssue(data) {
        const issue = {
            id: Date.now(),
            ...data,
            createdAt: new Date().toISOString()
        };
        this.issues.push(issue);
        this.saveIssues(issue); // Pass issue to sync to server
        this.createPin(issue);
        this.removeTempMarker();
        this.toggleCreationMode(false);
        return true;
    }

    updateIssue(id, data) {
        const index = this.issues.findIndex(i => i.id === id);
        if (index === -1) return false;
        const updated = { ...this.issues[index], ...data, updatedAt: new Date().toISOString() };
        this.issues[index] = updated;
        this.saveIssues(updated); // Pass issue to sync to server
        this.restorePins();
        return true;
    }

    async enterMarkupMode(dbId, point, mode = 'create') {
        // [Measure Tool Guard] 측정 도구가 활성화되어 있는 경우 마크업 그리기 모드를 우회하여 측정이 해제되지 않도록 방지
        const measureExt = this.viewer.getExtension('Autodesk.Measure');
        const isMeasureActive = measureExt && (
            (typeof measureExt.isActive === 'function' && measureExt.isActive()) ||
            (this.viewer.toolController && this.viewer.toolController.getActiveTool() === 'measure')
        );

        if (isMeasureActive) {
            console.log("📏 [Measure Tool Active] 측정 도구가 활성화되어 있어 마크업 편집 모드를 건너뛰고 캡처를 진행합니다.");
            this.captureIssueThumbnail((b64) => {
                const modal = document.getElementById('issue-modal');
                if (mode === 'create') {
                    this.showCreateModal(dbId, point, b64);
                } else if (modal) {
                    modal.dataset.afterThumbnail = b64;
                    const prev = document.getElementById('issue-after-preview-img');
                    if (prev) {
                        prev.src = b64;
                        const afterPreviewContainer = document.getElementById('modal-after-image-preview');
                        if (afterPreviewContainer) {
                            afterPreviewContainer.style.display = 'flex';
                        }
                    }
                    modal.style.display = 'flex';
                }
            }, null);
            return;
        }

        // [Guard] 툴바 버튼 클릭으로 이미 마크업이 활성화된 경우 중복 로드 방지
        if (!this.markupsExt) {
            this.markupsExt = await this.viewer.loadExtension('Autodesk.Viewing.MarkupsCore');
        }
        if (this.markupsExt && !this.markupsExt.isInEditMode?.()) {
            this.markupsExt.enterEditMode();
        }

        // 도화지(SVG) 레이어 강제 최상단 배치
        const markupSvg = document.querySelector('.markups-svg');
        if (markupSvg) {
            markupSvg.style.setProperty('z-index', '9999', 'important');
            markupSvg.style.setProperty('pointer-events', 'auto', 'important');
        }
        
        console.log("✅ [Issue UI] MarkupsCore 로드 및 마크업 준비 완료");
        
        // 전역 접근을 위해 인스턴스 저장
        window.currentMarkupExt = this.markupsExt;

        this.markupContext = { dbId, point, mode };
        this.renderMarkupToolbar();
        
        // 실제 커스텀 툴바 DOM 요소를 탐색하여 강제 노출
        const customToolbar = document.querySelector('#markup-toolbar'); 
        if (customToolbar) {
            const topBar = document.getElementById('viewer-top-bar') || document.querySelector('.compare-bar');
            const topBarHeight = topBar ? (topBar.offsetHeight || 50) : 50;
            customToolbar.style.setProperty('top', `${topBarHeight + 70}px`, 'important');
            customToolbar.style.setProperty('display', 'flex', 'important');
            customToolbar.style.setProperty('z-index', '10000', 'important');
            customToolbar.style.setProperty('position', 'absolute', 'important'); // 화면 가운데 오도록
            console.log("✅ [Toolbar UI] 커스텀 툴바를 찾아 화면에 노출했습니다:", customToolbar);
        } else {
            console.error("❌ [Toolbar UI Error] 커스텀 툴바 요소를 찾지 못했습니다! HTML 구조를 확인하세요.");
        }
        
        // 마크업 모드 진입 시 상단 비교 바 강제 숨김
        const compareBar = document.getElementById('compare-bar') || document.querySelector('.compare-bar');
        if (compareBar) {
            compareBar.style.setProperty('display', 'none', 'important');
            compareBar.style.setProperty('visibility', 'hidden', 'important');
            compareBar.style.setProperty('opacity', '0', 'important');
            compareBar.style.setProperty('z-index', '-1', 'important');
            console.log("🚨 [Hide Bar Success] compare-bar 강제 숨김 처리 완료");
        }
    }

    renderMarkupToolbar() {
        if (document.getElementById('markup-toolbar')) {
            const existingTb = document.getElementById('markup-toolbar');
            existingTb.style.setProperty('display', 'flex', 'important');
            existingTb.style.setProperty('z-index', '10000', 'important');
            return;
        }
        const tb = document.createElement('div');
        tb.id = 'markup-toolbar';
        tb.className = 'markup-toolbar';
        tb.innerHTML = `
            <div class="markup-tool-group">
                <button class="markup-btn" data-tool="freehand" title="Pen"><i class="fas fa-pen"></i></button>
                <button class="markup-btn" data-tool="rectangle" title="Rectangle"><i class="fas fa-square"></i></button>
                <button class="markup-btn" data-tool="cloud" title="Cloud"><i class="fas fa-cloud"></i></button>
                <button class="markup-btn" data-tool="arrow" title="Arrow"><i class="fas fa-long-arrow-alt-right"></i></button>
                <button class="markup-btn" data-tool="text" title="Text"><i class="fas fa-font"></i></button>
            </div>
            <div class="markup-style-group" style="display:flex; align-items:center; gap:10px; margin: 0 15px;">
                <input type="color" id="markup-color-picker" value="#FF0000" title="선 색상">
                <input type="range" id="markup-width-slider" min="0.1" max="15" step="0.1" value="2.5" title="선 두께 슬라이더" style="width: 80px;">
                <input type="number" id="markup-width-input" min="0.1" max="15" step="0.1" value="2.5" title="선 두께 숫자" style="width: 60px;">
            </div>
            <button class="markup-finish-btn">작성 완료</button>
        `;
        document.body.appendChild(tb);
        
        // 뷰어나 다른 UI에 가려지지 않도록 강제 노출
        tb.style.setProperty('display', 'flex', 'important');
        tb.style.setProperty('z-index', '10000', 'important');
        
        tb.querySelectorAll('.markup-btn').forEach(btn => {
            btn.onclick = () => {
                const tool = btn.dataset.tool;
                let markupTool;
                switch (tool) {
                    case 'freehand': markupTool = new Autodesk.Viewing.Extensions.Markups.Core.EditModeFreehand(this.markupsExt); break;
                    case 'rectangle': markupTool = new Autodesk.Viewing.Extensions.Markups.Core.EditModeRectangle(this.markupsExt); break;
                    case 'cloud': markupTool = new Autodesk.Viewing.Extensions.Markups.Core.EditModeCloud(this.markupsExt); break;
                    case 'arrow': markupTool = new Autodesk.Viewing.Extensions.Markups.Core.EditModeArrow(this.markupsExt); break;
                    case 'text': markupTool = new Autodesk.Viewing.Extensions.Markups.Core.EditModeText(this.markupsExt); break;
                }
                
                // 마크업 툴 변경 (API 버전에 맞게 방어적 호출)
                if (this.markupsExt.changeEditMode) {
                    this.markupsExt.changeEditMode(markupTool);
                } else if (this.markupsExt.changeShape) {
                    this.markupsExt.changeShape(markupTool);
                }
            };
        });

        tb.querySelector('.markup-finish-btn').onclick = async () => {
            const svg = this.markupsExt.generateData(); // 데이터 추출
            await this._captureMarkupScreenshot(svg);
            this.markupsExt.leaveEditMode();
            this.markupsExt.hide();
            
            // UI를 안전하게 숨김 또는 제거
            tb.style.setProperty('display', 'none', 'important');
            tb.remove();
            
            this.markupsExt = null; // 마크업 종료 시 인스턴스 해제로 전역 이벤트 오작동 방지

            // [UI] 마크업 완료 시 상단 비교 바 복구 (CSS 클래스 토글 방식)
            const compareBarToRestore = document.getElementById('compare-bar') || document.querySelector('.compare-bar');
            if (compareBarToRestore) {
                compareBarToRestore.style.setProperty('display', 'flex', 'important'); // 기존 레이아웃에 맞게 flex 또는 block
                compareBarToRestore.style.setProperty('visibility', 'visible', 'important');
                compareBarToRestore.style.setProperty('opacity', '1', 'important');
                compareBarToRestore.style.setProperty('z-index', '10', 'important');
                console.log("✅ [Show Bar] compare-bar 복구 완료");
            }
        };
    }

    async _captureMarkupScreenshot(svg) {
        const mode = this.markupContext?.mode || 'create';
        return new Promise(resolve => {
            this.captureIssueThumbnail(b64 => {
                const modal = document.getElementById('issue-modal');
                if (mode === 'create') this.showCreateModal(this.markupContext?.dbId || null, this.markupContext?.point || null, b64);
                else if (modal) {
                    modal.dataset.afterThumbnail = b64;
                    const prev = document.getElementById('issue-after-preview-img');
                    if (prev) { prev.src = b64; document.getElementById('modal-after-image-preview').style.display = 'flex'; }
                    modal.style.display = 'flex';
                }
                if (modal) modal.dataset.markup = svg;
                resolve();
            }, this.markupsExt);
        });
    }

    createPin(issue) {
        if (!issue || !issue.id) return;
        if (!issue.point || typeof issue.point.x === 'undefined') {
            console.warn("[IssueManager] createPin: 3D 좌표(point)가 누락되어 핀을 생성할 수 없습니다.", issue);
            return;
        }

        if (this.htmlMarkersMap.has(issue.id)) return;
        const marker = document.createElement('div');
        marker.className = 'issue-marker';
        if (issue.status === 'Closed') marker.classList.add('green');
        marker.dataset.id = issue.id;
        marker.dataset.dbId = issue.dbId || '';

        // [Fix] unreadManager TypeError 방지 (Optional Chaining & Fallback)
        let isUnread = false;
        if (typeof unreadManager !== 'undefined' && unreadManager && typeof unreadManager.isUnread === 'function') {
            try { isUnread = unreadManager.isUnread(issue.id); } catch (e) { }
        }

        if (isUnread) {
            const b = document.createElement('div');
            b.className = 'marker-unread-badge'; b.textContent = 'N';
            marker.appendChild(b);
        }
        // [Fix] 아이콘 중복 렌더링 삭제: CSS 원형 마커만 표시
        // marker.innerHTML += '<i class="fas fa-map-marker-alt"></i>';
        
        this.viewer.container.appendChild(marker);
        marker.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault(); // [Fix] 부작용 방지
            
            if (typeof unreadManager !== 'undefined' && unreadManager && typeof unreadManager.markAsRead === 'function') {
                if (unreadManager.markAsRead(issue.id)) {
                    const b = marker.querySelector('.marker-unread-badge');
                    if (b) b.remove();
                    this.renderIssueList();
                }
            }
            this.focusIssue(issue);
            // [Fix] 마커 클릭 시 팝업창(수정 모달) 열기 연동
            this.showEditModal(issue.id);
        };
        this.htmlMarkersMap.set(issue.id, {
            element: marker,
            position: new THREE.Vector3(issue.point.x, issue.point.y, issue.point.z)
        });
        this._applyTargetFilter(issue.id);
    }

    _applyTargetFilter(id) {
        const data = this.htmlMarkersMap.get(id);
        const issue = this.issues.find(i => i.id === id);
        if (!data || !issue) return;
        let visible = true;
        if (this.activeStructureFilter && issue.structure_name !== this.activeStructureFilter) visible = false;
        if (this.activeWorkTypeFilter && issue.work_type !== this.activeWorkTypeFilter) visible = false;
        data.element.style.visibility = (visible && this.markersVisible !== false) ? 'visible' : 'hidden';
    }

    restorePins() {
        try {
            this.htmlMarkersMap.forEach(d => d.element.remove());
            this.htmlMarkersMap.clear();

            // [Fix] getGuid()는 APS Viewer API에 존재하지 않으므로 getUrn()으로 교체
            let urn = null;
            try {
                urn = this.viewer.model?.getData()?.urn || this.viewer.model?.getUrn?.();
            } catch (e) {
                console.warn('[IssueManager] 모델 URN 추출 실패 (핀 필터링 없이 전체 표시):', e);
            }

            // [Fix] 현재 로드된 모델의 URN을 기준으로 filter() 적용 (오류가 있던 modelGuid 참조 변경)
            const filteredIssues = this.issues.filter(i => {
                if (!urn) return true; // 현재 모델 정보가 없을 땐 모두 표시
                if (!i.urn) return true; // 예외적으로 urn 정보 없이 생성된 구 이슈
                return i.urn === urn;
            });
            
            filteredIssues.forEach(i => this.createPin(i));
            this.syncAllMarkers();
        } catch (error) {
            console.error('[IssueManager] Failed to restore pins:', error);
        }
    }

    renderIssueList() {
        const container = document.getElementById(' issue-list-container') || document.getElementById('issue-list-container') || document.querySelector('.issue-list-container');
        if (!container) return;

        // 활성화된 프로젝트 ID 추론 로직 (이슈 렌더링 함수 내부)
        var urlParams = new URLSearchParams(window.location.search);
        var currentPid = urlParams.get('projectId') || urlParams.get('id');
        
        if (!currentPid) {
            var activeFolder = document.querySelector('.project-folder.active, .tree-node.selected, .project-item.active, .jstree-clicked');
            if (activeFolder) {
                currentPid = activeFolder.getAttribute('data-project-id') || 
                             activeFolder.getAttribute('data-id') || 
                             activeFolder.getAttribute('data-urn') ||
                             activeFolder.id;
            }
        }
        
        // 기존 전역 변수 및 Explorer 활성 변수가 있다면 최우선 사용
        currentPid = window.activeExplorerProjectId || window.currentProjectId || currentPid;

        // jstree의 node ID 포맷(예: project|hubId|projectId) 대응 파싱
        if (currentPid && typeof currentPid === 'string' && currentPid.indexOf('|') !== -1) {
            var tokens = currentPid.split('|');
            if (tokens.length > 2) {
                currentPid = tokens[2];
            }
        }

        // 대시보드가 활성화되어 있다면 필터링을 적용하지 않음 (모든 이슈 표시)
        const dashboardPremium = document.getElementById('dashboard-premium-container');
        const dashboardLegacy = document.getElementById('project-selection-dashboard');
        const isDashboardActive = (dashboardPremium && dashboardPremium.style.display !== 'none' && dashboardPremium.style.display !== '') || 
                                  (dashboardLegacy && dashboardLegacy.style.display !== 'none' && dashboardLegacy.style.display !== '');
        
        if (isDashboardActive) {
            currentPid = null;
        }

        var allIssues = this.issues || [];
        var filteredIssues = allIssues;

        console.log("Current PID:", currentPid, "Active Explorer PID:", window.activeExplorerProjectId, "Sample Issue:", allIssues[0]);

        if (currentPid && allIssues.length > 0) {
            filteredIssues = allIssues.filter(function(issue) {
                var issuePid = issue.projectId || issue.project_id || issue.folderId; 
                
                // projectId가 아예 없는 예전 데이터면 우선 숨김 처리
                if (!issuePid) return false;

                return String(issuePid) === String(currentPid);
            });
        }

        // 속성 매칭 실패로 억울하게 다 날아간 경우 원본 복구 (개발 중 안전장치)
        if (currentPid && filteredIssues.length === 0 && allIssues.length > 0) {
            console.warn("필터링된 결과가 0건입니다. 매칭 키를 확인하세요. 임시로 전체를 표시합니다.");
            filteredIssues = allIssues; 
        }

        // [Fix] 우측 패널 상단의 이슈 개수 요소 안전하게 업데이트
        var countSpan = document.getElementById(' issue-count') || document.getElementById('issue-count') || document.querySelector('.issue-count');
        if (countSpan) {
            countSpan.innerText = filteredIssues.length;
        }

        if (filteredIssues.length === 0) {
            container.innerHTML = '<div class="issue-empty-state"><p>등록된 이슈가 없습니다.</p></div>';
            return;
        }
        const sorted = [...filteredIssues].sort((a, b) => b.id - a.id);

        // [DEBUG] 이슈 데이터 구조 확인 - 썸네일 키 파악용
        if (sorted.length > 0) {
            console.log('[DEBUG] 이슈 데이터 샘플 (thumbnail 키 확인):', JSON.stringify(Object.keys(sorted[0])));
            console.log('[DEBUG] thumbnail 값 타입:', typeof sorted[0].thumbnail, '| 길이:', (sorted[0].thumbnail || '').length);
        }

        container.innerHTML = sorted.map(i => {
            // [Fix] unreadManager TypeError 방지
            let isUnread = false;
            if (typeof unreadManager !== 'undefined' && unreadManager && typeof unreadManager.isUnread === 'function') {
                try { isUnread = unreadManager.isUnread(i.id); } catch (e) { }
            }

            const isComparison = !!i.isComparison;
            const badgeHtml = isComparison 
                ? `<span class="issue-comp-badge" style="background:#dc2626; color:#fff; font-size:10px; padding:2px 6px; border-radius:4px; font-weight:bold; margin-right:6px; display:inline-block; vertical-align:middle;">VS</span>`
                : '';
            const versionHtml = isComparison && (i.versionA || i.versionB)
                ? `<span style="font-size:11px; color:#f87171; margin-left:6px;">(v${i.versionA} ↔ v${i.versionB})</span>`
                : '';

            return `
                <div class="issue-item ${isUnread ? 'unread' : ''}" data-id="${i.id}">
                    <div class="issue-item-main">
                        <label class="issue-check-wrap" onclick="event.stopPropagation()">
                            <input type="checkbox" class="issue-check" data-id="${i.id}">
                        </label>
                        ${isComparison && i.thumbnail && i.afterThumbnail ? `
                            <div class="issue-thumbnail" style="display:flex; padding:0; overflow:hidden; background:#000;">
                                <img src="${i.thumbnail}" style="width:50%; height:100%; object-fit:cover;">
                                <img src="${i.afterThumbnail}" style="width:50%; height:100%; object-fit:cover; border-left:1px solid rgba(255,255,255,0.2);">
                            </div>
                        ` : `
                            <img src="${i.thumbnail || i.afterThumbnail || ''}" class="issue-thumbnail" onerror="this.style.visibility='hidden'">
                        `}
                        <div class="issue-info">
                            <div class="issue-item-header">
                                <span class="issue-status-badge ${i.status.toLowerCase()}">${i.status}</span>
                                ${badgeHtml}
                                <span class="issue-item-title">${i.title}${versionHtml}</span>
                                <div class="issue-item-actions">
                                    ${(i.status || '').toLowerCase() === 'closed' ? `<button class="issue-btn-pdf" title="Export PDF">📄</button>` : ''}
                                    ${(i.status || '').toLowerCase() === 'closed' ? `<button class="issue-btn-resolve" title="해결 상태 캡처"><i class="fas fa-camera"></i></button>` : ''}
                                    <button class="issue-btn-edit"><i class="fas fa-edit"></i></button>
                                    <button class="issue-btn-delete"><i class="fas fa-trash-alt"></i></button>
                                </div>
                            </div>
                            <div class="issue-item-desc">${i.description}</div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        container.querySelectorAll('.issue-item').forEach(item => {
            const id = parseInt(item.dataset.id);
            const issue = this.issues.find(i => i.id === id);
            item.onclick = (e) => {
                if (e.target.closest('button') || e.target.closest('input')) return;

                if (typeof unreadManager !== 'undefined' && unreadManager && typeof unreadManager.markAsRead === 'function') {
                    if (unreadManager.markAsRead(id)) {
                        item.classList.remove('unread');
                        const m = this.htmlMarkersMap.get(id);
                        if (m) { const b = m.element.querySelector('.marker-unread-badge'); if (b) b.remove(); }
                    }
                }
                this.focusIssue(issue);
            };
            const pdfBtn = item.querySelector('.issue-btn-pdf');
            if (pdfBtn) pdfBtn.onclick = (e) => { e.stopPropagation(); this.openPdfExportModal(id); };

            // [Fix] 카메라(해결) 아이콘 클릭 시 마크업 모드 진입 바인딩
            const resolveBtn = item.querySelector('.issue-btn-resolve');
            if (resolveBtn) {
                resolveBtn.onclick = (e) => {
                    e.stopPropagation();
                    this.focusIssue(issue);
                    setTimeout(() => {
                        this.enterMarkupMode(id, new THREE.Vector3(issue.point.x, issue.point.y, issue.point.z), 'resolve');
                    }, 500); // 줌 이동 시간 대기 후 캡처 트리거
                };
            }

            item.querySelector('.issue-btn-edit').onclick = (e) => { e.stopPropagation(); this.showEditModal(id); };
            item.querySelector('.issue-btn-delete').onclick = (e) => { e.stopPropagation(); this.deleteIssue(id); };
            item.querySelector('.issue-check').onchange = () => this._updateBulkBtnLabel();
        });
        this._updateBulkBtnLabel();
    }

    _updateBulkBtnLabel() {
        const btn = document.getElementById('bulk-pdf-btn');
        if (!btn) return;
        const checked = document.querySelectorAll('.issue-check:checked').length;
        btn.textContent = checked > 0 ? `📄 선택 내보내기(${checked})` : '📄 전체 내보내기';
    }

    openPdfExportModal(issueId) {
        const modal = document.getElementById('pdf-export-modal');
        if (!modal) return;

        // [Fix] 개별 클릭 시 해당 이슈만, 미지정(전체 버튼) 시 다중 선택 로직 반영
        if (issueId) {
            const issue = this.issues.find(i => i.id === issueId);
            this.exportPayload = issue ? [issue] : [];
        } else {
            var rawIssues = this.issues || [];
            var exportTargetIssues = rawIssues;
            var currentPid = window.activeExplorerProjectId || window.currentProjectId || (new URLSearchParams(window.location.search)).get('projectId');

            const dashboardPremium = document.getElementById('dashboard-premium-container');
            const dashboardLegacy = document.getElementById('project-selection-dashboard');
            const isDashboardActive = (dashboardPremium && dashboardPremium.style.display !== 'none' && dashboardPremium.style.display !== '') || 
                                      (dashboardLegacy && dashboardLegacy.style.display !== 'none' && dashboardLegacy.style.display !== '');
            
            if (isDashboardActive) {
                currentPid = null;
            }

            if (currentPid) {
                exportTargetIssues = rawIssues.filter(function(issue) {
                    var issuePid = issue.projectId || issue.project_id || issue.folderId;
                    if (!issuePid) return false;
                    return String(issuePid) === String(currentPid);
                });
            }

            const checkedNodes = [...document.querySelectorAll('.issue-check:checked')];
            if (checkedNodes.length > 0) {
                const ids = checkedNodes.map(n => parseInt(n.dataset.id));
                this.exportPayload = exportTargetIssues.filter(i => ids.includes(i.id));
            } else {
                this.exportPayload = [...exportTargetIssues];
            }
        }

        if (this.exportPayload.length === 0) {
            alert('내보낼 이슈가 없습니다.');
            return;
        }

        this.setupPdfModalListeners();
        this._populatePdfItemList();
        modal.style.display = 'flex';
    }

    _populatePdfItemList() {
        const listEl = document.getElementById('pdf-item-list');
        if (!listEl) return;
        listEl.innerHTML = this.exportPayload.map(i => `
            <label class="pdf-item-label" style="display:flex;align-items:center;gap:8px;padding:5px;cursor:pointer;">
                <input type="checkbox" class="pdf-issue-check" data-id="${i.id}" checked>
                <span class="v-num">#${i.id.toString().slice(-4)}</span>
                <span style="flex:1;overflow:hidden;text-overflow:ellipsis;">${i.title}</span>
            </label>
        `).join('');
    }

    setupPdfModalListeners() {
        const modal = document.getElementById('pdf-export-modal');
        if (!modal || modal.dataset.listenersBound) return;
        modal.dataset.listenersBound = '1';
        document.getElementById('close-pdf-modal').onclick = () => modal.style.display = 'none';
        document.getElementById('cancel-pdf-btn').onclick = () => modal.style.display = 'none';

        document.getElementById('run-pdf-export-btn').onclick = async () => {
            const checkedIds = [...document.querySelectorAll('.pdf-issue-check:checked')].map(el => parseInt(el.dataset.id));
            let selectedIssues = this.issues.filter(i => checkedIds.includes(i.id)).map(i => ({...i}));
            if (selectedIssues.length === 0) return alert('항목을 선택해주세요.');

            const convertUrlToBase64 = async (url) => {
                if (!url || url.startsWith('data:image')) return url;
                try {
                    const res = await fetch(url);
                    const blob = await res.blob();
                    return new Promise(resolve => {
                        const reader = new FileReader();
                        reader.onloadend = () => resolve(reader.result);
                        reader.onerror = () => resolve(url);
                        reader.readAsDataURL(blob);
                    });
                } catch (e) {
                    console.error('[PDF-DEBUG] Base64 변환 실패:', e);
                    return url;
                }
            };

            // [WYSIWYG 강제 추출 로직: 백엔드 엔진 전송 직전 DOM 기반 직접 추출 및 Base64 변환]
            for (let i = 0; i < selectedIssues.length; i++) {
                let issue = selectedIssues[i];
                let domDesc = null;
                let domResDesc = null;
                let domThumb = null;
                let domAfterThumb = null;

                // 1. 현재 열려있는 이슈 팝업창(모달)에서 추출 (가장 최우선 DOM 타겟팅)
                const modal = document.getElementById('issue-modal');
                if (modal && modal.style.display !== 'none' && modal.dataset.editId == issue.id) {
                    const descEl = document.getElementById('issue-desc');
                    if (descEl) domDesc = descEl.value || descEl.innerText;

                    const resDescEl = document.getElementById('issue-resolution-desc');
                    if (resDescEl) domResDesc = resDescEl.value || resDescEl.innerText;

                    const thumbEl = document.getElementById('issue-preview-img');
                    if (thumbEl && thumbEl.src && !thumbEl.src.endsWith(window.location.host + '/')) domThumb = thumbEl.src;

                    const afterThumbEl = document.getElementById('issue-after-preview-img');
                    if (afterThumbEl && afterThumbEl.src && !afterThumbEl.src.endsWith(window.location.host + '/')) domAfterThumb = afterThumbEl.src;
                } 
                // 2. 모달이 없다면 리스트 DOM 요소 직접 타겟팅
                else {
                    const itemEl = document.querySelector(`.issue-item[data-id="${issue.id}"]`);
                    if (itemEl) {
                        const itemDesc = itemEl.querySelector('.issue-item-desc');
                        if (itemDesc) domDesc = itemDesc.innerText;
                        
                        const itemThumb = itemEl.querySelector('.issue-thumbnail');
                        if (itemThumb && itemThumb.src && !itemThumb.src.endsWith(window.location.host + '/')) domThumb = itemThumb.src;
                    }
                }

                // 3. 변수 스코프 문제 방지를 위한 하드코딩 대체 로직
                const finalDescription = domDesc || issue.description || '수정사항 내용 없음';
                const finalResolution = domResDesc || issue.resolutionDesc || '수정사항 내용 없음';
                
                let pdfImageSrc = domThumb || issue.thumbnail || '';
                if (pdfImageSrc && !pdfImageSrc.startsWith('data:image')) {
                    pdfImageSrc = await convertUrlToBase64(pdfImageSrc);
                }

                let pdfAfterImageSrc = domAfterThumb || issue.afterThumbnail || '';
                if (pdfAfterImageSrc && !pdfAfterImageSrc.startsWith('data:image')) {
                    pdfAfterImageSrc = await convertUrlToBase64(pdfAfterImageSrc);
                }

                // 4. 엔진 전송 직전 [PDF-DEBUG] 로그 강제 삽입
                console.log('[PDF-DEBUG] 최종 주입 데이터:', { 
                    issueId: issue.id,
                    finalDescription, 
                    finalResolution,
                    pdfImageSrc: pdfImageSrc ? pdfImageSrc.substring(0, 50) + '...' : null,
                    pdfAfterImageSrc: pdfAfterImageSrc ? pdfAfterImageSrc.substring(0, 50) + '...' : null
                });

                selectedIssues[i] = {
                    ...issue,
                    description: finalDescription,
                    resolutionDesc: finalResolution,
                    thumbnail: pdfImageSrc,
                    afterThumbnail: pdfAfterImageSrc
                };
            }

            const sf = {
                no: document.getElementById('pdf-field-no')?.checked,
                structure: document.getElementById('pdf-field-structure')?.checked,
                work_type: document.getElementById('pdf-field-worktype')?.checked,
                description: document.getElementById('pdf-field-description')?.checked,
                resolution: document.getElementById('pdf-field-resolution')?.checked,
                screenshot: document.getElementById('pdf-field-images')?.checked
            };
            await this.exportToPdf(selectedIssues, sf);
            modal.style.display = 'none';
        };
    }

    async focusIssue(issue) {
        if (!issue) return;
        const state = typeof issue.viewstate === 'string' ? JSON.parse(issue.viewstate) : issue.viewstate;
        this.viewer.restoreState(state);
    }

    async deleteIssue(id) {
        if (!confirm('정말 삭제하시겠습니까?')) return;
        this.issues = this.issues.filter(i => i.id !== id);
        await this.saveIssues();
        this.restorePins();

        try {
            await fetch(`/api/issues/${id}`, { method: 'DELETE' });
        } catch (err) {
            console.error('[IssueManager] Server delete failed:', err);
        }
    }

    showEditModal(id) {
        const issue = this.issues.find(i => i.id === id);
        if (!issue) return;
        const modal = document.getElementById('issue-modal');
        modal.dataset.mode = 'edit';
        modal.dataset.editId = id;
        document.getElementById('issue-title').value = issue.title;
        document.getElementById('issue-desc').value = issue.description;
        
        // 동적 Assignee 드롭다운 바인딩 및 선택 처리
        this.populateAssigneeDropdown(issue.assignee);
        
        document.getElementById('issue-status').value = issue.status;
        
        // [Fix] 구조물 및 공종 데이터 바인딩 누락 수정 (Load 시 복구)
        const structureInput = document.getElementById('issue-structure');
        if (structureInput) structureInput.value = issue.structureName || '-';
        const workTypeInput = document.getElementById('issue-work-type');
        if (workTypeInput) workTypeInput.value = issue.workType || '-';

        // [Fix] Edit 모달 오픈 시 preview-img 바인딩 누락 버그 해결
        const previewImg = document.getElementById('issue-preview-img');
        const previewWrap = document.getElementById('modal-image-preview');
        if (previewImg && previewWrap) {
            if (issue.thumbnail) {
                previewImg.src = issue.thumbnail;
                previewWrap.style.display = 'flex';
            } else {
                previewImg.src = '';
                previewWrap.style.display = 'none';
            }
        }

        // [Fix] 추가적으로 해결(Closed) 상태일 때 AfterThumbnail과 ResolutionDesc도 바인딩
        const resDescInput = document.getElementById('issue-resolution-desc');
        const resSection = document.getElementById('issue-resolution-section');
        const afterPreviewImg = document.getElementById('issue-after-preview-img');
        const afterPreviewWrap = document.getElementById('modal-after-image-preview');

        if (resDescInput) resDescInput.value = issue.resolutionDesc || '';
        
        if (issue.status === 'Closed') {
            if (resSection) resSection.style.display = 'block';
            if (afterPreviewImg && afterPreviewWrap) {
                if (issue.afterThumbnail) {
                    afterPreviewImg.src = issue.afterThumbnail;
                    afterPreviewWrap.style.display = 'flex';
                } else {
                    afterPreviewImg.src = '';
                    afterPreviewWrap.style.display = 'none';
                }
            }
        } else {
            if (resSection) resSection.style.display = 'none';
            if (afterPreviewImg && afterPreviewWrap) {
                afterPreviewImg.src = '';
                afterPreviewWrap.style.display = 'none';
            }
        }

        modal.style.display = 'flex';

        // [Safety UI Injection] 작성 시간 독립 주입 (Non-blocking)
        setTimeout(() => safelyInjectIssueTime(issue), 100);
    }

    async exportToPdf(issues, sf) {
        // 9. PDF creation configuration options reinforcement
        const pdfOptions = {
            useCORS: true,
            allowTaint: true,
            logging: true,
            scale: 2,
            imageTimeout: 0,
            onclone: function(clonedDoc) {
                const imgs = clonedDoc.getElementsByTagName('img');
                for(let i=0; i<imgs.length; i++) {
                    imgs[i].style.setProperty('display', 'block', 'important');
                    imgs[i].style.setProperty('visibility', 'visible', 'important');
                }
            }
        };
        console.log("pdfOptions initialized for general report:", pdfOptions);

        const toBase64 = window.imageToBase64 || (url => Promise.resolve(url));
        
        // Convert thumbnails and afterThumbnails to Base64 to ensure they render correctly in server-side Puppeteer PDF
        const processedIssues = await Promise.all(issues.map(async (issue) => {
            const updated = { ...issue };
            if (updated.thumbnail) {
                updated.thumbnail = await toBase64(updated.thumbnail);
            }
            if (updated.afterThumbnail) {
                updated.afterThumbnail = await toBase64(updated.afterThumbnail);
            }
            return updated;
        }));

        const payload = { title: 'Report', issues: processedIssues, sf };
        const resp = await fetch('/api/issues/export-pdf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (resp.ok) {
            const blob = await resp.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = `report_${Date.now()}.pdf`; a.click();
        }
    }

    setupBulkExportButton() {
        const btn = document.getElementById('bulk-pdf-btn');
        if (!btn || btn.dataset.bound) return;
        btn.dataset.bound = '1';

        btn.onclick = () => {
            this.openPdfExportModal();
        };
    }
}

// 날짜 포맷팅을 위한 헬퍼 함수
function formatIssueDate(dateObj) {
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    const hours = String(dateObj.getHours()).padStart(2, '0');
    const minutes = String(dateObj.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
}

/**
 * [Non-Destructive] 이슈 작성/수정 시 UI에 상황별(Context-Aware) 작성 시간을 안전하게 주입
 */
function safelyInjectIssueTime(existingIssueData = null) {
    try {
        let timeString = "";

        // 🌟 분기 1: 기존 이슈 데이터가 있고, 생성 시간(createdAt) 필드가 존재할 때 (과거 시간 고정)
        if (existingIssueData && existingIssueData.createdAt) {
            const originalDate = new Date(existingIssueData.createdAt);
            timeString = `작성 시간: ${formatIssueDate(originalDate)}`;
        } 
        // 🌟 분기 2: 완전 새 이슈를 작성하는 팝업일 때 (현재 팝업 여는 순간의 시간)
        else {
            timeString = `작성 시간: ${formatIssueDate(new Date())}`;
        }

        // DOM 요소 렌더링 및 갱신
        const existingTimeEl = document.getElementById('safe-issue-time');
        if (existingTimeEl) {
            existingTimeEl.innerText = timeString;
        } else {
            const modal = document.getElementById('issue-modal');
            if (!modal) return;
            const actionButtons = modal.querySelector('.modal-footer, .issue-modal-actions, .button-group'); 
            if (!actionButtons) return;

            const timeHtml = `<div id="safe-issue-time" style="text-align: right; font-size: 12px; color: #888; padding: 5px 15px 10px 0;">${timeString}</div>`;
            actionButtons.insertAdjacentHTML('beforebegin', timeHtml);
        }
    } catch (error) {
        console.warn("[UI 주입 무시됨] 코어 기능은 정상 작동합니다.", error);
    }
}

// 🚨 [Direct General Project Issue PDF Export Helper]
window.exportProjectIssuesPdf = async function(issuesToExport) {
    if (window._issueManager) {
        var sf = { no: true, structure: true, work_type: true, description: true, resolution: true, screenshot: true };
        var targetList = Array.isArray(issuesToExport) ? issuesToExport : null;
        if (!targetList) {
            targetList = [...window._issueManager.issues];
        }
        if (targetList.length === 0) {
            alert("내보낼 이슈 데이터가 없습니다.");
            return;
        }
        await window._issueManager.exportToPdf(targetList, sf);
    } else {
        console.error("일반 프로젝트 이슈 매니저를 찾을 수 없습니다.");
    }
};
