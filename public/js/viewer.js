/* ============================================================
   viewer.js — APS Viewer (ES6 Module)
   ============================================================ */

async function getAccessToken(callback) {
    try {
        const resp = await fetch('/api/auth/token');
        if (!resp.ok) throw new Error(await resp.text());
        const { access_token, expires_in } = await resp.json();
        callback(access_token, expires_in);
    } catch (err) {
        console.error('Could not obtain access token:', err);
    }
}

let _initializerPromise = null;

function ensureInitialized() {
    if (!_initializerPromise) {
        _initializerPromise = new Promise((resolve) => {
            Autodesk.Viewing.Initializer({ env: 'AutodeskProduction', getAccessToken }, () => {
                resolve();
            });
        });
    }
    return _initializerPromise;
}

export async function initViewer(container) {
    await ensureInitialized();
    const config = {
        extensions: [
            'Autodesk.DocumentBrowser',
            'NavisClashExtension',
            'Autodesk.Viewing.MarkupsCore'
        ],
        preserveDrawingBuffer: true
    };
    const viewer = new Autodesk.Viewing.GuiViewer3D(container, config);
    viewer.start();
    viewer.setTheme('dark-theme');
    return viewer;
}

/**
 * 1. URN 인코딩 전용 유틸리티 함수
 */
export function getSafeUrn(rawUrn) {
    if (!rawUrn) return null;

    let cleanUrn = rawUrn.trim();
    if (cleanUrn.startsWith('urn:')) {
        cleanUrn = cleanUrn.substring(4);
    }

    // 1. 이미 인코딩된 형식이면 (-)와 (_)로 안전한 Base64 형식을 유지함
    if (cleanUrn.startsWith('dXJu') || cleanUrn.startsWith('ZFhKd')) {
        return 'urn:' + cleanUrn.replace(/=/g, '');
    }

    // 2. 인코딩되지 않은 경우, URL-safe Base64로 인코딩 수행
    const rawToEncode = cleanUrn.startsWith('urn:') ? cleanUrn : ('urn:' + cleanUrn);
    const encoded = btoa(rawToEncode)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
    return 'urn:' + encoded;
}

/**
 * Loads a model into the viewer.
 */
export function loadModel(viewer, rawId, fileDisplayName = null) {
    return new Promise((resolve, reject) => {
        if (!rawId) {
            console.error(`[Viewer Error] loadModel 호출 에러: URN이 없습니다.`);
            return reject(new Error(`유효한 URN 파라미터가 없습니다.`));
        }

        const finalUrn = getSafeUrn(rawId);
        console.log("[CRITICAL CHECK] Final URN to Load:", finalUrn);

        Autodesk.Viewing.Document.load(finalUrn, (doc) => {
            const root = doc.getRoot();
            const viewables = root.getDefaultGeometry();
            if (!viewables) {
                return reject(new Error('Document contains no viewable geometry.'));
            }

            // ── 모델 표시 이름 결정 (우선순위 체인) ──────────────────────
            try {
                let modelName = null;

                // [Priority 1] 트리/호출자에서 전달된 파일명 (최우선 - 항상 정확)
                if (fileDisplayName && fileDisplayName.trim() && fileDisplayName !== 'Model') {
                    modelName = fileDisplayName.trim();
                    console.log(`[Viewer] ✅ 이름 소스: fileDisplayName → "${modelName}"`);
                }

                // [Priority 2] 뷰어블 노드의 fileName 또는 name (모델 파일 실제명)
                if (!modelName) {
                    const vData = viewables.data || {};
                    const candidate = vData.fileName || vData.name || '';
                    // 내부 뷰 이름 필터링 (Master View, {3D}, Default 3D View 등)
                    const isInternalName = /^(master view|default 3d view|\{3d\}|3d view|home view)$/i.test(candidate.trim());
                    if (candidate && !isInternalName) {
                        modelName = candidate;
                        console.log(`[Viewer] ✅ 이름 소스: viewables.data → "${modelName}"`);
                    }
                }

                // [Priority 3] root.name() — Revit 파일에서는 실제 파일명 반환
                if (!modelName) {
                    let rootName = null;
                    if (typeof root.name === 'function') rootName = root.name();
                    else if (root.data?.name) rootName = root.data.name;
                    else if (typeof root.getName === 'function') rootName = root.getName();

                    const isInternalName = /^(master view|default 3d view|\{3d\}|3d view|home view)$/i.test((rootName || '').trim());
                    if (rootName && !isInternalName) {
                        modelName = rootName;
                        console.log(`[Viewer] ✅ 이름 소스: root.name() → "${modelName}"`);
                    }
                }

                // [Priority 4] 폴백
                if (!modelName) {
                    modelName = 'BIM Model';
                    console.warn(`[Viewer] ⚠️ 이름 소스 없음. 폴백 사용: "${modelName}"`);
                }

                // 파일명에서 버전 정보 추출
                let versionSuffix = '';
                const vMatch = modelName.match(/_V(\d+)/i) || modelName.match(/ver\.?\s?(\d+)/i);
                if (vMatch) {
                    versionSuffix = ` (Ver. ${vMatch[1]})`;
                }

                const fullDisplayName = modelName + versionSuffix;
                console.log(`[Viewer] 최종 표시 이름: "${fullDisplayName}"`);

                const onTreeCreated = () => {
                    viewer.removeEventListener(Autodesk.Viewing.OBJECT_TREE_CREATED_EVENT, onTreeCreated);

                    // [Timing Fix] 트리가 준비된 시점에 UI 및 AI 컨텍스트 동기화 수행
                    if (window.syncUIState) {
                        window.syncUIState(fullDisplayName, { urn: finalUrn });
                    } else {
                        const topBarTitle = document.getElementById('viewer-model-name');
                        if (topBarTitle) topBarTitle.textContent = fullDisplayName;
                        const infoBarLabel = document.getElementById('model-name-label');
                        if (infoBarLabel) infoBarLabel.textContent = fullDisplayName;
                    }

                    resolve(doc);
                };
                viewer.addEventListener(Autodesk.Viewing.OBJECT_TREE_CREATED_EVENT, onTreeCreated);
            } catch (titleErr) {
                console.warn('[Viewer] 제목 업데이트 중 오류 발생 (무시하고 로드 진행):', titleErr);
                const onTreeCreatedFallback = () => {
                    viewer.removeEventListener(Autodesk.Viewing.OBJECT_TREE_CREATED_EVENT, onTreeCreatedFallback);
                    resolve(doc);
                };
                viewer.addEventListener(Autodesk.Viewing.OBJECT_TREE_CREATED_EVENT, onTreeCreatedFallback);
            }

            viewer.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, () => {
                console.log('[Viewer] GEOMETRY_LOADED - Harness-Context 가동');
                try {
                    if (window.ContextHarness) {
                        window.ContextHarness.extract(viewer);
                    }
                    // [Fix] 이름 재설정 제거 — Document.load 콜백에서 이미 확정됨
                    // (GEOMETRY_LOADED의 name 덮어쓰기가 경쟁 조건 유발)
                } catch (loadErr) {
                    console.error('[Viewer] Context extraction failed:', loadErr);
                }
            }, { once: true });

            viewer.loadDocumentNode(doc, viewables);
        }, async (code, msg) => {
            console.error('Load Failed:', code, msg);
            reject(new Error(`Load Error ${code}: ${msg}`));
        });
    });
}

