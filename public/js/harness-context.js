/**
 * [Harness Engineering] Layer 1: Contextual Awareness (The "Eyes")
 * harness-context.js - APS Viewer 상태 인식 및 고성능 비동기 추출 엔진
 */

(function () {
    'use strict';

    const ContextHarness = {
        currentData: null,
        isExtracting: false,

        /**
         * 실시간 메타데이터를 추출합니다. 뷰어 객체가 없어도 이슈 데이터를 항상 최우선으로 가져옵니다.
         */
        extract: async function (viewer, retryCount = 0) {
            if (this.isExtracting && retryCount === 0) return;
            this.isExtracting = true;

            const modelData = {
                name: 'Project Dashboard',
                urn: 'none',
                categories: {},
                totalElements: 0,
                timestamp: new Date().toISOString(),
                issues: [],
                issueStructureCounts: {}
            };

            // [Viewer-Independent Architecture] 이슈 데이터는 모델 로드 여부와 무관하게 항상 수집
            console.log('[Context-Harness] 데이터 인식 엔진 가동: 이슈 데이터 수집 우선순위 적용');
            await this._fetchIssuesFromApi(modelData);

            // 1. 뷰어가 있고 모델이 로드된 경우 (3D 형상 데이터 보강)
            if (viewer && viewer.model) {
                const model = viewer.model;
                modelData.urn = model.getUrn ? model.getUrn() : (model.getData()?.urn || model.getSeedFile?.() || 'unknown-urn');

                try {
                    modelData.name = model.getData()?.loadOptions?.bubbleNode?.name?.() ||
                        model.getData()?.loadOptions?.bubbleNode?.name ||
                        'BIM Model';
                } catch (e) {
                    console.warn('[Context-Harness] 모델명 추출 실패:', e);
                }

                if (!model.isObjectTreeCreated()) {
                    viewer.addEventListener(Autodesk.Viewing.OBJECT_TREE_CREATED_EVENT, () => {
                        this._performAsyncExtraction(viewer, modelData, retryCount);
                    }, { once: true });
                } else {
                    this._performAsyncExtraction(viewer, modelData, retryCount);
                }
            } else {
                // 2. 뷰어가 없거나 모델이 아직 없는 경우 (대시보드 또는 로딩 중)
                console.log('[Context-Harness] 모델 미로드 상태. 수집된 이슈 데이터만으로 컨텍스트를 구성합니다.');
                this._dispatchContext(modelData, true);
            }
        },

        /**
         * APS(ACC) Issues API에서 실시간 이슈 데이터를 페칭합니다.
         */
        _fetchIssuesFromApi: async function (modelData) {
            try {
                if (window.currentHubId && window.currentProjectId) {
                    console.log(`[Context-Harness] ACC Issues API 호출: Hub(${window.currentHubId}), Project(${window.currentProjectId})`);
                    const resp = await fetch(`/api/hubs/${window.currentHubId}/projects/${window.currentProjectId}/issues`);
                    if (resp.ok) {
                        const issuesData = await resp.json();
                        modelData.issues = issuesData;

                        const structureCounts = {};
                        issuesData.forEach(issue => {
                            const structName = issue.structure_name || '미분류';
                            const key = (structName.trim() !== '-' && structName.trim() !== '') ? structName : '미분류';
                            structureCounts[key] = (structureCounts[key] || 0) + 1;
                        });
                        modelData.issueStructureCounts = structureCounts;
                        console.log('[Context-Harness] API 이슈 데이터 전수 조사 완료:', JSON.stringify(structureCounts));
                    } else {
                        console.warn('[Context-Harness] API Fetch Failed:', resp.statusText);
                    }
                } else {
                    console.warn('[Context-Harness] ProjectId 또는 HubId 누락으로 이슈를 가져올 수 없습니다.');
                }
            } catch (err) {
                console.error('[Context-Harness] API 페치 예외 발생:', err);
            }
        },

        /**
         * 컨텍스트 업데이트 이벤트를 발송합니다.
         */
        _dispatchContext: function (modelData, isDashboard = false) {
            window.ContextHarness.currentData = modelData;
            window.ContextHarness.isExtracting = false;

            // [Fix] AI 컨텍스트: 내부 ID/URN 제외, 카테고리 요약만 주입
            let finalSummary = `## 현재 로드된 BIM 모델 정보\n- 파일명: ${modelData.name}\n- 총 객체 수: ${modelData.totalElements}개\n`;

            const hasCategories = !isDashboard && modelData.categories && Object.keys(modelData.categories).length > 0;

            if (hasCategories) {
                const catSummary = Object.entries(modelData.categories)
                    .filter(([, cnt]) => cnt > 0)
                    .sort((a, b) => b[1] - a[1]) // 많은 순으로 정렬
                    .map(([name, cnt]) => `  - ${name}: ${cnt}개`)
                    .join('\n');
                const catCount = Object.keys(modelData.categories).length;
                finalSummary += `- 카테고리 수: ${catCount}종\n- 카테고리별 수량:\n${catSummary}\n`;

                // [New] 깔끔한 콘솔 요약 로그
                console.log(`[Context-Harness] ✅ 인지 완료: ${catCount}개 카테고리 요약됨 (총 ${modelData.totalElements}개 객체)`);
            } else if (!isDashboard) {
                finalSummary += `\n> [알림] 현재 모델의 상세 기하 정보를 스캔 중입니다. 잠시 후 다시 질문하시면 정확한 카테고리 정보를 확인할 수 있습니다.\n`;
            }

            if (modelData.issueStructureCounts && Object.keys(modelData.issueStructureCounts).length > 0) {
                finalSummary += `\n## Issue Structure Analysis (JSON)\n${JSON.stringify(modelData.issueStructureCounts)}\n`;
            }

            const eventData = { ...modelData, summaryText: finalSummary };
            window.dispatchEvent(new CustomEvent('CONTEXT_HARNESS_UPDATED', { detail: eventData }));
            window.dispatchEvent(new CustomEvent('APS_MODEL_DATA_EXTRACTED', { detail: eventData }));

            if (window.AIPanel?.updateSystemContext) {
                window.AIPanel.updateSystemContext(eventData);
            }
        },

        /**
         * 비동기 하베스팅 및 배치 처리 수행
         */
        _performAsyncExtraction: async function (viewer, modelData, retryCount = 0) {
            try {
                const model = viewer.model;
                const pdb = model.getPropertyDb ? model.getPropertyDb() : null;

                // [Refined Algorithm] Instance Detection - Revit ID 패턴 및 리프 노드 기준
                const tree = model.getInstanceTree();
                if (!tree || typeof tree.getRootId !== 'function') {
                    console.warn('[Context-Harness] Instance Tree가 아직 준비되지 않았습니다. 대기 후 재시도합니다.');
                    if (retryCount < 5) {
                        setTimeout(() => this.extract(viewer, retryCount + 1), 1000);
                    }
                    return;
                }

                const catMap = {};
                const traceSample = {}; // undefined 에러 방지용 객체 추가
                let totalFound = 0;
                const rootId = tree.getRootId();

                // [SSOT] 중앙 데이터 저장소 초기화 - harness-action.js가 이 맵만 참조함
                window.categoryInstancesMap = {};

                // [New] 모델 검색기(Model Browser) 기반 깨끗한 카테고리 추출
                this._extractUICategories(viewer);

                // 디버깅용 수집기
                const debugFoundSample = [];

                function findInstances(nodeId, currentCat, path) {
                    const nodeName = (tree.getNodeName(nodeId) || '').trim();
                    const childCount = tree.getChildCount(nodeId);
                    const currentPath = path ? `${path} > ${nodeName}` : nodeName;

                    // [Refined Algorithm - Deep Traversal]
                    // 1. 자식이 있는 노드(폴더)는 [ID]가 있어도 무조건 더 깊이 탐색을 계속함 (Type Node 오인 방지)
                    // 2. 자식이 없는 리프 노드(childCount === 0)에 도달했을 때만 인스턴스로 간주하여 카운트

                    const isSystemNode = nodeName === '' ||
                        nodeName.includes('Material') ||
                        nodeName.includes('Solid') ||
                        nodeName.includes('Geometry');

                    if (childCount === 0 && !isSystemNode) {
                        catMap[currentCat] = (catMap[currentCat] || 0) + 1;
                        totalFound++;

                        // [SSOT] 카운트와 동시에 dbId를 중앙 맵에 저장
                        if (!window.categoryInstancesMap[currentCat]) {
                            window.categoryInstancesMap[currentCat] = [];
                        }
                        window.categoryInstancesMap[currentCat].push(nodeId);

                        // [Final-Check] 디버깅 로그용 데이터 수집
                        if (debugFoundSample.length < 2) debugFoundSample.push(nodeId);

                        if (!traceSample[currentCat]) {
                            traceSample[currentCat] = currentPath;
                            console.log(`[Context-Harness] 🔍 인스턴스 확정 [${currentCat}]: ${currentPath} (Id: ${nodeId})`);
                        }
                        return; // 말단 노드에서 카운트 완료
                    }

                    // 자식이 있다면 (아무리 이름에 [ID]가 있어도) 깊이 탐색을 계속함
                    tree.enumNodeChildren(nodeId, function (childId) {
                        findInstances(childId, currentCat, currentPath);
                    });
                }

                function findCategories(nodeId) {
                    const nodeName = tree.getNodeName(nodeId) || '';
                    const cleanName = nodeName.replace(/^Revit\s+/i, '').trim();

                    const targetList = window.dynamicCategories || [];
                    const isCatNode = targetList.includes(cleanName) || targetList.includes(nodeName);

                    if (isCatNode) {
                        // 카테고리 달성 시 하위 그룹들을 뚫고 인스턴스/리프 노드까지 탐색
                        tree.enumNodeChildren(nodeId, function (childId) {
                            findInstances(childId, cleanName, cleanName);
                        });
                    } else {
                        // 아직 카테고리가 아니면 계속 파생 탐색
                        tree.enumNodeChildren(nodeId, function (childId) {
                            findCategories(childId);
                        });
                    }
                }

                findCategories(rootId);

                // [Final-Check] 카테고리별 정밀 수량 리포트
                Object.keys(catMap).forEach(cat => {
                    console.log(`[Final-Check] 카테고리: ${cat}, 수량: ${catMap[cat]}, 샘플ID: [${debugFoundSample.join(', ')}]`);
                });

                console.log(`[Context-Harness] Instance Tree 정밀 탐색 완료 - 카테고리 ${Object.keys(catMap).length}개 분류`);

                // 불필요한 재계산 및 중복 선언 제거
                console.log(`[Context-Harness] PDB 스캔 완료 - 카테고리 ${Object.keys(catMap).length}개, 총 ${totalFound}개 논리적 객체 파악`);

                // 추출 결과가 0개인 경우 재시도
                if (totalFound <= 2 && retryCount < 3) {
                    console.warn(`[Context-Harness] 형상 추출 미흡(${totalFound}개). 재시도...`);
                    this.isExtracting = false;
                    setTimeout(() => this.extract(viewer, retryCount + 1), 2000);
                    return;
                }

                modelData.categories = catMap;
                modelData.totalElements = totalFound;
                modelData.categoryList = Object.keys(catMap).sort();

                // [SSOT 검증 로그] 중앙 맵 구축 완료 보고
                const ssotSummary = Object.entries(window.categoryInstancesMap)
                    .map(([cat, ids]) => `${cat}: ${ids.length}개`).join(', ');
                console.log(`[SSOT] ✅ categoryInstancesMap 구축 완료 → { ${ssotSummary} }`);

                // [🔧 버그 수정] _extractUICategories가 인스턴스를 중복 순회하여
                // "계단, 계단, 계단..." 형태로 오염시키는 문제를 원천 차단.
                // categoryInstancesMap의 키는 이미 중복 없이 정제된 카테고리 이름이므로
                // 이것으로 dynamicCategories를 덮어써서 단일 진실 원천(SSOT)을 보장합니다.
                window.dynamicCategories = Object.keys(window.categoryInstancesMap).sort();
                console.log('[SSOT] ✅ dynamicCategories 동기화 완료 (중복 제거됨):', window.dynamicCategories);

                // [New] 재료(Material) 속성 대량 추출 로직
                const allLeafIds = [];
                for (const ids of Object.values(window.categoryInstancesMap)) {
                    allLeafIds.push(...ids);
                }
                
                // [수정] 🌟 리프 노드 한계를 넘은 '모든 노드(All dbIds)' 전수 검사를 리프 노드 검사로 변경
                const instanceTree = viewer.model.getInstanceTree();
                // 모든 노드 전수 조사는 성능 저하를 일으키므로 allLeafIds(리프 노드)만 사용합니다.
                
                window.materialInstancesMap = {};
                if (allLeafIds.length > 0) {
                    try {
                        const propNames = ['재료', 'Material', '재질', '구조 재질', '재료 및 마감재', '구조 재료', 'Structural Material', '길이', 'Length', '체적', 'Volume', '부피', '유형 이름', '유형', 'Type Name', 'Type', '모델', 'Model', '패밀리', 'Family', '이름', 'Name', '패밀리 및 유형', 'Family and Type', '카테고리', 'Category'];
                        const props = await new Promise((resolve, reject) => {
                            model.getBulkProperties(allLeafIds, { propFilter: propNames }, resolve, reject);
                        });
                        
                        // dbId -> category 역방향 조회를 위한 맵 구성
                        const idToCat = {};
                        for (const [cat, ids] of Object.entries(window.categoryInstancesMap)) {
                            ids.forEach(id => idToCat[id] = cat);
                        }

                        // [New] 수치 데이터 합산을 위한 전역 객체 초기화 (사다리 기본 구조 포함)
                        window.quantityStatsMap = { 
                            categories: {}, 
                            materials: {},
                            ladders: { totalCount: 0, totalLength: 0, models: {} }
                        };

                        props.forEach(p => {
                            const dbId = p.dbId;
                            const cat = idToCat[dbId] || '미분류';
                            
                            let objLength = 0;
                            let objVolume = 0;
                            let objMaterials = [];
                            let rawTypeName = '';        // 원본 유형명 임시 저장
                            let typeNameLocked = false;  // id 데이터 카테고리로 확정된 경우 플래그
                            let isLadder = false;        // [신규] Ladder 키워드 포함 여부
                            let ladderModelName = '기본 모델'; // [신규] id 데이터 > 모델 속성값
                            
                            if (p.properties && p.properties.length > 0) {
                                p.properties.forEach(prop => {
                                    const name = prop.displayName;
                                    const val = prop.displayValue;
                                    const category = prop.displayCategory; // 속성이 속한 그룹(탭) 이름
                                    
                                    if (name && val) {
                                        // 1. 재료 수집
                                        if (['재료', 'Material', '재질', '구조 재질', '재료 및 마감재', '구조 재료', 'Structural Material'].includes(name)) {
                                            const matName = val;
                                            objMaterials.push(matName);
                                            
                                            if (!window.materialInstancesMap[matName]) {
                                                window.materialInstancesMap[matName] = {};
                                            }
                                            if (!window.materialInstancesMap[matName][cat]) {
                                                window.materialInstancesMap[matName][cat] = new Set();
                                            }
                                            window.materialInstancesMap[matName][cat].add(dbId);
                                        }
                                        
                                        // 2. 수치 파싱 (원본 단위 mm 그대로 저장)
                                        if (['길이', 'Length'].includes(name)) {
                                            objLength = parseFloat(val) || 0;
                                        }
                                        if (['체적', 'Volume', '부피'].includes(name)) {
                                            objVolume = parseFloat(val) || 0;
                                        }

                                        // 3. [이중 전략] 유형 이름 추출
                                        if (!typeNameLocked) {
                                            const isTypeName = (name === '유형 이름' || name === 'Type Name');
                                            const isTypeNameLoose = (name === '유형' || name === 'Type');
                                            const isIdentityData = category && (
                                                category.includes('id 데이터') ||
                                                category.toLowerCase().includes('identity data')
                                            );

                                            if (isIdentityData && isTypeName) {
                                                rawTypeName = String(val);
                                                typeNameLocked = true;
                                                console.log(`[Context-Harness] ✅ [1상확정] 유형 이름 [${cat}] → "${rawTypeName}" (category: ${category})`);
                                            } else if ((isTypeName || isTypeNameLoose) && rawTypeName === '') {
                                                rawTypeName = String(val);
                                                console.log(`[Context-Harness] 🔶 [2차폴백] 유형 이름 임시 [${cat}] → "${rawTypeName}" (category: ${category})`);
                                            }
                                        }

                                        // 🌟 2차 그물망: 속성 중 이름과 관련된 모든 항목에서 검사
                                        const lowerPropName = String(name).toLowerCase();
                                        const isNameRelated = lowerPropName.includes('이름') || lowerPropName.includes('name') || 
                                                              lowerPropName.includes('유형') || lowerPropName.includes('type') || 
                                                              lowerPropName.includes('패밀리') || lowerPropName.includes('family') ||
                                                              lowerPropName.includes('카테고리') || lowerPropName.includes('category');
                                        
                                        const valStr = val ? String(val).trim() : '';
                                        const valUpper = valStr.toUpperCase();

                                        if (isNameRelated && valUpper.includes('LADDER')) {
                                            isLadder = true;
                                            ladderModelName = valStr; // "Ladder_B_F" 등 원본 값을 그대로 모델명으로 채택
                                        }

                                        // 4. 모델명 추출: 'id 데이터' 카테고리의 '모델' 속성 (단, 이름 기반 추출이 안 된 경우만)
                                        const isIdentityDataForModel = category && (
                                            category.includes('id 데이터') ||
                                            category.toLowerCase().includes('identity data')
                                        );
                                        if (isIdentityDataForModel && (name === '모델' || name === 'Model') && val) {
                                            if (ladderModelName === '기본 모델') {
                                                ladderModelName = String(val).trim();
                                            }
                                        }
                                    }
                                });

                                // 🌟 예외 처리 방어막: 객체 최상위 노드 이름에 들어있는 경우
                                const nodeName = instanceTree.getNodeName(dbId);
                                if (!isLadder && nodeName && String(nodeName).toUpperCase().includes('LADDER')) {
                                    isLadder = true;
                                    ladderModelName = nodeName; 
                                }

                                // 3-후처리. 키워드 includes 기반 정규화 (루프 종료 후 실행)
                                // Revit 유형명이 "난간_수평_1200", "경사 난간 타입A" 등 다양한 형태로 올 수 있으므로
                                // 핵심 키워드 포함 여부로 깔끔하게 그룹화
                                let objTypeName;
                                if (rawTypeName === '') {
                                    objTypeName = '기본형';  // 전혀 추출 못한 경우 폴백
                                } else if (rawTypeName.includes('수평')) {
                                    objTypeName = '수평형';
                                } else if (rawTypeName.includes('경사')) {
                                    objTypeName = '경사형';
                                } else {
                                    objTypeName = rawTypeName; // 수평/경사가 아니면 원본 이름 그대로 사용
                                }

                                if (rawTypeName !== '' && objTypeName !== rawTypeName) {
                                    console.log(`[Context-Harness] 🔀 유형 정규화: "${rawTypeName}" → "${objTypeName}"`);
                                }
                                // 4. 카테고리별 합산
                                if (!window.quantityStatsMap.categories[cat]) {
                                    window.quantityStatsMap.categories[cat] = { length: 0, volume: 0, types: {} };
                                }
                                window.quantityStatsMap.categories[cat].length += objLength;
                                window.quantityStatsMap.categories[cat].volume += objVolume;

                                // 5. [신규] 유형별 세부 합산 (길이가 있는 경우에만)
                                if (objLength > 0) {
                                    if (!window.quantityStatsMap.categories[cat].types[objTypeName]) {
                                        window.quantityStatsMap.categories[cat].types[objTypeName] = { length: 0 };
                                    }
                                    window.quantityStatsMap.categories[cat].types[objTypeName].length += objLength;
                                }

                                // 6. 재료별 합산 (객체가 가진 모든 재료에 대해 체적 누적)
                                objMaterials.forEach(mat => {
                                    if (!window.quantityStatsMap.materials[mat]) {
                                        window.quantityStatsMap.materials[mat] = { volume: 0 };
                                    }
                                    window.quantityStatsMap.materials[mat].volume += objVolume;
                                });

                                // 7. [신규] Ladder 전용 동적 탐지 및 모델별 집계
                                if (isLadder) {
                                    window.quantityStatsMap.ladders.totalCount += 1;
                                    window.quantityStatsMap.ladders.totalLength += objLength;

                                    if (!window.quantityStatsMap.ladders.models[ladderModelName]) {
                                        window.quantityStatsMap.ladders.models[ladderModelName] = { count: 0, length: 0 };
                                    }
                                    window.quantityStatsMap.ladders.models[ladderModelName].count += 1;
                                    window.quantityStatsMap.ladders.models[ladderModelName].length += objLength;

                                    console.log(`[Context-Harness] 🧳 Ladder 탐지: dbId=${dbId}, model="${ladderModelName}", length=${objLength}mm`);
                                }
                            }
                        });

                        // 🌟 디버깅: 루프가 끝난 직후 콘솔에 결과 강제 출력
                        console.log('[DEBUG-LADDER] 최종 수집된 사다리 데이터:', window.quantityStatsMap.ladders);

                        // Set을 Array로 변환 (ai-panel.js의 .length 호환성을 위해)
                        for (const matName in window.materialInstancesMap) {
                            for (const cat in window.materialInstancesMap[matName]) {
                                window.materialInstancesMap[matName][cat] = Array.from(window.materialInstancesMap[matName][cat]);
                            }
                        }
                        console.log(`[Context-Harness] ✅ 재료 추출 완료: ${Object.keys(window.materialInstancesMap).length}종의 재료 매핑됨`);
                    } catch(e) {
                        console.warn('[Context-Harness] 재료 속성 추출 중 오류 발생:', e);
                    }
                }

                // [New] window.modelSnapshot 저장
                window.modelSnapshot = {
                    categories: catMap,
                    totalElements: totalFound,
                    categoryList: modelData.categoryList,
                    urn: modelData.urn,
                    name: modelData.name,
                    timestamp: new Date().toISOString(),
                    categoryInstancesMap: window.categoryInstancesMap  // [SSOT] 스냅샷에도 포함
                };

                // ================================================================
                // [LADDER-SEARCH] Native viewer.search API 기반 사다리 강제 탐지
                // getBulkProperties 루프가 놓친 경우를 완벽히 커버합니다.
                // ================================================================
                // 전역 ladders 구조가 없으면 미리 초기화
                if (!window.quantityStatsMap) {
                    window.quantityStatsMap = { categories: {}, materials: {}, ladders: { totalCount: 0, totalLength: 0, models: {} } };
                }
                if (!window.quantityStatsMap.ladders) {
                    window.quantityStatsMap.ladders = { totalCount: 0, totalLength: 0, models: {} };
                }

                try {
                    await new Promise((resolve) => {
                        const tree = viewer.model.getInstanceTree();
                        if (!tree) {
                            resolve();
                            return;
                        }

                        const rootId = tree.getRootId();
                        // 🌟 1. 카운트 시작 전 전역 상태 강제 초기화
                        window.quantityStatsMap.ladders = { totalCount: 0, totalLength: 0, models: {} };

                        const allLadderIds = [];

                        // 🌟 2. APS Instance Tree 하위 객체 중복 카운트 필터링 (수동 재귀)
                        tree.enumNodeChildren(rootId, function walk(id) {
                            const name = tree.getNodeName(id) || "";
                            const upperName = name.toUpperCase();

                            // 사다리 본체 노드 탐지 패턴
                            if (upperName.includes("LADDER_")) {
                                // Revit 특성상 [ID]가 붙은 노드가 본체 인스턴스인 경우가 많음
                                // 또는 자식이 없는 Leaf 노드인 경우
                                if (name.includes("[") || tree.getChildCount(id) === 0) {
                                    allLadderIds.push(id);
                                    return; // 🌟 본체를 찾았으므로 하위 부품(Fragment)으로 파고들지 않음 (중복 방지 핵심)
                                }
                            }

                            // 사다리 본체가 아니라면 계속해서 하위 노드 탐색
                            tree.enumNodeChildren(id, walk, false);
                        }, false);

                        console.log('🤖 실제 스캔된 사다리 장부(ID 수집 완료):', allLadderIds.length, '개');

                        // 🌟 2단계: 수집된 ID들로만 속성(모델명, 길이) 정밀 추출
                        if (allLadderIds.length > 0) {
                            viewer.model.getBulkProperties(allLadderIds, { propFilter: ['모델', 'Model', 'L', '길이', 'Length', '높이', 'Height'] }, function(results) {
                                results.forEach(result => {
                                    let modelName = (tree.getNodeName(result.dbId) || "").split('[')[0].trim();
                                    let lengthMM = 0;

                                    if (result.properties) {
                                        result.properties.forEach(p => {
                                            const name = p.displayName;
                                            const valStr = p.displayValue ? String(p.displayValue).trim() : '';

                                            // 특성의 'ID 데이터' - '모델' 칸에 값이 있다면 이름표 교체!
                                            if (['모델', 'Model'].includes(name) && valStr !== '') {
                                                modelName = valStr;
                                            }

                                            // 치수 추출
                                            const isLengthProp = ['L', '길이', 'Length', '높이', 'Height'].includes(name);
                                            if (isLengthProp && valStr !== '' && lengthMM === 0) {
                                                lengthMM = parseFloat(valStr) || 0;
                                            }
                                        });
                                    }

                                    // 최종 확정된 이름표로 장부 작성
                                    window.quantityStatsMap.ladders.totalCount += 1;
                                    window.quantityStatsMap.ladders.totalLength += lengthMM;

                                    if (!window.quantityStatsMap.ladders.models[modelName]) {
                                        window.quantityStatsMap.ladders.models[modelName] = { count: 0, length: 0 };
                                    }
                                    window.quantityStatsMap.ladders.models[modelName].count += 1;
                                    window.quantityStatsMap.ladders.models[modelName].length += lengthMM;
                                });
                                console.log("🤖 실제 스캔된 사다리 장부: ", window.quantityStatsMap.ladders);
                                resolve();
                            }, function(err) {
                                console.warn('[DEBUG-SNIPER-MODEL] getBulkProperties 오류:', err);
                                resolve();
                            });
                        } else {
                            resolve();
                        }
                    });
                } catch(searchErr) {
                    console.warn('[LADDER-SEARCH] 탐지 중 예외 발생:', searchErr);
                }
                // ================================================================

                // 이슈 데이터 보강
                await this._fetchIssuesFromApi(modelData);

                console.log(`[Context-Harness] 최종 인지 완료: 총 ${totalFound}개 객체, 이슈 ${modelData.issues?.length || 0}개`);
                this._dispatchContext(modelData, false);

            } catch (err) {
                console.error('[Context-Harness] 3D 형상 추출 실패:', err);
                this.isExtracting = false;
            }
        },

        /**
         * [New] 모델 검색기(Model Browser)의 최상위 노드 이름들을 동적으로 추출합니다.
         */
        _extractUICategories: function (viewer) {
            if (!viewer || !viewer.model) return;
            const tree = viewer.model.getInstanceTree();
            if (!tree) return;

            const rootId = tree.getRootId();
            const uiCategories = [];

            // 루트의 직속 자식(모델 검색기의 최상위 폴더들)을 순회
            tree.enumNodeChildren(rootId, function (childId) {
                let nodeName = tree.getNodeName(childId) || '';

                // [ 버그 수정] 이름 뒤의 수량 표기 제거 (예: "벽 (67)" -> "벽")
                if (nodeName.includes('(')) {
                    nodeName = nodeName.split('(')[0].trim();
                }

                // 이름이 있는 실제 물리 객체 폴더만 수집
                if (nodeName && !nodeName.includes('.dwg') && !nodeName.includes('Project Info')) {
                    uiCategories.push(nodeName);
                }
            });

            // 중복 제거 후 전역 변수에 저장 (이것이 완벽히 깨끗한 메뉴판이 됩니다)
            const cleaned = [...new Set(uiCategories)].sort();
            window.dynamicCategories = cleaned;
            console.log('[UI-Sync] 모델 검색기 카테고리 로드 완료:', window.dynamicCategories);
            return cleaned;
        }
    };

    window.ContextHarness = ContextHarness;
})();