export async function loadModelWithTracking(viewer, rawId, modelName = 'Model') {
    try {
        // [Fix] modelName을 loadModel까지 전달하여 파일명이 최우선으로 사용되도록 보장
        await loadModel(viewer, rawId, modelName);
    } catch (err) {
        console.error(`[Viewer] Failed to load ${modelName}:`, err);
        throw err;
    }
}

/**
 * 🌟 [Helper] BIM 모델 명명 규칙에 따른 표시 이름 생성
 * @param {string} fName - 파일명 또는 모델명
 * @param {number|string} vNum - 버전 번호
 * @returns {string} 포맷팅된 이름 (구조물_공종_v버전)
 */
window.formatBimModelName = function(fName, vNum) {
    if (!fName) return vNum ? `v${vNum}` : '';
    
    // 확장자 제거 및 순수 파일명 추출
    let base = fName.split('/').pop().split('\\').pop().split('.')[0];
    let vStr = vNum ? (String(vNum).toLowerCase().startsWith('v') ? String(vNum).toLowerCase() : `v${vNum}`) : '';

    if (base.includes('_')) {
        let parts = base.split('_');
        let structName = '';
        let discipline = '';

        // [패턴 1] 강북_구조물_신설_04_급속여과지_M (6개 이상의 파트)
        if (parts.length >= 6) {
            structName = parts[4] || ''; // '급속여과지'
            discipline = parts[5] || ''; // 'M'
        } 
        // [패턴 2] 응집침전지_건축설비_v2 (3개 내외의 파트)
        else {
            structName = parts[0] || '';
            discipline = parts[1] || '';
        }

        // 공종 코드 매핑 (기존 M, AM 등을 한글로 변환)
        const mapping = {
            'C': '토목', 'A': '건축', 'AM': '건축설비', 'E': '전기', 'M': '기계',
            'S': '구조', 'F': '소방'
        };
        let disciplineLabel = mapping[discipline.toUpperCase()] || discipline || '';

        // 정적 텍스트 '구조물'이 구조물명 자리에 왔을 경우의 예외 처리
        if (structName === '구조물' && parts.length > 4) {
            structName = parts[4];
        }

        // 최종 조립 (Fallback 적용하여 undefined 방지)
        return [structName, disciplineLabel, vStr]
            .map(s => (s || '').trim())
            .filter(s => s !== '')
            .join('_');
    }
    
    return vStr ? `${base}_${vStr}` : base;
};

window.compareModels = async (urn1, urn2, nameA, nameB) => {
    const modal = document.getElementById('version-modal');
    if (modal) modal.style.display = 'none';

    // 🌟 [UI] 비교 상단바의 모델 이름 영역 초기화 (Loading 표시)
    const slotA = document.getElementById('slot-a-name');
    const slotB = document.getElementById('slot-b-name');
    if (slotA) {
        slotA.textContent = 'Loading...';
        slotA.style.color = 'var(--text-muted)';
    }
    if (slotB) {
        slotB.textContent = 'Loading...';
        slotB.style.color = 'var(--text-muted)';
    }

    const finalUrn1 = getSafeUrn(urn1);
    const finalUrn2 = getSafeUrn(urn2);

    const mainViewer = window._viewer;
    const comparisonContainer = document.getElementById('comparison-container');
    const previewElem = document.getElementById('preview');

    if (mainViewer) mainViewer.tearDown();
    if (previewElem) previewElem.style.display = 'none';
    if (comparisonContainer) comparisonContainer.style.display = 'flex';

    window.dispatchEvent(new Event('resize'));

    const containerL = document.getElementById('viewer-left');
    const containerR = document.getElementById('viewer-right');
    containerL.innerHTML = '';
    containerR.innerHTML = '';

    await ensureInitialized();

    window.viewerLeft = new Autodesk.Viewing.GuiViewer3D(containerL, { preserveDrawingBuffer: true });
    window.viewerRight = new Autodesk.Viewing.GuiViewer3D(containerR, { preserveDrawingBuffer: true });

    window.viewerLeft.start();
    window.viewerRight.start();
    window.viewerLeft.setTheme('dark-theme');
    window.viewerRight.setTheme('dark-theme');

    window.viewerLeft.prefs.set('disableHomeViewAnimation', true);
    window.viewerRight.prefs.set('disableHomeViewAnimation', true);

    const loadDoc = (v, urn, isRight = false) => new Promise((resolve, reject) => {
        Autodesk.Viewing.Document.load(urn, (doc) => {
            const viewables = doc.getRoot().getDefaultGeometry();
            if (isRight) {
                window._cachedDocB = doc;
                window._cachedViewablesB = viewables;
            }
            v.loadDocumentNode(doc, viewables).then(resolve).catch(reject);
        }, reject);
    });

    try {
        window._currentViewMode = 'side';
        if (window._overlayModel) window._overlayModel = null;
        
        await Promise.all([
            loadDoc(window.viewerLeft, finalUrn1),
            loadDoc(window.viewerRight, finalUrn2, true)
        ]);

        // 🌟 [UI] 로드 완료 후 실제 모델 정보로 이름 업데이트
        if (slotA) {
            slotA.textContent = nameA || 'Version A';
            slotA.style.color = '#fff';
        }
        if (slotB) {
            slotB.textContent = nameB || 'Version B';
            slotB.style.color = '#fff';
        }

        const { setCompareViewers, runDiff, visualizeDiff, initCameraSync, cleanupCameraSync } = await import('./diff-viewer.js');
        setCompareViewers(window.viewerLeft, window.viewerRight);

        const diffResults = await runDiff(null, urn1, urn2);
        visualizeDiff(diffResults);

        const columnsPanel = document.getElementById('diff-results-three-columns');
        if (columnsPanel) columnsPanel.style.display = 'flex';

        initCameraSync(window.viewerLeft, window.viewerRight);

        window.viewerLeft.fitToView();
        window.viewerRight.fitToView();

        const btnExit = document.getElementById('exit-compare-btn');
        if (btnExit) {
            btnExit.onclick = () => {
                if (window.viewerLeft && window.viewerRight) cleanupCameraSync(window.viewerLeft, window.viewerRight);
                if (window.viewerLeft) { window.viewerLeft.finish(); window.viewerLeft = null; }
                if (window.viewerRight) { window.viewerRight.finish(); window.viewerRight = null; }
                if (comparisonContainer) comparisonContainer.style.display = 'none';
                if (previewElem) previewElem.style.display = 'block';
                if (window._viewer) {
                    window._viewer.start();
                    loadModel(window._viewer, finalUrn1);
                }
                if (window.exitCompareMode) window.exitCompareMode();
                window.dispatchEvent(new Event('resize'));
            };
        }

        // 🌟 [Event Binding] 비교 모드 UI 버튼들 이벤트 리스너 강제 연결
        if (window.initCompareModeButtons) window.initCompareModeButtons();

    } catch (err) {
        console.error('🚨 [compareModels Error] 모델 비교 로드 중 오류:', err);
        alert('모델 비교 로드 중 오류가 발생했습니다.');
    }
};

window._currentViewMode = 'side';
window._overlayModel = null;

window.toggleViewMode = async (mode) => {
    try {
        console.log("🚨 [View Toggle] 토글 함수 실행됨, 타겟 모드:", mode);
        
        if (window._currentViewMode === mode) return;

        const btnSide = document.getElementById('btn-view-side');
        const btnOverlay = document.getElementById('btn-view-overlay');
        const ctrlPanel = document.getElementById('overlay-controls-panel');
        const containerL = document.getElementById('viewer-left');
        const containerR = document.getElementById('viewer-right');

        if (!window.viewerLeft || !window.viewerRight) {
            console.warn("⚠️ [View Toggle] 뷰어 인스턴스가 로드되지 않았거나 유효하지 않습니다.");
            return;
        }

        if (mode === 'overlay') {
            // 병렬 -> 중첩 전환
            window._currentViewMode = 'overlay';
            if (btnSide) btnSide.classList.remove('active');
            if (btnOverlay) btnOverlay.classList.add('active');

            // [UI] 중첩 뷰 전용 요소 표시
            if (ctrlPanel) {
                ctrlPanel.style.display = 'block';
            }

// [NEW] 듀얼 캡처용 비동기 스크린샷 헬퍼
window.getScreenshotAsync = function(viewer) {
    return new Promise((resolve) => {
        const width = viewer.container.clientWidth;
        const height = viewer.container.clientHeight;
        viewer.getScreenShot(width, height, (blobData) => {
            resolve(blobData);
        });
    });
};

// [NEW] 듀얼 캡처 시퀀스
window.captureBothVersions = async function(viewer, modelA, modelB) {
    const nav = viewer.navigation;
    const camera = nav.getCamera(); // 내부 Three.js 카메라 가져오기
    
    // 1. 현재 완벽하게 맞춰진 카메라의 물리적 좌표 파라미터 복사
    const pos = nav.getPosition().clone();
    const target = nav.getTarget().clone();
    const up = camera.up.clone(); // THREE.Vector3 직접 참조
    const isOrtho = !camera.isPerspective; // 투시(perspective) 레즈 여부로 직교 판별
    const fov = nav.getVerticalFov();

    // [함수 정의] 카메라를 물리적으로 강제 고정하는 헬퍼 함수
    const forceLockCamera = () => {
        nav.setView(pos, target); // 위치와 타겟 강제 설정
        camera.up.copy(up);       // 업벡터 강제 복사
        
        if (!isOrtho) {
            nav.setVerticalFov(fov, true); // 투시 뷰 FOV 고정
        }
        viewer.impl.invalidate(true, true, true); // 즉시 렌더링 강제
    };

    // --------------------------------------------------
    // 2. Model A 캡처
    viewer.hideModel(modelB.id);
    viewer.showModel(modelA.id);
    
    forceLockCamera(); // 카메라 고정
    
    await new Promise(r => setTimeout(r, 200)); 
    const imgA = await window.getScreenshotAsync(viewer);

    // --------------------------------------------------
    // 3. Model B 캡처
    viewer.hideModel(modelA.id);
    viewer.showModel(modelB.id);
    
    forceLockCamera(); // 카메라 고정
    
    await new Promise(r => setTimeout(r, 200));
    const imgB = await window.getScreenshotAsync(viewer);

    // --------------------------------------------------
    // 4. 상태 복구 (둘 다 표시)
    viewer.showModel(modelA.id);
    viewer.showModel(modelB.id);
    
    forceLockCamera(); // 최종 구도 고정

    return { imgA, imgB };
};

            // 뷰어 툴바에 버전비교 전용 이슈 버튼 추가
            const toolbar = window.viewerLeft.getToolbar(true);
            if (toolbar) {
                if (!window.addComparisonIssueBtn) {
                    window.addComparisonIssueBtn = function(viewer) {
                        const tb = viewer.getToolbar(true);
                        if (!tb) return null;

                        let group = tb.getControl('comparison-issue-group');
                        if (!group) {
                            group = new Autodesk.Viewing.UI.ControlGroup('comparison-issue-group');
                            tb.addControl(group);
                        }

                        let button = group.getControl('comparison-issue-btn');
                        if (!button) {
                            button = new Autodesk.Viewing.UI.Button('comparison-issue-btn');
                            button.icon.classList.add('fas', 'fa-exclamation-triangle');
                            button.icon.style.color = '#deff9a'; // 구분을 위해 색상 변경
                            button.setToolTip('버전비교 이슈 작성');
                            
                            button.onClick = function(e) {
                                console.log("🚨 [Comparison Issue] 전용 마크업 및 위치 선택 모드 진입...");
                                window.isComparisonIssueMode = true; // 전용 모드 플래그 활성화
                                
                                // 기존 마크업 도구를 쓰지 않고 십자선 커서 + 직접 픽킹 이벤트
                                viewer.container.style.cursor = 'crosshair';
                                
                                const onCanvasClick = async (e) => {
                                    // 1회성 바인딩
                                    viewer.container.removeEventListener('click', onCanvasClick);
                                    viewer.container.style.cursor = '';
                                    
                                    const rect = viewer.container.getBoundingClientRect();
                                    const x = e.clientX - rect.left;
                                    const y = e.clientY - rect.top;
                                    
                                    const hit = viewer.impl.hitTest(x, y, true);
                                    if (!hit) {
                                        alert('모델을 정확히 클릭해주세요.');
                                        window.isComparisonIssueMode = false;
                                        return;
                                    }
                                    
                                    const intersectPoint = hit.intersectPoint;
                                    const dbId = hit.dbId;
                                    
                                    const models = viewer.getAllModels();
                                    if (models.length < 2) {
                                        alert('비교할 모델이 2개 로드되지 않았습니다.');
                                        return;
                                    }
                                    const modelA = models[0];
                                    const modelB = models[1];
                                    
                                    // 듀얼 캡처 진행
                                    try {
                                        console.log("📸 [Comparison Issue] 듀얼 캡처 시작...");
                                        const { imgA, imgB } = await window.captureBothVersions(viewer, modelA, modelB);
                                        
                                        // 캡처 데이터 팝업 모달로 전달
                                        const popup = document.getElementById('comparison-issue-popup');
                                        if (popup) {
                                            document.getElementById('comp-issue-img-a').src = imgA;
                                            document.getElementById('comp-issue-img-b').src = imgB;

                                            // 버전 데이터 추출
                                            const versionAName = document.getElementById('slot-a-name')?.textContent || 'Version A';
                                            window.editingIssueId = null;
                                            const saveBtn = document.getElementById('save-comp-issue-btn');
                                            if (saveBtn) {
                                                saveBtn.style.display = 'inline-block';
                                                saveBtn.textContent = 'Save';
                                            }
                                            const versionBName = document.getElementById('slot-b-name')?.textContent || 'Version B';

                                            const headerA = document.getElementById('comp-version-a-header');
                                            const headerB = document.getElementById('comp-version-b-header');
                                            if (headerA) headerA.textContent = `${versionAName} (변경 전)`;
                                            if (headerB) headerB.textContent = `${versionBName} (변경 후)`;

                                            // 담당자 목록 동기화 (기존 일반 이슈 담당자 팝업에서 복사)
                                            const compAssigneeSelect = document.getElementById('comp-issue-assignee');
                                            const originalAssigneeSelect = document.getElementById('issue-assignee');
                                            if (compAssigneeSelect && originalAssigneeSelect) {
                                                if (originalAssigneeSelect.options.length <= 4 && window._issueManager && typeof window._issueManager.populateAssigneeDropdown === 'function') {
                                                    await window._issueManager.populateAssigneeDropdown();
                                                }
                                                compAssigneeSelect.innerHTML = originalAssigneeSelect.innerHTML;
                                            }

                                            // 버전 이름 파싱 및 구조물명 / 작업구분 자동 기입
                                            if (versionAName) {
                                                const tokens = versionAName.split('_');
                                                if (tokens.length >= 2) {
                                                    const structureInput = document.getElementById('comp-issue-structure');
                                                    const workTypeInput = document.getElementById('comp-issue-work-type');
                                                    if (structureInput) structureInput.value = tokens[0];
                                                    if (workTypeInput) workTypeInput.value = tokens[1];
                                                }
                                            }
                                            
                                            // 데이터 속성 바인딩 (저장 시 사용)
                                            popup.dataset.dbId = dbId;
                                            popup.dataset.point = JSON.stringify(intersectPoint);
                                            popup.dataset.imgA = imgA;
                                            popup.dataset.imgB = imgB;
                                            popup.dataset.versionA = versionAName;
                                            popup.dataset.versionB = versionBName;
                                            
                                            popup.style.display = 'flex'; // 팝업 노출
                                        }
                                    } catch (err) {
                                        console.error('듀얼 캡처 실패:', err);
                                        window.isComparisonIssueMode = false;
                                    }
                                };
                                
                                viewer.container.addEventListener('click', onCanvasClick);
                            };
                            group.addControl(button);
                        }
                        return button;
                    };
                }
                const issueBtn = window.addComparisonIssueBtn(window.viewerLeft);
                if (issueBtn) {
                    window._overlayIssueBtn = issueBtn;
                    window._overlayIssueBtn.setVisible(true);
                }
            }

            // 우측 패널 숨기고 좌측 100% 확장
            containerR.style.display = 'none';
            containerL.style.width = '100%';
            window.viewerLeft.resize();

            // 모델 B를 뷰어 A에 추가로 로드
            if (window._cachedDocB && window._cachedViewablesB) {
                const baseModel = window.viewerLeft.getAllModels()[0] || window.viewerLeft.model;
                let loadOptions = { keepCurrentModels: true };

                if (baseModel) {
                    if (typeof baseModel.getGlobalOffset === 'function') {
                        loadOptions.globalOffset = baseModel.getGlobalOffset();
                    } else if (baseModel.getData && baseModel.getData().globalOffset) {
                        loadOptions.globalOffset = baseModel.getData().globalOffset;
                    }
                    if (typeof baseModel.getPlacementTransform === 'function') {
                        const pt = baseModel.getPlacementTransform();
                        if (pt) loadOptions.placementTransform = pt;
                    }
                }

                const onGeomLoaded = (e) => {
                    if (baseModel && e.model !== baseModel) {
                        window.viewerLeft.removeEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, onGeomLoaded);
                        window._overlayModel = e.model;
                        console.log("✅ 중첩 모델 로드 완료:", e.model.id);
                        initOverlayControls();
                    }
                };
                window.viewerLeft.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, onGeomLoaded);
                window.viewerLeft.loadDocumentNode(window._cachedDocB, window._cachedViewablesB, loadOptions);
            }
        } else {
            // 중첩 -> 병렬 전환
            window._currentViewMode = 'side';
            if (btnOverlay) btnOverlay.classList.remove('active');
            if (btnSide) btnSide.classList.add('active');

            if (window._overlayIssueBtn) window._overlayIssueBtn.setVisible(false);
            if (ctrlPanel) ctrlPanel.style.display = 'none';

            if (window._overlayModel) {
                try {
                    window.viewerLeft.unloadModel(window._overlayModel);
                    console.log('[Overlay] Overlay model unloaded.');
                } catch(e) {
                    console.error('[Overlay] Error unloading:', e);
                }
                window._overlayModel = null;
            }

            containerR.style.display = 'block';
            containerL.style.width = '50%';
            containerR.style.width = '50%';
            
            setTimeout(() => {
                if (window.viewerLeft) window.viewerLeft.resize();
                if (window.viewerRight) window.viewerRight.resize();
            }, 50);
        }
    } catch (error) {
        console.error("🚨 [View Toggle Error] 중첩뷰 전환 중 치명적 에러:", error);
    }
};

/**
 * [Event Binding] DOM 로드 완료 후 버튼에 이벤트 리스너 명시적 연결
 */
document.addEventListener('DOMContentLoaded', () => {
    const bindToggle = (id, mode) => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log(`🚨 [Click Captured] ${mode} 버튼 클릭이 정상적으로 감지되었습니다!`);
                window.toggleViewMode(mode);
            });
            console.log(`✅ [Event Binding] ${mode} 버튼 이벤트 리스너 연결 완료`);
        } else {
            // 뷰어 비교 모드가 아닐 때도 존재할 수 있으므로 에러가 아닌 로그로 남김
            console.log(`ℹ️ [Event Binding] ${id} 버튼을 현재 페이지에서 찾을 수 없습니다 (비교 모드 진입 전일 수 있음)`);
        }
    };

    const overlayPanel = document.getElementById('overlay-controls-panel');
    if (overlayPanel) {
        overlayPanel.style.position = 'absolute';
        overlayPanel.style.zIndex = '9999';
        overlayPanel.style.cursor = 'move';

        let isDraggingPanel = false;
        let lastX = 0;
        let lastY = 0;

        overlayPanel.addEventListener('mousedown', function(e) {
            // 슬라이더, 버튼 등 제어 요소 클릭 시 드래그 방지 (내부 아이콘 클릭도 포함)
            if (['INPUT', 'BUTTON', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) || e.target.closest('input, button, select, textarea')) {
                return;
            }

            isDraggingPanel = true;
            lastX = e.clientX;
            lastY = e.clientY;
            
            // 🚨 핵심: 드래그 시작 시 현재 위치를 px 단위로 고정하여 right/bottom 충돌 방지
            overlayPanel.style.left = overlayPanel.offsetLeft + 'px';
            overlayPanel.style.top = overlayPanel.offsetTop + 'px';
            overlayPanel.style.right = 'auto';
            overlayPanel.style.bottom = 'auto';
            overlayPanel.style.margin = '0'; // 마진 간섭 차단
            
            overlayPanel.style.cursor = 'grabbing';
        });

        document.addEventListener('mousemove', function(e) {
            if (!isDraggingPanel) return;
            
            e.preventDefault();
            
            // 마우스가 이전 프레임 대비 이동한 거리(Delta)만 계산
            const dx = e.clientX - lastX;
            const dy = e.clientY - lastY;
            
            // 현재 위치 갱신
            lastX = e.clientX;
            lastY = e.clientY;
            
            // 패널의 기존 위치에 이동한 거리만큼만 더함 (부모 좌표계 완벽 무시)
            overlayPanel.style.left = (overlayPanel.offsetLeft + dx) + 'px';
            overlayPanel.style.top = (overlayPanel.offsetTop + dy) + 'px';
        });

        document.addEventListener('mouseup', function() {
            if (isDraggingPanel) {
                isDraggingPanel = false;
                overlayPanel.style.cursor = 'move';
            }
        });
    }

    // 초기 바인딩 시도
    bindToggle('btn-view-side', 'side');
    bindToggle('btn-view-overlay', 'overlay');
    
    // 만약 동적으로 버튼이 다시 생성되는 경우를 대비해 전역 함수 노출 보장
    window.initCompareModeButtons = () => {
        bindToggle('btn-view-side', 'side');
        bindToggle('btn-view-overlay', 'overlay');
    };
});

/**
 * [NEW] Overlay Controls Panel Logic
 */
function initOverlayControls() {
    const v = window.viewerLeft;
    if (!v) return;

    const models = v.getAllModels();
    
    // [Fix] Version A는 1번 모델, Version B는 3번 모델로 명시적 맵핑 {a: 1, b: 3}
    const modelA = models.find(m => m.id === 1) || models[0];
    const modelB = models.find(m => m.id === 3) || window._overlayModel || models[1];

    console.log('[OverlayControls] 오버레이 모드 활성화 맵핑 검증:', { 
        Version_A_id: modelA?.id, 
        Version_B_id: modelB?.id,
        AvailableModels: models.map(m => m.id)
    });

    const setupControl = (model, btnId, sliderId) => {
        const btn = document.getElementById(btnId);
        const slider = document.getElementById(sliderId);
        if (!model || !btn || !slider) return;

        // Visibility Toggle (모델 ID 기반 호출 및 강제 리렌더링)
        btn.onclick = () => {
            const isVisible = v.isModelVisible(model);
            if (isVisible) {
                v.hideModel(model);
            } else {
                v.showModel(model);
            }
            btn.classList.toggle('hidden', isVisible);
            btn.querySelector('i').className = isVisible ? 'fas fa-eye-slash' : 'fas fa-eye';
            
            // [Fix] 즉시 리렌더링 강제
            v.impl.invalidate(true, true, true);
        };

        // Opacity Slider (채도 저하 없는 알파 제어)
        slider.oninput = (e) => {
            const alpha = parseFloat(e.target.value);
            
            // [Fix] 모델 단위 투명도 조절 (지원되는 경우 setAlpha 사용)
            if (typeof model.setAlpha === 'function') {
                model.setAlpha(alpha);
            } else {
                // Fallback: 인스턴스 트리를 통한 테마 색상 적용 (최소한의 간섭을 위해 검정색 알파 0 전략)
                // 대신 투명도만 건드리기 위해 shader 속성 조정이 이상적이나, 여기선 LMV의 표준 투명도 처리 유도
                const tree = model.getInstanceTree();
                if (tree) {
                    const rootId = tree.getRootId();
                    // Vector4(1,1,1,alpha)는 흰색 필터를 씌우므로, Vector4(0,0,0,alpha)가 덜 튈 수 있음
                    // 하지만 가장 확실한 건 impl 수준의 제어임.
                    v.setThemingColor(rootId, new THREE.Vector4(0, 0, 0, alpha), model, true);
                }
            }
            v.impl.invalidate(true, true, true);
        };
    };

    setupControl(modelA, 'btn-toggle-vis-a', 'slider-opacity-a');
    setupControl(modelB, 'btn-toggle-vis-b', 'slider-opacity-b');
}

/**
 * 모델 데이터에서 통계와 요약 정보를 추출합니다.
 */
async function extractModelSummary(viewer, model) {
    if (!model) return null;
    const summary = {
        name: model.getData()?.loadOptions?.bubbleNode?.name() || 'Unknown Model',
        urn: model.getUrn() || 'Unknown URN',
        totalElements: 0,
        categories: {}
    };

    const targetCategories = ['Walls', 'Floors', 'Windows', 'Doors', 'Structural Columns', 'Stairs', 'Pipes', 'Ducts', 'Ceilings'];

    const getCount = (cat) => new Promise(res => {
        viewer.search(cat, (ids) => res(ids.length), (err) => res(0), ['Category']);
    });

    for (const cat of targetCategories) {
        const count = await getCount(cat);
        if (count > 0) {
            summary.categories[cat] = count;
            summary.totalElements += count;
        }
    }
    console.log('[Viewer] Final Summary:', summary);
    return summary;
}

// 지연(Sleep) 헬퍼 함수
var sleep = function(ms) { return new Promise(resolve => setTimeout(resolve, ms)); };

window.captureViewerSnapshot = function(optViewer) {
    var viewer = optViewer;
    if (!viewer) {
        viewer = window.activeBatchViewer || window.viewerLeft || window.viewer || window.NOP_VIEWER || window._viewer;
    }
    if (!viewer || !viewer.canvas) return null;
    try {
        return viewer.canvas.toDataURL('image/jpeg', 0.8);
    } catch (e) {
        console.error("captureViewerSnapshot failed:", e);
        return null;
    }
};

window.processBatchComparisonIssues = async function(type, items) {
    var currentViewer = window.viewerLeft || window.viewer || window.NOP_VIEWER || window._viewer;
    if (type === "추가" && window.viewerRight) {
        currentViewer = window.viewerRight;
    }
    if (!currentViewer) {
        console.error("No active viewer found for batch comparison issues.");
        return;
    }

    // 1. 방어 코드: 최대 30개로 개수 제한 (메모리 폭발 방지)
    var processList = items;
    var limitMsg = "";
    if (items.length > 30) {
        processList = items.slice(0, 30);
        limitMsg = " (안전성을 위해 최대 30개까지만 생성됩니다.)";
    }

    if (typeof displayBotMessage === 'function') {
        displayBotMessage("🚀 " + processList.length + "개의 항목에 대해 자동 이슈 생성을 시작합니다." + limitMsg + " 잠시만 기다려주세요...");
    }

    // 전역 캡처 컨텍스트 설정
    window.activeBatchViewer = currentViewer;

    for (var i = 0; i < processList.length; i++) {
        var item = processList[i];
        var dbIds = item.dbIds || [item.dbId];

        if (dbIds && dbIds.length > 0) {
            // 2. 카메라 이동 및 대기
            await new Promise(function(resolve) {
                currentViewer.fitToView(dbIds);
                currentViewer.addEventListener(Autodesk.Viewing.CAMERA_TRANSITION_COMPLETED, resolve, { once: true });
                setTimeout(resolve, 2000); // 2초 후 강제 진행 (무한 대기 방지)
            });

            // 3. 방어 코드: 모델이 선명하게 렌더링될 때까지 1.5초 대기 (흐린 사진 방지)
            await sleep(1500);

            // 4. 스냅샷 캡처
            var snapshotBase64 = typeof captureViewerSnapshot === 'function' ? captureViewerSnapshot() : null;

            // 5. 데이터 조립
            var versionAName = document.getElementById('slot-a-name')?.textContent || 'Version A';
            var versionBName = document.getElementById('slot-b-name')?.textContent || 'Version B';
            var structName = "";
            var wType = "";
            if (versionAName) {
                var tokens = versionAName.split('_');
                if (tokens.length >= 2) {
                    structName = tokens[0];
                    wType = tokens[1];
                }
            }

            var currentUserName = (window.currentUser && window.currentUser.name) || 
                                  (window.UserProfile && window.UserProfile.name) || 
                                  (function() {
                                      var loginEl = document.getElementById('login');
                                      if (loginEl && loginEl.innerText && loginEl.innerText.indexOf('Logout') !== -1) {
                                          var match = loginEl.innerText.match(/Logout \(([^)]+)\)/);
                                          if (match) return match[1];
                                      }
                                      return null;
                                  })() || 
                                  "자동 생성 봇";

            var issueData = {
                id: Date.now() + i,
                title: "[" + type + "됨] " + (item.name || "알 수 없는 부재"),
                description: "버전 비교 결과 " + type + "된 항목입니다.",
                resolutionDesc: "",
                author: currentUserName,
                assignee: currentUserName,
                structureName: structName,
                workType: wType,
                dbId: dbIds[0],
                point: null,
                thumbnail: snapshotBase64,
                afterThumbnail: "",
                beforeImage: snapshotBase64,
                afterImage: "",
                versionA: versionAName,
                versionB: versionBName,
                urn: window.currentUrn || "",
                projectId: window.activeExplorerProjectId || window.currentProjectId || (new URLSearchParams(window.location.search)).get('projectId') || "default_project",
                isComparison: true, // 버전 비교 이슈 플래그
                snapshotData: snapshotBase64, // Pseudocode compatibility
                status: "Open"
            };

            // 6. 서버 API 호출 (Ajax & Fetch Fallback)
            try {
                if (typeof $ !== 'undefined' && typeof $.ajax === 'function') {
                    await $.ajax({
                        url: '/api/issues', // 🚨 실제 이슈 생성 API 엔드포인트로 맞출 것
                        method: 'POST',
                        data: JSON.stringify(issueData),
                        contentType: 'application/json'
                    });
                } else {
                    var response = await fetch('/api/issues', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(issueData)
                    });
                    if (!response.ok) {
                        throw new Error("HTTP error " + response.status);
                    }
                }
                console.log((i + 1) + "/" + processList.length + " 이슈 생성 완료");
            } catch (error) {
                console.error("이슈 생성 실패:", error);
            }

            // 7. 방어 코드: 서버 DDoS 오인(429 에러) 방지를 위해 요청 간 0.5초 대기
            await sleep(500);
        }
    }

    // 전역 캡처 컨텍스트 해제
    delete window.activeBatchViewer;
    
    if (typeof displayBotMessage === 'function') {
        displayBotMessage("✅ " + processList.length + "개의 버전 비교 이슈 작성이 완료되었습니다! 이슈 목록을 새로고침하여 확인하세요.");
    }

    if (typeof window.renderComparisonIssues === 'function') {
        var projectId = window.currentProjectId || "default_project";
        window.renderComparisonIssues(projectId);
    }
};

