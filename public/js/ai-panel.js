/* ============================================================
   ai-panel.js — AI Chat Panel Logic
   ============================================================ */
'use strict';

/**
 * Global Toast Notification System
 */
window.showToast = function (message, type = 'info', duration = 3000) {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 10000;
            display: flex;
            flex-direction: column;
            gap: 10px;
            pointer-events: none;
        `;
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    const colors = {
        success: '#4CAF50',
        error: '#F44336',
        warning: '#FF9800',
        info: '#2196F3'
    };

    toast.style.cssText = `
        background: rgba(30, 30, 30, 0.9);
        color: white;
        padding: 12px 24px;
        border-radius: 8px;
        font-family: sans-serif;
        font-size: 14px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        border-left: 4px solid ${colors[type] || colors.info};
        min-width: 200px;
        text-align: center;
        animation: toast-in 0.3s ease-out;
        pointer-events: auto;
    `;
    toast.textContent = message;

    if (!document.getElementById('toast-anim')) {
        const style = document.createElement('style');
        style.id = 'toast-anim';
        style.textContent = `
            @keyframes toast-in {
                from { opacity: 0; transform: translateY(20px); }
                to { opacity: 1; transform: translateY(0); }
            }
            @keyframes toast-out {
                from { opacity: 1; transform: translateY(0); }
                to { opacity: 0; transform: translateY(-20px); }
            }
        `;
        document.head.appendChild(style);
    }

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'toast-out 0.3s ease-in forwards';
        setTimeout(() => toast.remove(), 300);
    }, duration);
};

const AIPanel = (() => {
    let chatHistory = [];
    let modelContext = null;
    let currentUrn = null;
    let isLoading = false;
    let recursiveCount = 0;
    let systemContextData = null;
    let lastCallTime = 0;
    let callCountInWindow = 0;

    const elements = {
        chatMessages: null,
        chatInput: null,
        sendBtn: null,
        contextBody: null,
        aiProviderBadge: null,
        analyzeSelectionBtn: null
    };

    function updateSystemContext(summary) {
        if (!summary) return;
        currentUrn = summary.urn;

        const uiModelName = document.getElementById('viewer-model-name')?.textContent || summary.name;

        // [Dynamic Update] 프로젝트에서 실시간 스캔한 카테고리 목록 최우선 적용
        // [Dynamic Update] 프로젝트에서 실시간 스캔한 카테고리 목록 최우선 적용
        const dynCats = (window.dynamicCategories && window.dynamicCategories.length > 0)
            ? window.dynamicCategories.join(', ')
            : ((summary.categoryList && summary.categoryList.length > 0) ? summary.categoryList.join(', ') : "[]");

        // [Fix] Zero-Shot Matching 및 할루시네이션 방어(2중 보안) 지침 주입
        systemContextData = `[modelSnapshot] 현재 뷰어의 실제 객체 카테고리 목록: [${dynCats}]
(참고: 총 객체 수 ${summary.totalElements}개)

[AI 필수 실행 지침] 당신은 창작자가 아니라 주어진 데이터를 정확히 분류하는 '분류기(Classifier)'입니다.
1. 사용자의 명령을 받으면, 반드시 위 [실제 객체 카테고리 목록] 배열 안에 존재하는 정확한 문자열 중 하나만 골라 TARGET으로 사용하십시오.
2. 만약 사용자의 요청과 일치하는 카테고리가 목록에 아예 없다면, 임의로 단어를 지어내지 마십시오.
3. 매칭되는 항목이 없을 경우, 반드시 [ACTION:REPLY, MESSAGE:해당하는 객체를 모델에서 찾을 수 없습니다.] 라고 답변하여 사용자에게 알리십시오.
4. 모델 데이터가 한국어라면 영어로 번역하지 말고 한국어 그대로 TARGET에 넣으십시오.

[CRITICAL EXAMPLES - 반드시 아래 패턴을 모방하라]
현재 카테고리 목록이 ["벽", "바닥", "계단", "Pipes"] 라고 가정할 때:
- 사용자: "바닥 선택해 줘" -> 출력: [ACTION:SELECT, TARGET:바닥]
- 사용자: "Floors 잡아줘" -> 출력: [ACTION:SELECT, TARGET:바닥] (목록에 Floors가 없고 바닥이 있으므로 바닥 선택)
- 사용자: "배관 어딨어?" -> 출력: [ACTION:SELECT, TARGET:Pipes]
- 사용자: "지붕 선택해" -> 출력: [ACTION:REPLY, MESSAGE:해당하는 객체를 모델에서 찾을 수 없습니다.] (목록에 없으므로 거절)
- 사용자: "벽을 빨간색으로 표시해줘" -> 출력: [ACTION:THEME, TARGET:벽, COLOR:red]
- 사용자: "기둥을 노란색으로 칠해줘" -> 출력: [ACTION:THEME, TARGET:기둥, COLOR:yellow]
- 사용자: "뷰어 원래대로 돌려줘" -> 출력: [ACTION:RESET_VIEWER]

[THEME 액션 지원 색상 목록: red, blue, green, yellow, orange, cyan, magenta, white]
(사용 형식: [ACTION:THEME, TARGET:카테고리명, COLOR:색상명])
(뷰어 초기화 형식: [ACTION:RESET_VIEWER])

[CRITICAL RULE]: 사용자가 여러 객체의 색상 변경이나 선택을 동시에 요구할 경우, 절대로 태그를 하나로 뭉뚱그리거나 생략하지 마세요. 반드시 각 대상마다 개별적인 [ACTION:THEME, TARGET:..., COLOR:...] 태그를 응답 텍스트에 모두 포함해야 합니다.`;

        console.log('[AI-Panel] System Context Updated (Hallucination Defense Enabled):', uiModelName);
    }

    function setContextLoading(isLoading, progress = 0) {
        if (!elements.contextBody) return;

        if (isLoading) {
            elements.contextBody.innerHTML = `
                <div class="context-loading">
                    <div class="context-spinner"></div>
                    <p>모델 정보를 분석 중입니다... (${progress}%)</p>
                </div>
            `;
        } else if (progress === 0 && !modelContext) {
            elements.contextBody.innerHTML = '<p class="context-empty">No elements selected. Select elements in the viewer to add context.</p>';
        }
    }

    async function loadProviderInfo() {
        try {
            const res = await fetch('/api/ai/provider');
            const data = await res.json();
            const badge = elements.aiProviderBadge;
            if (badge) {
                const label = data.provider === 'gemini' ? '✦ Google Gemini'
                    : data.provider === 'openai' ? '⬡ OpenAI GPT'
                        : data.provider === 'ollama' ? '🦙 Local Ollama'
                            : '⚠ Not Configured';
                badge.textContent = label;
            }
        } catch { /* ignore */ }
    }

    function addBubble(role, content, isError = false) {
        const container = elements.chatMessages;
        if (!container) return;

        const welcome = container.querySelector('.chat-welcome');
        if (welcome) welcome.remove();

        const div = document.createElement('div');
        div.className = `chat-bubble ${isError ? 'error' : role}`;

        var safeContent = content;

        // 🚨 [JSON 출력 방어] LLM이 JSON 또는 액션 태그를 그대로 출력한 경우 삸이턱어 지우기
        if (safeContent.indexOf('"action"') > -1 || safeContent.indexOf('ISSUE_QUERY') > -1) {
            // JSON 블록 전체를 제거 ('{' ~ '}' 범위의 텍스트)
            safeContent = safeContent.replace(/\{[\s\S]*?"action"[\s\S]*?\}/gi, '').trim();
            if (!safeContent || safeContent.length < 5) {
                safeContent = '항목을 확인했습니다. 자세한 결과는 우측 프로젝트 이슈 패널을 참고해 주세요.';
            }
        }
        // 🚨 [남은 <<ACTION_...>> 태그 제거]
        safeContent = safeContent.replace(/<<ACTION[A-Z_:]+[^>]*>>/gi, '').trim();

        const formatted = safeContent
            .replace(/\[(?:COMMAND|ACTION)\s*:\s*[^\]]+\]/gi, '') // Hide all ACTION tag formats
            .replace(/```json\s*[\s\S]*?```/gi, '') // Hide JSON blocks
            .replace(/```([\s\S]*?)```/g, '<pre>$1</pre>')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/\n/g, '<br>');

        div.innerHTML = formatted;
        div.addEventListener('mousedown', (e) => e.stopPropagation());
        div.addEventListener('click', (e) => e.stopPropagation());

        const meta = document.createElement('div');
        meta.className = 'bubble-meta';
        meta.textContent = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        div.appendChild(meta);

        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
        return div;
    }

    window.displayBotMessage = function(content) {
        addBubble('assistant', content);
    };

    function showTyping() {
        const container = elements.chatMessages;
        if (!container) return;
        const div = document.createElement('div');
        div.className = 'typing-indicator';
        div.id = 'typing-indicator';
        div.innerHTML = '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>';
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    }

    function hideTyping() {
        const el = document.getElementById('typing-indicator');
        if (el) el.remove();
    }

    async function sendMessage(text, isSystemGenerated = false) {
        if (!text.trim() || isLoading) return;

        // 🚨 [Direct Issue Analysis/Statistics Command Interceptor]
        const isAnalysisRequest = /이슈.*(분석|요약|통계)/i.test(text);
        if (isAnalysisRequest && !isSystemGenerated) {
            const isVersionCompare = text.includes("버전비교") || text.includes("버전 비교");
            const issueTypeLabel = isVersionCompare ? "버전 비교 이슈" : "일반 프로젝트 이슈";

            console.log(`🤖 챗봇 명령 인식: [${issueTypeLabel}] 분석/통계 브리핑 실행`);

            // Add user bubble and clear input field
            addBubble('user', text);
            chatHistory.push({ role: 'user', content: text });
            elements.chatInput.value = '';
            autoResizeTextarea();

            // Set loading and disable send
            isLoading = true;
            setSendEnabled(false);
            showTyping();

            setTimeout(async () => {
                try {
                    let allIssues = [];
                    try {
                        const response = await fetch('/api/issues');
                        if (response.ok) {
                            const issues = await response.json();
                            if (window._issueManager) {
                                window._issueManager.issues = issues.filter(i => !i.isComparison);
                            }
                            window.comparisonIssues = issues.filter(i => i.isComparison === true);
                            allIssues = issues;
                        }
                    } catch (fetchErr) {
                        console.warn('[Chat-Analyze] Fetch issues failed, falling back to local memory & DOM:', fetchErr);
                    }

                    if (allIssues.length === 0) {
                        allIssues = [
                            ...(window._issueManager?.issues || []),
                            ...(window.comparisonIssues || [])
                        ];
                    }

                    let targetIssues = [];
                    if (isVersionCompare) {
                        targetIssues = allIssues.filter(issue => issue.isComparison === true);
                    } else {
                        targetIssues = allIssues.filter(issue => !issue.isComparison);
                    }

                    // DOM Fallback parsing if still empty
                    if (isVersionCompare && targetIssues.length === 0) {
                        const rows = document.querySelectorAll('#diff-issue-list tr[data-id]');
                        if (rows && rows.length > 0) {
                            targetIssues = Array.from(rows).map(row => {
                                const id = parseInt(row.getAttribute('data-id'));
                                const title = row.querySelector('.col-title')?.textContent?.trim() || '';
                                const tds = row.querySelectorAll('td');
                                const structureName = tds[2]?.textContent?.trim() || '';
                                const workType = tds[3]?.textContent?.trim() || '';
                                const assignee = tds[4]?.textContent?.trim() || '';
                                const dateStr = tds[5]?.textContent?.trim() || '';
                                return {
                                    id,
                                    title,
                                    structureName,
                                    workType,
                                    assignee,
                                    createdAt: dateStr !== '-' ? dateStr : undefined,
                                    isComparison: true
                                };
                            });
                        }
                    } else if (!isVersionCompare && targetIssues.length === 0) {
                        const rows = document.querySelectorAll('#issue-list-container .issue-item[data-id]');
                        if (rows && rows.length > 0) {
                            targetIssues = Array.from(rows).map(row => {
                                const id = parseInt(row.getAttribute('data-id'));
                                const title = row.querySelector('.issue-item-title')?.textContent?.trim() || '';
                                const description = row.querySelector('.issue-item-desc')?.textContent?.trim() || '';
                                const statusEl = row.querySelector('.issue-status-badge');
                                const status = statusEl ? statusEl.textContent.trim() : 'Open';
                                return {
                                    id,
                                    title,
                                    description,
                                    status,
                                    isComparison: false
                                };
                            });
                        }
                    }

                    // 🌟 [Hooking] 현재 프로젝트가 활성화되어 있으면 해당 프로젝트의 이슈만 분석
                    var currentPid = window.activeExplorerProjectId || window.currentProjectId || (new URLSearchParams(window.location.search)).get('projectId');
                    const dashboardPremium = document.getElementById('dashboard-premium-container');
                    const dashboardLegacy = document.getElementById('project-selection-dashboard');
                    const isDashboardActive = (dashboardPremium && dashboardPremium.style.display !== 'none' && dashboardPremium.style.display !== '') || 
                                              (dashboardLegacy && dashboardLegacy.style.display !== 'none' && dashboardLegacy.style.display !== '');
                    if (isDashboardActive) {
                        currentPid = null;
                    }
                    if (currentPid) {
                        targetIssues = targetIssues.filter(function(issue) {
                            var issuePid = issue.projectId || issue.project_id || issue.folderId;
                            if (!issuePid) return false;
                            return String(issuePid) === String(currentPid);
                        });
                    }

                    if (targetIssues.length === 0) {
                        hideTyping();
                        const noDataText = `⚠️ 현재 분석할 수 있는 [${issueTypeLabel}] 데이터가 없습니다.`;
                        if (typeof addBubble === 'function') {
                            addBubble('assistant', noDataText);
                        } else if (typeof displayBotMessage === 'function') {
                            displayBotMessage(noDataText);
                        }
                        return;
                    }

                    // 총 이슈 개수
                    const totalCount = targetIssues.length;

                    // 구조물별 집계
                    const structureCounts = {};
                    // 공종별 집계
                    const workTypeCounts = {};
                    // 날짜별 집계
                    const dateCounts = {};

                    targetIssues.forEach(issue => {
                        // 구조물명
                        const struct = issue.structureName || issue.structure || '미지정';
                        structureCounts[struct] = (structureCounts[struct] || 0) + 1;

                        // 공종명
                        const wType = issue.workType || issue.work_type || '미지정';
                        workTypeCounts[wType] = (workTypeCounts[wType] || 0) + 1;

                        // 날짜
                        let dateVal = '미지정';
                        if (issue.createdAt) {
                            dateVal = issue.createdAt.split('T')[0];
                        } else if (issue.id && issue.id > 1000000000000) {
                            try {
                                dateVal = new Date(issue.id).toISOString().split('T')[0];
                            } catch (e) {}
                        }
                        dateCounts[dateVal] = (dateCounts[dateVal] || 0) + 1;
                    });

                    // 최다 항목 찾기 헬퍼
                    const getMostFrequent = (countsObj) => {
                        let maxKey = '미지정';
                        let maxVal = 0;
                        for (const [key, val] of Object.entries(countsObj)) {
                            if (val > maxVal) {
                                maxVal = val;
                                maxKey = key;
                            }
                        }
                        return { key: maxKey, count: maxVal };
                    };

                    const mostStruct = getMostFrequent(structureCounts);
                    const mostWorkType = getMostFrequent(workTypeCounts);
                    const mostDate = getMostFrequent(dateCounts);

                    // 구조물별 표 행(tr) 생성
                    var structureRows = "";
                    var structArray = Object.entries(structureCounts).sort((a,b) => b[1] - a[1]);
                    structArray.forEach(function(item) {
                        structureRows += "<tr>" +
                            "<td style='padding:6px; border:1px solid #ddd; color:#333333;'>" + item[0] + "</td>" +
                            "<td style='padding:6px; border:1px solid #ddd; text-align:center; font-weight:bold; color:#2563eb;'>" + item[1] + "건</td>" +
                        "</tr>";
                    });

                    // 공종별 표 행(tr) 생성
                    var workTypeRows = "";
                    var workArray = Object.entries(workTypeCounts).sort((a,b) => b[1] - a[1]);
                    workArray.forEach(function(item) {
                        workTypeRows += "<tr>" +
                            "<td style='padding:6px; border:1px solid #ddd; color:#333333;'>" + item[0] + "</td>" +
                            "<td style='padding:6px; border:1px solid #ddd; text-align:center; font-weight:bold; color:#16a34a;'>" + item[1] + "건</td>" +
                        "</tr>";
                    });

                    var tableTemplate = "<hr style='margin:15px 0; border:0; border-top:1px dashed #ccc;'>" +
                    "<p style='margin-bottom:8px; font-weight:bold;'>🏢 구조물별 상세 현황</p>" +
                    "<table style='width:100%; border-collapse:collapse; margin-bottom:15px; font-size:0.85rem;'>" +
                        "<tr style='background:#f8fafc;'><th style='padding:6px; border:1px solid #ddd; color:#333333;'>구조물명</th><th style='padding:6px; border:1px solid #ddd; width:70px; color:#333333;'>이슈건수</th></tr>" +
                        structureRows +
                    "</table>" +
                    "<p style='margin-bottom:8px; font-weight:bold;'>🛠️ 공종별 상세 현황</p>" +
                    "<table style='width:100%; border-collapse:collapse; font-size:0.85rem;'>" +
                        "<tr style='background:#f8fafc;'><th style='padding:6px; border:1px solid #ddd; color:#333333;'>공종명</th><th style='padding:6px; border:1px solid #ddd; width:70px; color:#333333;'>이슈건수</th></tr>" +
                        workTypeRows +
                    "</table>";

                    var htmlResponse = "📊 <strong>현재 프로젝트의 [" + issueTypeLabel + "] 분석 결과입니다.</strong><br>" +
                        "- <strong>총 발생 이슈:</strong> " + totalCount + "건<br>" +
                        "- <strong>최다 발생 구조물:</strong> " + mostStruct.key + " (" + mostStruct.count + "건)<br>" +
                        "- <strong>최다 발생 공종:</strong> " + mostWorkType.key + " (" + mostWorkType.count + "건)<br>" +
                        "- <strong>이슈 집중 발생일:</strong> " + mostDate.key + " (" + mostDate.count + "건)" +
                        tableTemplate;

                    hideTyping();
                    if (typeof addBubble === 'function') {
                        addBubble('assistant', htmlResponse);
                    } else if (typeof displayBotMessage === 'function') {
                        displayBotMessage(htmlResponse);
                    }
                } catch (err) {
                    console.error('[Chat-Analyze Error]', err);
                    hideTyping();
                    const errText = `⚠️ 이슈 분석 중 오류 발생: ${err.message}`;
                    if (typeof addBubble === 'function') {
                        addBubble('error', errText, true);
                    } else if (typeof displayBotMessage === 'function') {
                        displayBotMessage(errText);
                    }
                } finally {
                    isLoading = false;
                    setSendEnabled(true);
                }
            }, 800); // 약간의 딜레이로 실시간 분석 느낌을 줍니다.
            return;
        }

        // 🚨 [Batch Auto Issue Creation from Compare Data Interceptor]
        var batchIssueMatch = text.match(/(추가|제거|변경)된\s*(?:아이템|항목|객체|사항)?\s*이슈(?:로|를)?\s*(?:등록|추가|생성|일괄\s*등록|자동\s*등록|작성)/i);
        if (batchIssueMatch && !isSystemGenerated) {
            var targetType = batchIssueMatch[1]; // "추가", "제거", "변경" 중 하나
            
            // Add user bubble and clear input field
            addBubble('user', text);
            chatHistory.push({ role: 'user', content: text });
            elements.chatInput.value = '';
            autoResizeTextarea();

            // 실제 비교 결과 데이터가 들어있는 변수
            var compData = window.comparisonData || window.currentDiffData || (window._issueManager && window._issueManager.comparisonData) || {};
            var targetArray = [];

            if (targetType === "추가") {
                targetArray = compData.added || [];
            } else if (targetType === "제거") {
                targetArray = compData.removed || [];
            } else if (targetType === "변경") {
                targetArray = compData.changed || [];
            }

            if (targetArray.length === 0) {
                var noDataMsg = "⚠️ 현재 모델에 " + targetType + "된 아이템이 없습니다.";
                addBubble('assistant', noDataMsg);
                return;
            }

            // 백그라운드 프로세서 실행
            if (typeof window.processBatchComparisonIssues === 'function') {
                window.processBatchComparisonIssues(targetType, targetArray);
            } else {
                console.error("window.processBatchComparisonIssues function not found");
                var errMessage = "⚠️ 일괄 이슈 등록 프로세서가 준비되지 않았습니다.";
                addBubble('assistant', errMessage);
            }
            return;
        }

        // 🚨 [Direct Auto Issue Creation from Compare Data Interceptor]
        var autoIssueMatch = text.match(/(추가|제거|변경)된\s*(?:아이템|항목|객체|사항)?\s*.*이슈.*(?:추가|등록|작성)/i);
        if (autoIssueMatch && !isSystemGenerated) {
            var targetType = autoIssueMatch[1]; // "추가", "제거", "변경" 중 하나
            
            // Add user bubble and clear input field
            addBubble('user', text);
            chatHistory.push({ role: 'user', content: text });
            elements.chatInput.value = '';
            autoResizeTextarea();

            // 실제 비교 결과 데이터가 들어있는 변수
            var compData = window.comparisonData || window.currentDiffData || (window._issueManager && window._issueManager.comparisonData) || {};
            var targetArray = [];
            var titlePrefix = "";

            if (targetType === "추가") {
                targetArray = compData.added || [];
                titlePrefix = "[버전비교] 추가된 아이템 목록";
            } else if (targetType === "제거") {
                targetArray = compData.removed || [];
                titlePrefix = "[버전비교] 제거된 아이템 목록";
            } else if (targetType === "변경") {
                targetArray = compData.changed || [];
                titlePrefix = "[버전비교] 변경된 아이템 목록";
            }

            if (targetArray.length === 0) {
                var noDataMsg = "⚠️ 현재 모델에 " + targetType + "된 아이템이 없습니다.";
                if (typeof displayBotMessage === 'function') {
                    displayBotMessage(noDataMsg);
                } else if (typeof addBubble === 'function') {
                    addBubble('assistant', noDataMsg);
                }
                return;
            }

            // 이슈 내용(Body) 문자열 조립
            var issueBody = "다음은 " + targetType + "된 항목 리스트입니다.\n\n";
            targetArray.forEach(function(item) {
                var itemName = item.name || item.title || "알 수 없는 객체";
                issueBody += "- " + itemName + "\n";
            });

            // 팝업 띄우기 (기존에 존재하는 UI 오픈 함수 호출)
            if (window._issueManager && typeof window._issueManager.showCreateModal === 'function') {
                window._issueManager.showCreateModal(null, null, null);
            } else {
                var modal = document.getElementById('issue-modal') || document.getElementById('comp-issue-popup');
                if (modal) modal.style.display = 'flex';
            }

            // 실제 폼 ID 찾아서 값 주입
            var titleInput = document.getElementById('issue-title') || document.querySelector('input[name="title"]');
            var contentInput = document.getElementById('issue-desc') || document.getElementById('issue-content') || document.querySelector('textarea[name="content"]');

            if (titleInput) titleInput.value = titlePrefix;
            if (contentInput) contentInput.value = issueBody;

            var successMsg = "✍️ " + targetType + "된 항목 데이터를 모아서 이슈 작성 창을 열었습니다. 내용을 확인하고 저장해주세요.";
            if (typeof displayBotMessage === 'function') {
                displayBotMessage(successMsg);
            } else if (typeof addBubble === 'function') {
                addBubble('assistant', successMsg);
            }
            return;
        }

        // 🚨 [Direct Filtered PDF Export Command Interceptor]
        var filterPdfMatch = text.match(/([가-힣a-zA-Z0-9_]+)\s*(?:이슈만|이슈를|이슈|공종|구조물)?\s*.*pdf.*(?:내보내|뽑아|다운)/i);

        if (filterPdfMatch && !isSystemGenerated) {
            var keyword = filterPdfMatch[1].trim();
            var isVersionCompare = text.includes("버전비교") || text.includes("버전 비교");
            
            // "버전비교", "프로젝트" 등의 단어가 키워드로 잡히면 필터링을 생략하고 전체 출력으로 간주
            var skipFilterWords = ["전체", "총", "모든", "버전비교", "버전", "비교", "프로젝트"];
            var shouldSkipFilter = skipFilterWords.includes(keyword);

            // Add user bubble and clear input field
            addBubble('user', text);
            chatHistory.push({ role: 'user', content: text });
            elements.chatInput.value = '';
            autoResizeTextarea();

            var sourceIssues = isVersionCompare 
                ? (window.comparisonIssues || (window._issueManager && window._issueManager.comparisonIssues) || window.versionIssues || []) 
                : (window.issues || (window._issueManager && window._issueManager.issues) || []);
            
            var filtered = sourceIssues;
            
            // 전체 출력이 아닌 특정 구조물/공종 필터링일 경우에만 실행
            if (!shouldSkipFilter) {
                filtered = sourceIssues.filter(function(issue) {
                    var sName = issue.structureName || issue.structure_name || "";
                    var wType = issue.workType || issue.work_type || "";
                    return sName.includes(keyword) || wType.includes(keyword);
                });
                
                if (filtered.length === 0) {
                    var failMsg = "🔍 '" + keyword + "' 관련 데이터가 없어 PDF를 생성할 수 없습니다.";
                    if (typeof displayBotMessage === 'function') {
                        displayBotMessage(failMsg);
                    } else if (typeof addBubble === 'function') {
                        addBubble('assistant', failMsg);
                    }
                    return;
                }
            }

            var issueTypeLabel = isVersionCompare ? "버전 비교 이슈" : "일반 프로젝트 이슈";
            var msg = shouldSkipFilter 
                ? "📄 전체 [" + issueTypeLabel + "] PDF 보고서 출력을 시작합니다." 
                : "📄 [" + keyword + "] 관련 " + issueTypeLabel + " " + filtered.length + "건을 필터링하여 PDF 보고서 출력을 시작합니다.";
                
            if (typeof displayBotMessage === 'function') {
                displayBotMessage(msg);
            } else if (typeof addBubble === 'function') {
                addBubble('assistant', msg);
            }

            // 🚨 이슈 종류에 따라 각각 알맞은 PDF 내보내기 함수를 분리 호출
            if (isVersionCompare) {
                if (typeof window.exportComparisonIssuesPdf === 'function') {
                    window.exportComparisonIssuesPdf(shouldSkipFilter ? true : filtered);
                }
            } else {
                // 일반 프로젝트 이슈 PDF 생성 함수 (실제 코드의 함수명으로 교체할 것)
                var normalExportFunc = window.exportProjectIssuesPdf || window.exportIssuesPdf || window.exportPdf || null;
                if (typeof normalExportFunc === 'function') {
                    normalExportFunc(shouldSkipFilter ? null : filtered);
                } else {
                    console.error("일반 프로젝트 이슈 PDF 내보내기 함수를 찾을 수 없습니다.");
                }
            }
            return;
        }

        // 🚨 [Direct Version Compare Command Interceptor]
        const compareRegex = /(.+?)\s*파일의\s*v(\d+)\s*(?:과|와|및|,)\s*v(\d+)\s*(?:을|를)?\s*비교해줘/i;
        const compareMatch = text.match(compareRegex);
        if (compareMatch && !isSystemGenerated) {
            const fileName = compareMatch[1].trim();
            const versionA = parseInt(compareMatch[2], 10);
            const versionB = parseInt(compareMatch[3], 10);

            console.log(`🤖 챗봇 명령 인식: [${fileName}]의 v${versionA} vs v${versionB} 비교 실행`);
            
            // Add user bubble and clear input field
            addBubble('user', text);
            chatHistory.push({ role: 'user', content: text });
            elements.chatInput.value = '';
            autoResizeTextarea();

            // Set loading and disable send
            isLoading = true;
            setSendEnabled(false);

            // Add system message
            addBubble('assistant', `요청하신 [${fileName}]의 버전 비교를 시작합니다.`);
            showTyping();

            try {
                // 1. Find file in DOM or API
                let badge = document.querySelector(`span.badge-version[data-item-name*="${fileName}"]`);
                let itemId = badge?.dataset.itemId;
                let itemName = badge?.dataset.itemName;

                const hubId = window.explorer?.currentHubId || localStorage.getItem('aps_last_hub_id');
                const projectId = window.explorer?.currentProjectId || localStorage.getItem('aps_last_project_id');

                if (!itemId && hubId && projectId) {
                    const folderId = window.explorer?.currentFolderId;
                    const url = `/api/hubs/${hubId}/projects/${projectId}/contents${folderId ? `?folder_id=${folderId}` : ''}`;
                    const response = await fetch(url);
                    if (response.ok) {
                        const items = await response.json();
                        const matchedItem = items.find(item => !item.folder && item.name.includes(fileName));
                        if (matchedItem) {
                            itemId = matchedItem.id;
                            itemName = matchedItem.name;
                        }
                    }
                }

                if (!itemId) {
                    throw new Error(`파일 [${fileName}]을 찾을 수 없습니다.`);
                }

                // 2. Fetch version URNs
                const versionsUrl = `/api/hubs/${hubId}/projects/${projectId}/contents/${encodeURIComponent(itemId)}/versions`;
                const vResponse = await fetch(versionsUrl);
                if (!vResponse.ok) throw new Error('버전 목록을 가져오지 못했습니다.');
                const versions = await vResponse.json();

                const versionObjA = versions.find(v => v.vNumber === versionA);
                const versionObjB = versions.find(v => v.vNumber === versionB);

                if (!versionObjA || !versionObjB) {
                    throw new Error(`요청하신 버전(v${versionA} 또는 v${versionB})이 존재하지 않습니다.`);
                }

                const urnA = window.explorer ? window.explorer.decodeUrn(versionObjA.id) : versionObjA.id;
                const urnB = window.explorer ? window.explorer.decodeUrn(versionObjB.id) : versionObjB.id;

                const nameA = window.formatBimModelName ? window.formatBimModelName(itemName, versionA) : `${itemName}_v${versionA}`;
                const nameB = window.formatBimModelName ? window.formatBimModelName(itemName, versionB) : `${itemName}_v${versionB}`;

                // 3. Launch compare viewer
                if (typeof window.compareModels === 'function') {
                    await window.compareModels(urnA, urnB, nameA, nameB);
                    hideTyping();
                    addBubble('assistant', `✅ [${itemName}] 파일의 v${versionA}와 v${versionB} 비교 화면 로드가 완료되었습니다.`);
                } else {
                    throw new Error('compareModels 함수를 찾을 수 없습니다.');
                }
            } catch (err) {
                console.error('[Chat-Compare Error]', err);
                hideTyping();
                addBubble('error', `⚠️ 비교 실행 중 오류 발생: ${err.message}`, true);
            } finally {
                isLoading = false;
                setSendEnabled(true);
            }
            return;
        }

        const now = Date.now();
        if (now - lastCallTime < 1000) {
            callCountInWindow++;
        } else {
            lastCallTime = now;
            callCountInWindow = 1;
        }

        if (callCountInWindow > 3) {
            window.showToast && window.showToast("⚠️ 과도한 자동 호출 방지를 위해 중단되었습니다.", "error");
            return;
        }

        if (text.includes('[SYSTEM_QUERY_AUTO_CONTINUE]')) {
            recursiveCount++;
            if (recursiveCount > 2) {
                recursiveCount = 0;
                hideTyping();
                return;
            }
        } else {
            recursiveCount = 0;
        }

        if (!systemContextData && window.ContextHarness) {
            // [긴급 수정] 폴백 1: window.modelSnapshot으로 직접 주입 시도
            if (window.modelSnapshot) {
                updateSystemContext(window.modelSnapshot);
            } else {
                console.log('[AI-Panel] 필수 컨텍스트 누락. 즉시 추출 시도...');
                const viewer = window._viewer || window.NOP_VIEWER || null;
                // extract 내부에 updateSystemContext 호출이 포함되어 있으므로 실행 후 변수가 채워질 때까지 미세한 대기(Polling)
                window.ContextHarness.extract(viewer);

                // 최대 5초간 데이터 채워짐 대기 (초기 로딩 시 Race Condition 방지 강화)
                let waitCount = 0;
                while (!systemContextData && waitCount < 50) {
                    await new Promise(r => setTimeout(r, 100));
                    waitCount++;
                }
                if (!systemContextData) console.warn('[AI-Panel] 5초 대기 후에도 컨텍스트가 확보되지 않았습니다. 빈 상태로 진행합니다.');
            }
        }

        isLoading = true;
        setSendEnabled(false);

        const isAutoContinue = text.startsWith("[SYSTEM_QUERY_AUTO_CONTINUE]");
        const isAutoUpdate = text.startsWith("[SYSTEM_QUERY_AUTO_CONTINUE_UPDATE]");
        let updateBubbleId = null;
        let actualText = text;

        if (isAutoUpdate) {
            const parts = text.split("|||");
            actualText = parts[0].replace("[SYSTEM_QUERY_AUTO_CONTINUE_UPDATE]", "").trim();
            updateBubbleId = parts[1];
        } else if (!isAutoContinue) {
            addBubble('user', text);
            chatHistory.push({ role: 'user', content: text });
            elements.chatInput.value = '';
            autoResizeTextarea();
        }

        const isIssueQuery = actualText.includes('이슈') || actualText.includes('issue');
        let issuesList = [];
        if (window._issueManager && window._issueManager.issues) {
            issuesList = window._issueManager.issues;
        } else if (window.ContextHarness?.currentData?.issues) {
            issuesList = window.ContextHarness.currentData.issues;
        }
        // 🌟 [Hooking] 현재 프로젝트가 활성화되어 있으면 해당 프로젝트의 이슈만 바인딩
        var chatCurrentPid = window.activeExplorerProjectId || window.currentProjectId || (new URLSearchParams(window.location.search)).get('projectId');
        const chatDbPremium = document.getElementById('dashboard-premium-container');
        const chatDbLegacy = document.getElementById('project-selection-dashboard');
        const isChatDbActive = (chatDbPremium && chatDbPremium.style.display !== 'none' && chatDbPremium.style.display !== '') || 
                               (chatDbLegacy && chatDbLegacy.style.display !== 'none' && chatDbLegacy.style.display !== '');
        if (isChatDbActive) {
            chatCurrentPid = null;
        }
        if (chatCurrentPid) {
            issuesList = issuesList.filter(function(issue) {
                var issuePid = issue.projectId || issue.project_id || issue.folderId;
                if (!issuePid) return false;
                return String(issuePid) === String(chatCurrentPid);
            });
        }
        // 🌟 [Hooking] 실제 이슈 매니저의 데이터를 AI 컨텍스트용 전역 변수에 바인딩
        window.currentIssues = issuesList;

        const isDataNotReady = issuesList.length === 0;

        if (!isAutoContinue && !isAutoUpdate && isIssueQuery && isDataNotReady) {
            const loadingBubbleId = 'issue-wait-' + Date.now();
            const bubble = addBubble('assistant', '데이터를 분석 중입니다... ⏳');
            if (bubble) bubble.id = loadingBubbleId;

            setTimeout(() => {
                isLoading = false;
                sendMessage("[SYSTEM_QUERY_AUTO_CONTINUE_UPDATE] " + actualText + "|||" + loadingBubbleId);
            }, 1500);
            return;
        }

        // ═══════════════════════════════════════════════════════════════
        // [🔧 Direct Command Interceptor] 핵심 수정
        // "벽체 선택해줘" 같은 단순 3D 제어 명령은 LLM을 거치지 않고
        // 프론트엔드에서 직접 파싱하여 즉시 뷰어 명령을 실행합니다.
        // LLM이 장문의 분석을 출력하는 현상을 원천 차단합니다.
        // ═══════════════════════════════════════════════════════════════
        if (!isAutoContinue && !isAutoUpdate) {
            const directResult = await tryDirectViewerCommand(actualText);
            if (directResult.intercepted) {
                if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);
                isLoading = false;
                setSendEnabled(!!elements.chatInput.value.trim());
                return;
            }
        }

        showTyping();

        try {
            // [DEPRECATED] issueContext calculation removed for Action Tag Bypass Architecture


            // [New] 객체 개수 통계 데이터 및 할루시네이션 방지 가드레일 추가
            function getModelStatsContext() {
                if (!window.categoryInstancesMap) return "[현재 모델 객체 통계 요약] 현재 모델의 객체 정보가 로드되지 않았습니다.";
                const stats = [];
                for (const [category, ids] of Object.entries(window.categoryInstancesMap)) {
                    stats.push(`${category}: ${ids.length}개`);
                }
                if (stats.length === 0) return "[현재 모델 객체 통계 요약] 추출된 객체 카테고리가 없습니다.";
                return `[현재 모델 객체 통계 요약] ${stats.join(', ')}`;
            }
            const modelStatsContext = getModelStatsContext();
            const modelStatsRule = `\n[CRITICAL RULE]: 사용자가 특정 객체나 부재(예: 창문, 문, 기둥 등)의 "개수"를 물어볼 경우, 반드시 내가 제공한 '[현재 모델 객체 통계 요약]' 데이터를 확인하고 그곳에 적힌 정확한 숫자만 대답하세요. 통계 요약에 없는 카테고리라면 "해당 객체의 정보를 찾을 수 없습니다"라고 대답하고, 절대로 임의의 숫자를 지어내지 마세요.`;

            // [New] 재료(Material) 속성 통계 데이터 및 가드레일 추가
            function getMaterialStatsContext() {
                if (!window.materialInstancesMap) return "[재료 통계] 현재 모델의 재료 정보가 추출되지 않았습니다.";
                
                const stats = [];
                for (const [matName, catMap] of Object.entries(window.materialInstancesMap)) {
                    const catStats = [];
                    for (const [cat, ids] of Object.entries(catMap)) {
                        catStats.push(`${cat} ${ids.length}개`);
                    }
                    stats.push(`${matName}: ${catStats.join(', ')}`);
                }
                
                if (stats.length === 0) return "[재료 통계] 매핑된 재료 속성이 없습니다.";
                return `[재료 통계] ${stats.join(' | ')}`;
            }
            const materialStatsContext = getMaterialStatsContext();
            let materialStatsRule = `\n[CRITICAL RULE]: 사용자가 특정 "재료(Material)"를 가진 객체가 무엇인지 묻는다면, 반드시 주입된 '[재료 통계]' 데이터를 확인하여 대답하세요. 대답할 때는 반드시 "현재 재료가 [요청한 재료명]인 객체는 [카테고리명] O개, [카테고리명] O개... 입니다. 해당 객체를 선택해 드릴까요?" 라는 형식으로 친절하게 대답하고, 질문으로 답변을 마무리하세요. 없는 재료라면 없다고 명확히 대답하세요.`;
            materialStatsRule += `\n[ACTION RULE]: 사용자가 특정 "재료"를 가진 객체를 찾아달라고 한 뒤, "선택해 줘/네/응" 등으로 선택을 동의할 경우, 개별 카테고리 액션을 여러 번 쓰지 말고 반드시 단일 태그로 [ACTION:SELECT_MATERIAL, MATERIAL:재료명] 을 출력하세요. (예: [ACTION:SELECT_MATERIAL, MATERIAL:KH_Con'c_철근_25-30-15])`;

            // [New] 수량 산출(길이/체적) 통계 데이터 및 가드레일 추가
            function getQuantityStatsContext() {
                if (!window.quantityStatsMap) return "[수량 산출 통계] 수치 데이터가 추출되지 않았습니다.";
                
                const catArr = [];
                for (const [cat, data] of Object.entries(window.quantityStatsMap.categories)) {
                    const totalLen = data.length ?? data.totalLength ?? 0;
                    const totalVol = data.volume ?? 0;
                    if (totalLen > 0 || totalVol > 0) {
                        catArr.push(`${cat}(총길이:${totalLen.toFixed(2)}mm/체적:${totalVol.toFixed(2)})`);
                    }
                }
                if (catArr.length === 0) return "[수량 산출 통계] 수치 데이터가 없습니다.";
                return "[수량 산출 통계] " + catArr.join(", ");
            }


            var quantityStatsRule = `수량 데이터에 있는 카테고리와 수치만 사용하여 정확하게 대답하라. 데이터에 없는 카테고리라면 알 수 없다고 대답하세요.`;

            // [New] 버전 비교 Action Tag Rule (Gemma/Local LLM용)
            var versionCompareRule = `\n[CRITICAL RULE]: 사용자가 특정 파일의 버전을 비교해달라고 요청하면, 어떠한 부연 설명도 하지 말고 오직 다음 포맷의 태그만 정확히 출력하세요: <<ACTION_COMPARE::파일명::기준버전::비교버전>>. (예시: <<ACTION_COMPARE::강북_구조물_신설_04_급속여과지_M::v3::v10>>)`;
            var ladderStatsRule = `\n[사다리 분석 규칙]: 사용자가 사다리 개수나 길이를 물어보면, 반드시 주입된 '[사다리 통계]' 데이터를 확인하고 그곳에 적힌 정확한 수량과 유형 정보를 바탕으로 대답하세요. 절대로 임의의 숫자를 지어내지 마세요.`;

            // 🛡️ 통합 동적 컨텍스트 빌더 (데이터 누락 방지)
            function buildDynamicSystemPrompt() {
                const now = new Date();
                const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
                
                let dynamicContext = "\n\n--- [도메인별 데이터 브리핑] ---\n";

                const dateReportRule = `
[이슈 필터링 및 보고서 규칙]
1. 시스템의 오늘 날짜는 [${todayStr}] 입니다.
2. 사용자가 날짜를 언급하며 이슈를 물어보면, 3D 모델 데이터가 아니라 반드시 <ISSUE_DATA> 태그 안의 텍스트만 검색하세요.
3. <ISSUE_DATA>의 [날짜: YYYY-MM-DD] 속성과 사용자가 묻는 날짜를 일치시켜 필터링하세요.
4. 일치하는 데이터가 없다면 절대 "모델 데이터에 없다"고 하지 말고, "현재 등록된 이슈 목록(Issue Data)에는 해당 날짜에 작성된 이슈가 없습니다"라고 정확하게 답변하세요.
`;
                dynamicContext += dateReportRule;

                // 🌟 [ISSUE_DATA] 백엔드에서 JSON으로 처리하도록 텍스트 주입부 제거 (이슈 배열만 따로 전송)
                dynamicContext += `\n<ISSUE_DATA_CONTEXT_INJECTED_VIA_JSON />\n`;

                // 🌟 [MODEL_DATA: 3D 모델 통계 및 분석 결과]
                let modelDataText = "";

                // 사다리 데이터
                const ladders = window.quantityStatsMap && window.quantityStatsMap.ladders;
                if (ladders && ladders.totalCount > 0) {
                    modelDataText += `[사다리 통계] 총 수량: ${ladders.totalCount}개 (${ladders.totalLength.toFixed(0)}mm)\n`;
                    for (const [modelName, data] of Object.entries(ladders.models)) {
                        modelDataText += `- 유형: [${modelName}], 수량: ${data.count}개, 길이: ${data.length.toFixed(0)}mm\n`;
                    }
                }

                // 콘크리트 데이터
                const conc = window.quantityStatsMap && window.quantityStatsMap.concrete;
                if (conc && conc.totalCount > 0) {
                    modelDataText += `[콘크리트 통계] 총 ${conc.totalCount}개 부재 (총 체적: ${conc.totalVolume.toFixed(2)}㎥) | 세부 재질별 - `;
                    modelDataText += Object.entries(conc.materials)
                        .map(([m, d]) => `[${m}] ${d.count}개 (${d.volume.toFixed(2)}㎥)`)
                        .join(', ') + "\n";
                }

                // 버전 비교 결과
                const compareStats = window.latestCompareStats;
                if (compareStats && compareStats.totalPositionChanged !== undefined) {
                    modelDataText += `[버전 비교 결과] 위치(기하학)가 변경된 객체는 총 ${compareStats.totalPositionChanged}개입니다.\n`;
                }

                // 재료 통계
                if (window.materialInstancesMap) {
                    const matEntries = Object.entries(window.materialInstancesMap);
                    if (matEntries.length > 0) {
                        modelDataText += `[재료 통계] `;
                        modelDataText += matEntries.map(([mat, catMap]) => {
                            const catStr = Object.entries(catMap).map(([cat, ids]) => `${cat} ${ids.length}개`).join(', ');
                            return `${mat}: ${catStr}`;
                        }).join(' | ') + "\n";
                    }
                }

                // 수량 산출(일반) 통계
                if (window.quantityStatsMap && window.quantityStatsMap.categories) {
                    const catArr = [];
                    for (const [cat, data] of Object.entries(window.quantityStatsMap.categories)) {
                        const totalLen = data.length ?? data.totalLength ?? 0;
                        const totalVol = data.volume ?? 0;
                        if (totalLen > 0 || totalVol > 0) {
                            let catStr = `${cat}(총길이:${totalLen.toFixed(2)}mm/체적:${totalVol.toFixed(2)})`;
                            if (data.types && Object.keys(data.types).length > 0) {
                                const typeDetails = Object.entries(data.types)
                                    .map(([tn, td]) => {
                                        const len = (typeof td === 'number') ? td : (td.length ?? 0);
                                        return `${tn}:${len.toFixed(2)}mm`;
                                    }).join(', ');
                                catStr += ` [세부유형: ${typeDetails}]`;
                            }
                            catArr.push(catStr);
                        }
                    }
                    if (catArr.length > 0) {
                        modelDataText += `[수량 산출 통계] ${catArr.join(', ')}\n`;
                    }
                }

                dynamicContext += `\n<MODEL_DATA>\n${modelDataText || "모델 메타데이터 없음"}\n</MODEL_DATA>\n`;
                
                // 가드레일 추가
                dynamicContext += `\n${ladderStatsRule}`;
                dynamicContext += `\n${materialStatsRule}`;
                dynamicContext += `\n${quantityStatsRule}`;
                dynamicContext += "\n-----------------------------------\n";

                return dynamicContext;
            }

            var today = new Date();
            var currentDateString = today.getFullYear() + "-" + 
                                    String(today.getMonth() + 1).padStart(2, '0') + "-" + 
                                    String(today.getDate()).padStart(2, '0');
            var dateContext = "현재 시스템 날짜는 " + currentDateString + " 입니다. '오늘', '어제' 등의 기준은 이 날짜를 따르세요. 사용자가 날짜(예: '2026.05.27', '오늘')를 조건으로 물어보면 제공된 이슈 데이터의 'createdDate' 필드를 확인하여 일치하는 이슈만 필터링하여 답변하세요. 날짜 구분자(-, .)는 유연하게 해석하세요.";

            var strictSystemContext = 
                "당신은 프로젝트 이슈 분석 보조입니다. " +
                "반드시 아래 제공된 '현재 패널에 보이는 이슈 목록' 데이터 내에서만 답변을 생성하세요. " +
                "데이터에 없는 내용을 절대 지어내거나 추론하지 마세요. " +
                "사용자가 날짜를 물어보면 'createdDate' 텍스트와 비교하여 일치하는 항목만 정확히 반환하세요.";

            var panelIssues = [];
            var issueCards = document.querySelectorAll('#issue-list-container .issue-item, .issue-list-container .issue-item, #diff-issue-list tr[data-id]');

            for (var i = 0; i < issueCards.length; i++) {
                var card = issueCards[i];
                var titleEl = card.querySelector('.issue-item-title, .col-title');
                var dataId = parseInt(card.getAttribute('data-id'));
                
                if (titleEl && !isNaN(dataId)) {
                    var issueObj = null;
                    if (window._issueManager && window._issueManager.issues) {
                        issueObj = window._issueManager.issues.find(function(item) {
                            return item.id === dataId;
                        });
                    }
                    if (!issueObj && window.comparisonIssues) {
                        issueObj = window.comparisonIssues.find(function(item) {
                            return item.id === dataId;
                        });
                    }
                    
                    var rawDate = (issueObj && (issueObj.createdAt || issueObj.created_at || issueObj.date)) || "";
                    if (!rawDate && dataId > 1000000000000) {
                        try {
                            rawDate = new Date(dataId).toISOString();
                        } catch (e) {}
                    }
                    
                    var formattedDate = "";
                    if (rawDate) {
                        try {
                            formattedDate = new Date(rawDate).toISOString().split('T')[0];
                        } catch(e) {
                            formattedDate = String(rawDate).substring(0, 10);
                        }
                    }
                    if (!formattedDate) {
                        formattedDate = "날짜 없음";
                    }

                    var statusEl = card.querySelector('.issue-status, .status-badge, .state-label, .issue-status-badge');
                    var statusText = (statusEl ? statusEl.innerText.trim() : "") || (issueObj ? issueObj.status : "");
                    var assigneeText = issueObj ? (issueObj.assignee || issueObj.author || "") : "";

                    panelIssues.push({
                        title: titleEl.innerText.trim(),
                        status: statusText,
                        author: assigneeText,
                        createdDate: formattedDate
                    });
                }
            }

            var statusRule = "사용자가 '오픈된', '해결된', 'closed' 등 이슈의 상태를 물어보면, 제공된 데이터의 'status' 필드를 기준으로 검색하세요. JSON 명령어를 생성할 때 parameters 객체 안에 'status' 키를 반드시 포함하세요.";

            var outputFormatRule =
                "[CRITICAL OUTPUT RULE: " +
                "당신은 최종 사용자에게 직접 대답하는 친절한 어시스턴트입니다. " +
                "어떤 상황에서도 \"action\", \"parameters\", \"ISSUE_QUERY\" 같은 JSON 형식 응답을 절대 출력하지 마세요. " +
                "이슈 분석 태그가 필요할 때는 <<ACTION_ANALYZE_ISSUES>> 또는 <<ACTION_FILTER::DATE::YYYY-MM-DD>> 형식의 태그만 정확히 출력하세요. " +
                "그 외의 일반 답변은 반드시 자연스러운 한국어 문장으로만 작성하세요.]";

            const fullSystemContext = [
                systemContextData,
                modelStatsContext + modelStatsRule,
                versionCompareRule,
                buildDynamicSystemPrompt(),
                modelContext ? ('\uc0ac\uc6a9\uc790\uac00 \ud604\uc7ac \uc120\ud0dd \uc911\uc778 \uac1d\uccb4: ' + JSON.stringify(modelContext)) : null,
                dateContext,
                strictSystemContext,
                statusRule,
                outputFormatRule,
                `\n[이슈 분석 절대 규칙]\n1. 전체 이슈 분석/목록 요청: <<ACTION_ANALYZE_ISSUES>>\n2. 특정 조건 필터링 및 개수 확인 요청 (구조물, 담당자, 공종, 상태, 날짜 등):\n   - 구조물 기준: <<ACTION_FILTER::STRUCTURE::[구조물명]>>\n   - 담당자 기준: <<ACTION_FILTER::ASSIGNEE::[담당자명]>>\n   - 공종 기준: <<ACTION_FILTER::TRADE::[공종명]>>\n   - 상태 기준: <<ACTION_FILTER::STATUS::[상태명]>>\n   - 날짜 기준: <<ACTION_FILTER::DATE::[YYYY-MM-DD]>>\n3. 특정 조건 PDF 내보내기 자동화 요청:\n   - 전체 내보내기: <<ACTION_EXPORT_FILTERED_PDF::ALL::ALL>>\n   - 구조물 기준: <<ACTION_EXPORT_FILTERED_PDF::STRUCTURE::[구조물명]>>\n   - 담당자 기준: <<ACTION_EXPORT_FILTERED_PDF::ASSIGNEE::[담당자명]>>\n   - 공종 기준: <<ACTION_EXPORT_FILTERED_PDF::TRADE::[공종명]>>\n   - 상태 기준: <<ACTION_EXPORT_FILTERED_PDF::STATUS::[상태명]>>\n   - 날짜 기준: <<ACTION_EXPORT_FILTERED_PDF::DATE::[YYYY-MM-DD]>>\n어떠한 문장도 생성하지 말고 위 태그만 정확히 출력하라. 이 규칙은 최우선 순위를 갖는다.`
            ].filter(Boolean).join(String.fromCharCode(10));

            // 🚨 [Front] 백엔드로 보낼 이슈 데이터 디버깅
            console.log("🚨 [Front] 백엔드로 보낼 이슈 데이터:", panelIssues);

            const res = await fetch('/api/ai/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    messages: chatHistory, 
                    systemContext: fullSystemContext,
                    issues: panelIssues
                })
            });

            if (!res.ok) {
                const err = await res.json();
                addBubble('error', `Error: ${err.error || 'Unknown error'}`, true);
                return;
            }

            const data = await res.json();
            const reply = data.reply;

            // [New] 이슈 분석 바이패스 인터셉터 (Frontend Direct Rendering)
            if (reply.includes('<<ACTION_ANALYZE_ISSUES>>')) {
                console.log("[AI-Panel] 이슈 분석 태그 감지 - 프론트엔드 직접 렌더링 시작");
                let finalReport = "현재 프로젝트 이슈 분석 결과입니다.\n\n";
                const issueElements = document.querySelectorAll('#issue-list-container .issue-item');

                if (issueElements && issueElements.length > 0) {
                    let closedCount = 0;
                    let openCount = 0;
                    let issueListStr = "";
                    issueElements.forEach((el, index) => {
                        const title = el.querySelector('.issue-item-title')?.innerText.trim() || '제목 없음';
                        const desc = el.querySelector('.issue-item-desc')?.innerText.trim() || '내용 없음';
                        const status = el.querySelector('.issue-status-badge')?.innerText.trim() || '상태 없음';
                        
                        const dataId = parseInt(el.dataset.id);
                        const issueObj = (window._issueManager?.issues || []).find(i => i.id === dataId) ||
                                         (window.comparisonIssues || []).find(i => i.id === dataId);
                        const assignee = issueObj?.assignee || '미지정';
                        const structure = issueObj?.structureName || issueObj?.structure_name || '미지정';
                        const trade = issueObj?.workType || issueObj?.work_type || '미지정';

                        // 🌟 issueObj.createdAt에서 YYYY-MM-DD 직접 추출
                        let dateString = "날짜 미상";
                        try {
                            var rawDateVal = (issueObj && (issueObj.createdAt || issueObj.created_at || issueObj.date)) || "";
                            if (!rawDateVal && dataId > 1000000000000) {
                                rawDateVal = new Date(dataId).toISOString();
                            }
                            if (rawDateVal) {
                                dateString = new Date(rawDateVal).toISOString().split('T')[0];
                            }
                        } catch (e) {
                            console.warn("[AI-Panel] 이슈 날짜 추출 실패, 기본값 사용");
                        }
                        
                        if (status.includes('Closed') || status.includes('완료')) closedCount++; else openCount++;
                        issueListStr += `${index + 1}. ${title} (${dateString})\n  * 위치 및 공종: ${structure} / ${trade}\n  * 담당자: ${assignee} (현재 상태: ${status})\n  * 내용: ${desc}\n\n`;
                    });
                    finalReport += `총 ${issueElements.length}건의 이슈가 확인되었습니다.\n\n📊 상태별 요약\n* 해결 완료: ${closedCount}건\n* 진행/대기 중: ${openCount}건\n\n📋 상세 이슈 목록\n${issueListStr}`;
                } else {
                    finalReport = "현재 화면에 등록된 프로젝트 이슈가 없습니다.";
                }
                hideTyping(); addBubble('assistant', finalReport); chatHistory.push({ role: 'assistant', content: finalReport });
                isLoading = false; setSendEnabled(true); return;
            }

            // [New] 통합 이슈 필터링 바이패스 인터셉터 (구조물, 담당자, 공종, 상태)
            const filterMatch = reply.match(/<<ACTION_FILTER::(.*?)::(.*?)>>/i);
            if (filterMatch) {
                const filterType = filterMatch[1].toUpperCase();
                const filterValue = filterMatch[2].trim();
                console.log(`[AI-Panel] 이슈 필터링 감지 - 유형: ${filterType}, 값: ${filterValue}`);
                
                const typeLabels = { STRUCTURE: '구조물', ASSIGNEE: '담당자', TRADE: '공종', STATUS: '상태', DATE: '날짜' };
                const label = typeLabels[filterType] || filterType;

                var matchedIssues = [];
                const issueElements = document.querySelectorAll('#issue-list-container .issue-item');

                if (issueElements && issueElements.length > 0) {
                    issueElements.forEach(function(el) {
                        var dataId = parseInt(el.dataset.id);
                        var issueObj = (window._issueManager?.issues || []).find(function(i) { return i.id === dataId; }) ||
                                       (window.comparisonIssues || []).find(function(i) { return i.id === dataId; });
                        if (!issueObj) return;

                        var isMatch = false;
                        var statusText = el.querySelector('.issue-status-badge')?.innerText.trim() || '';

                        if (filterType === 'STRUCTURE') {
                            var val = issueObj.structureName || issueObj.structure_name || '';
                            isMatch = val.includes(filterValue);
                        } else if (filterType === 'ASSIGNEE') {
                            var val = issueObj.assignee || '';
                            isMatch = val.includes(filterValue);
                        } else if (filterType === 'TRADE') {
                            var val = issueObj.workType || issueObj.work_type || '';
                            isMatch = val.includes(filterValue);
                        } else if (filterType === 'STATUS') {
                            var val = issueObj.status || statusText || '';
                            isMatch = val.toLowerCase().includes(filterValue.toLowerCase());
                        } else if (filterType === 'DATE') {
                            var rawDateStr = issueObj.createdAt || issueObj.created_at || issueObj.date || "";
                            if (!rawDateStr && dataId > 1000000000000) {
                                try { rawDateStr = new Date(dataId).toISOString(); } catch(e) {}
                            }
                            var normalizedIssueDate = "";
                            try {
                                if (rawDateStr) normalizedIssueDate = new Date(rawDateStr).toISOString().split('T')[0];
                            } catch(e) {
                                normalizedIssueDate = String(rawDateStr).substring(0, 10);
                            }
                            var normalizedFilterValue = filterValue.replace(/\./g, '-').trim();
                            isMatch = normalizedIssueDate === normalizedFilterValue || normalizedIssueDate.startsWith(normalizedFilterValue);
                        }

                        if (isMatch) {
                            matchedIssues.push({
                                title: el.querySelector('.issue-item-title')?.innerText.trim() || '제목 없음',
                                status: issueObj.status || statusText || '미지정',
                                structure: issueObj.structureName || issueObj.structure_name || '미지정',
                                trade: issueObj.workType || issueObj.work_type || '미지정',
                                assignee: issueObj.assignee || '미지정'
                            });
                        }
                    });
                }

                let finalReport;
                if (matchedIssues.length > 0) {
                    // 구조물별 집계
                    var structMap = {};
                    var tradeMap = {};
                    var statusMap = {};
                    matchedIssues.forEach(function(issue) {
                        structMap[issue.structure] = (structMap[issue.structure] || 0) + 1;
                        tradeMap[issue.trade] = (tradeMap[issue.trade] || 0) + 1;
                        statusMap[issue.status] = (statusMap[issue.status] || 0) + 1;
                    });

                    var structSummary = Object.entries(structMap).sort(function(a, b) { return b[1] - a[1]; })
                        .map(function(e) { return e[0] + ' ' + e[1] + '건'; }).join(', ');
                    var tradeSummary = Object.entries(tradeMap).sort(function(a, b) { return b[1] - a[1]; })
                        .map(function(e) { return e[0] + ' ' + e[1] + '건'; }).join(', ');
                    var statusSummary = Object.entries(statusMap).sort(function(a, b) { return b[1] - a[1]; })
                        .map(function(e) { return e[0] + ' ' + e[1] + '건'; }).join(', ');

                    var issueTitles = matchedIssues.map(function(issue, idx) {
                        return (idx + 1) + '. ' + issue.title + ' (' + issue.status + ')';
                    }).join('\n');

                    finalReport = '[' + label + ': ' + filterValue + '] 총 ' + matchedIssues.length + '건의 이슈가 있습니다.\n\n' +
                        '📍 구조물별: ' + structSummary + '\n' +
                        '🔧 공종별: ' + tradeSummary + '\n' +
                        '📋 상태별: ' + statusSummary + '\n\n' +
                        '📌 이슈 목록:\n' + issueTitles;
                } else {
                    finalReport = '[' + label + ': ' + filterValue + '] 해당 조건에 맞는 이슈가 없습니다.';
                }

                hideTyping(); addBubble('assistant', finalReport); chatHistory.push({ role: 'assistant', content: finalReport });
                isLoading = false; setSendEnabled(true); return;
            }

            // [New] 이슈 PDF 내보내기 자동화 인터셉터
            const pdfMatch = reply.match(/<<ACTION_EXPORT_FILTERED_PDF::(.*?)::(.*?)>>/i);
            if (pdfMatch) {
                const pdfType = pdfMatch[1].toUpperCase();
                const pdfValue = pdfMatch[2].trim();
                console.log(`[AI-Panel] PDF 내보내기 자동화 감지 - 유형: ${pdfType}, 값: ${pdfValue}`);
                
                const typeLabels = { ALL: '전체', STRUCTURE: '구조물', ASSIGNEE: '담당자', TRADE: '공종', STATUS: '상태', DATE: '날짜' };
                const label = typeLabels[pdfType] || pdfType;

                // 1. 모든 체크박스 해제
                document.querySelectorAll('.issue-check').forEach(chk => chk.checked = false);

                const issueElements = document.querySelectorAll('#issue-list-container .issue-item');
                let matchCount = 0;

                if (pdfType === 'ALL') {
                    issueElements.forEach(el => { el.querySelector('.issue-check').checked = true; matchCount++; });
                } else {
                    issueElements.forEach((el) => {
                        const dataId = parseInt(el.dataset.id);
                        const issueObj = (window._issueManager?.issues || []).find(i => i.id === dataId);
                        if (!issueObj) return;

                        let isMatch = false;
                        if (pdfType === 'STRUCTURE') isMatch = (issueObj.structureName || issueObj.structure_name || '').includes(pdfValue);
                        else if (pdfType === 'ASSIGNEE') isMatch = (issueObj.assignee || '').includes(pdfValue);
                        else if (pdfType === 'TRADE') isMatch = (issueObj.workType || issueObj.work_type || '').includes(pdfValue);
                        else if (pdfType === 'STATUS') isMatch = (issueObj.status || '').toLowerCase().includes(pdfValue.toLowerCase());
                        else if (pdfType === 'DATE') isMatch = (issueObj.createdAt || '').includes(pdfValue);

                        if (isMatch) {
                            const chk = el.querySelector('.issue-check');
                            if (chk) { chk.checked = true; matchCount++; }
                        }
                    });
                }

                if (matchCount > 0) {
                    const bulkBtn = document.getElementById('bulk-pdf-btn');
                    if (bulkBtn) {
                        // 🌟 체크박스 상태 변경을 issue-manager에게 알리기 위해 수동 이벤트 발생
                        if (window._issueManager && window._issueManager._updateBulkBtnLabel) window._issueManager._updateBulkBtnLabel();
                        
                        bulkBtn.click(); // 모달 오픈

                        // 🌟 2단계: 모달 내 '내보내기 실행' 버튼 자동 클릭 (Full Automation)
                        setTimeout(() => {
                            const runBtn = document.getElementById('run-pdf-export-btn');
                            if (runBtn) {
                                runBtn.click();
                                const successMsg = `✅ [${label}: ${pdfValue}] 조건에 해당하는 ${matchCount}건의 이슈에 대해 PDF 내보내기를 시작했습니다. 잠시만 기다려 주세요.`;
                                addBubble('assistant', successMsg);
                                chatHistory.push({ role: 'assistant', content: successMsg });
                            }
                        }, 300); // 모달 애니메이션/데이터 바인딩 대기
                    }
                } else {
                    const failMsg = `⚠️ [${label}: ${pdfValue}] 조건에 맞는 이슈가 없어 PDF를 내보낼 수 없습니다.`;
                    addBubble('assistant', failMsg);
                    chatHistory.push({ role: 'assistant', content: failMsg });
                }

                hideTyping(); isLoading = false; setSendEnabled(true); return;
            }

            // [New] 버전 비교 태그 인터셉터 (Gemma 로컬용 - UI Automation)
            const compareMatch = reply.match(/<<ACTION_COMPARE::(.*?)::(.*?)::(.*?)>>/i);
            if (compareMatch) {
                const fileName = compareMatch[1].trim();
                const baseVersion = compareMatch[2].trim();
                const targetVersion = compareMatch[3].trim();

                const loadingId = 'compare-wait-' + Date.now();
                const bubble = addBubble('assistant', `버전 비교 자동화를 시작합니다... ⏳`);
                if (bubble) bubble.id = loadingId;

                hideTyping();

                // 🌟 1. 비동기 순차 클릭(Async UI Automation) 로직 구현
                async function simulateCompareClicks(fName, vA, vB) {
                    // 파일명으로 배지(v11 등) 찾아서 클릭
                    const badge = document.querySelector(`span.badge-version[data-item-name*="${fName}"]`);
                    if (!badge) return console.error('[UI-Auto] 해당 파일의 배지를 찾을 수 없습니다.');
                    badge.click();

                    // 화면 전환/렌더링 대기
                    await new Promise(resolve => setTimeout(resolve, 500));

                    // 비교 모드 토글 버튼 클릭
                    const toggleBtn = document.getElementById('toggle-compare-mode');
                    if (toggleBtn) toggleBtn.click();

                    await new Promise(resolve => setTimeout(resolve, 500));

                    // 추출한 버전 번호로 비교 버튼 두 개 클릭 ("v3" -> "3")
                    const vNumA = vA.replace(/[^0-9]/g, '');
                    const vNumB = vB.replace(/[^0-9]/g, '');

                    const btnA = document.getElementById(`btn-view-${vNumA}`);
                    const btnB = document.getElementById(`btn-view-${vNumB}`);

                    if (btnA) btnA.click();
                    if (btnB) btnB.click();

                    // 버튼 클릭 완료 후 약간 대기
                    await new Promise(resolve => setTimeout(resolve, 500));

                    // 🌟 핵심: 멍때리고 있는 UI 슬롯을 찾아 텍스트 강제 주입!
                    const slotA = document.getElementById('slot-a-name');
                    const slotB = document.getElementById('slot-b-name');

                    // 🌟 전역 헬퍼 함수를 사용하여 명명 규칙(구조물명_공종_버전)에 맞게 변환
                    const displayA = window.formatBimModelName ? window.formatBimModelName(fName, vA) : `${fName}_v${vA}`;
                    const displayB = window.formatBimModelName ? window.formatBimModelName(fName, vB) : `${fName}_v${vB}`;

                    // 🌟 3. UI 슬롯에 강제 덮어쓰기
                    if (slotA) {
                        slotA.innerText = displayA;
                        slotA.style.color = "#fff"; 
                        slotA.title = fName; // 마우스를 올렸을 때 전체 파일명이 툴팁으로 보이도록 추가 (UX 개선)
                    }
                    if (slotB) {
                        slotB.innerText = displayB;
                        slotB.style.color = "#fff";
                        slotB.title = fName; 
                    }

                    console.log('[DEBUG-UI] 축약된 파일명으로 텍스트 동기화 완료');
                }

                // 🌟 전역 함수 등록: 기존 비교 완료 이벤트 후킹을 위함
                window.sendHiddenMessageToGemma = (hiddenPrompt) => {
                    sendMessage("[SYSTEM_QUERY_AUTO_CONTINUE_UPDATE] " + hiddenPrompt + "|||" + loadingId);
                };

                // 🌟 2. 무한 대기 금지: 호출 즉시 실행(Fire and Forget)
                simulateCompareClicks(fileName, baseVersion, targetVersion);

                return; // 태그가 발견되었으므로 기존 텍스트 출력은 여기서 중단
            }

            // Action Interceptor (COMMAND/TAG & JSON)
            let displayReply = reply;
            let feedbackContent = "";
            let executionSuccess = false;

            // [Fix] 특정 구조물 PDF 내보내기 강제 가로채기 (최우선 순위)
            const pdfActionMatch = reply.match(/\[(?:ACTION|COMMAND):EXPORT_PDF,\s*STRUCTURE:(.+?)\]/i);
            if (pdfActionMatch) {
                const targetStructure = pdfActionMatch[1].trim();
                executeFilteredPdfExport(targetStructure);
                const msg = `✅ '${targetStructure}' 관련 이슈들을 PDF로 내보냅니다.`;
                addBubble('assistant', msg);
                chatHistory.push({ role: 'assistant', content: msg });
                hideTyping();
                return; // 여기서 실행 종료
            }

            // [New] 특정 재료 기반 일괄 선택 강제 가로채기
            const materialSelectMatch = reply.match(/\[(?:ACTION|COMMAND):SELECT_MATERIAL,\s*MATERIAL:(.+?)\]/i);
            if (materialSelectMatch) {
                const materialName = materialSelectMatch[1].trim();
                executeMaterialSelection(materialName);
                const msg = `✅ '${materialName}' 재료를 가진 모든 객체를 선택합니다.`;
                addBubble('assistant', msg);
                chatHistory.push({ role: 'assistant', content: msg });
                hideTyping();
                return; // 여기서 실행 종료
            }

            const handleChatCommands = (text) => {
                const actions = [];
                let workingText = text;

                const patterns = [
                    // 1. [ACTION:THEME, TARGET:벽, COLOR:red]
                    { reg: /\[(?:COMMAND|ACTION)\s*:\s*THEME\s*,\s*TARGET\s*:\s*([^,\]]+)\s*,\s*COLOR\s*:\s*([^\]]+)\]/gi, type: 'theme' },
                    // 2. [ACTION:RESET_VIEWER]
                    { reg: /\[(?:COMMAND|ACTION)\s*:\s*(RESET_VIEWER)\]/gi, type: 'reset' },
                    // 3. Standard [ACTION:SELECT, TARGET:벽]
                    { reg: /\[(?:COMMAND|ACTION)\s*:\s*([^,\]]+)\s*,\s*TARGET\s*:\s*([^\]]+)\]/gi, type: 'standard' },
                    // 4. [COMMAND] SELECT 포맷
                    { reg: /\[(?:COMMAND|ACTION)\]\s*(SELECT|HIDE|ISOLATE|HIGHLIGHT|FOCUS|FLYTO|COUNT|EXPORT_ISSUES_PDF)\s*(?:["']*)([^"'\*\[\]\n\r]+)(?:["']*\**)*/gi, type: 'standard' },
                    // 5. [SELECT:대상]
                    { reg: /\[(SELECT|HIDE|ISOLATE|HIGHLIGHT|SHOWALL|FOCUS|FLYTO|COUNT|EXPORT_ISSUES_PDF)\s*:\s*([^\]]+)\]/gi, type: 'standard' },
                    // 6. ACTION: SELECT, TARGET: 대상
                    { reg: /ACTION\s*:\s*([^,]+)\s*,\s*TARGET\s*:\s*([^\]\n]+)/gi, type: 'standard' }
                ];

                for (const p of patterns) {
                    const matches = [...workingText.matchAll(p.reg)];
                    for (const match of matches) {
                        if (p.type === 'reset') {
                            actions.push({ action: 'reset_viewer', target: null });
                        } else if (p.type === 'theme') {
                            actions.push({
                                action: 'theme',
                                target: match[1].trim().replace(/^"|"$/g, ''),
                                params: { color: (match[2] || '').trim().replace(/^"|"$/g, '') }
                            });
                        } else {
                            actions.push({
                                action: match[1].trim().replace(/^"|"$/g, ''),
                                target: (match[2] ? match[2].trim().replace(/^"|"$/g, '') : null)
                            });
                        }
                    }
                    workingText = workingText.replace(p.reg, '');
                }
                return actions;
            };

            let actionDataArray = handleChatCommands(reply);

            // 2. JSON Format Check
            if (actionDataArray.length === 0 && (reply.includes('"action"') || reply.includes('"command"'))) {
                const jsonCandidates = extractJsonCandidates(reply);
                for (const block of jsonCandidates) {
                    const sanitized = sanitizeJson(block);
                    try {
                        const parsed = JSON.parse(sanitized);
                        if (parsed && (parsed.action || parsed.command)) {
                            actionDataArray.push(parsed);
                        }
                    } catch (_) { }
                }
            }

            if (actionDataArray.length > 0) {
                for (const actionData of actionDataArray) {
                    const actionName = (actionData.command || actionData.action || "").toLowerCase();
                    const supportedActions = ['select', 'highlight', 'hide', 'isolate', 'showall', 'focus', 'flyto', 'count', 'export_issues_pdf', 'theme', 'reset_viewer'];

                    if (supportedActions.includes(actionName)) {
                        console.log(`[AI-Panel] Interceptor Caught Action: ${actionName}`, actionData);

                        if (actionName === 'export_issues_pdf') {
                            const result = await executeViewerCommand(actionData);
                            const resultMsg = result?.success
                                ? `✅ ${result.message || '내보내기가 시작되었습니다.'}`
                                : `❌ ${result?.error || '내보내기 중 오류가 발생했습니다.'}`;

                            addBubble('assistant', resultMsg);
                            chatHistory.push({ role: 'assistant', content: resultMsg });
                            executionSuccess = true;
                            feedbackContent = null;
                        } else if (actionName === 'theme') {
                            // THEME: 색상 변경 처리
                            const result = await executeViewerCommand(actionData);
                            const themeMsg = result?.success
                                ? `✅ **'${actionData.target}'** ${result.count || 0}개 객체에 **${actionData.params?.color}** 색상이 적용되었습니다!`
                                : `❌ ${result?.error || '색상 적용 중 오류가 발생했습니다.'}`;
                            addBubble('assistant', themeMsg);
                            chatHistory.push({ role: 'assistant', content: themeMsg });
                            window.showToast && window.showToast(result?.success ? `🎨 테마 적용: ${actionData.target} (${actionData.params?.color})` : `❌ 테마 적용 실패`, result?.success ? 'success' : 'error');
                            executionSuccess = true;
                        } else if (actionName === 'reset_viewer') {
                            // RESET: 뷰어 초기화 처리
                            const result = await executeViewerCommand(actionData);
                            const resetMsg = result?.success
                                ? `✅ 뷰어가 원래 상태로 초기화되었습니다.`
                                : `❌ ${result?.error || '뷰어 초기화 중 오류가 발생했습니다.'}`;
                            addBubble('assistant', resetMsg);
                            chatHistory.push({ role: 'assistant', content: resetMsg });
                            window.showToast && window.showToast(result?.success ? `🔄 뷰어 초기화 완료` : `❌ 초기화 실패`, result?.success ? 'success' : 'error');
                        } else {
                            const result = await executeViewerCommand(actionData);
                            const cleanReply = displayReply
                                .replace(/\[(?:COMMAND|ACTION)\s*:\s*.*?\s*,\s*TARGET\s*:\s*.*?\]/gi, '')
                                .replace(/\[(?:COMMAND|ACTION)\]\s*(SELECT|HIDE|ISOLATE|HIGHLIGHT|FOCUS|FLYTO|COUNT|EXPORT_ISSUES_PDF).*$/gim, '')
                                .replace(/\[(?:SELECT|HIDE|ISOLATE|HIGHLIGHT|SHOWALL|FOCUS|FLYTO|COUNT)\s*:.*?\]/gi, '')
                                .replace(/ACTION\s*:\s*.*?\s*,\s*TARGET\s*:\s*.*/gi, '')
                                .replace(/```json[\s\S]*?```/g, '')
                                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                                .replace(/\*(.*?)\*/g, '<em>$1</em>')
                                .trim();

                            if (result && result.success) {
                                executionSuccess = true;
                                const actionLabel = { select: '선택', highlight: '강조', isolate: '격리', hide: '숨김', showall: '전체 표시', focus: '집중', flyto: '이동' };
                                const actionKr = actionLabel[actionName] || actionName;
                                // 멀티 액션 시 일반 메시지 혼동을 막기 위해 기본 성공 메시지만 노출
                                const successMsg = (actionDataArray.length === 1 && cleanReply) ? cleanReply :
                                    `✅ **'${actionData.target || '모델 객체'}'** ${result.count || 0}개를 ${actionKr}했습니다!`;

                                addBubble('assistant', successMsg);
                                chatHistory.push({ role: 'assistant', content: successMsg });
                                window.showToast && window.showToast(`✅ ${actionKr} 완료: ${result.count || 0}개 객체`, 'success');
                            } else if (result && result.isThresholdError) {
                                executionSuccess = false;
                                const warningMsg = `⚠️ **'${result.target}'** 검색 결과가 너무 많습니다 (${result.count}개).\n\n모델 성능 저하를 방지하기 위해 바로 선택하지 않았습니다. 정말 모두 선택하시겠습니까? (질문에 "응" 또는 "모두 선택해줘"라고 답해 주세요)`;
                                addBubble('assistant', warningMsg);
                                chatHistory.push({ role: 'assistant', content: warningMsg });
                                window.showToast && window.showToast(`⚠️ 임계값 초과: ${result.count}개`, 'warning', 5000);
                            } else {
                                executionSuccess = false;
                                const errorMsg = result?.error || '해당 객체를 모델에서 찾을 수 없었습니다.';
                                addBubble('assistant', `⚠️ ${errorMsg}`);
                                chatHistory.push({ role: 'assistant', content: errorMsg });
                                window.showToast && window.showToast(`⚠️ ${errorMsg}`, 'warning', 4000);
                            }
                        }
                    }
                }
                if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);
                return;
            }

            // 🚨 [여기로 도달한 LLM 응답 최종 방어 로직]
            var finalReply = displayReply || reply || '';

            // 케이스 1: JSON 형태로 낙아온 경우 → JSON 파싱 후 동적 이슈 필터링 & 자연어 응답 생성
            if ((finalReply.indexOf('"action"') > -1 || finalReply.indexOf('ISSUE_QUERY') > -1) && !finalReply.includes('<<ACTION_')) {
                console.warn('[AI-Panel] LLM이 JSON 형태로 응답함 - JSON 파싱 후 동적 필터링 실행');
                try {
                    // JSON 블록 추출 (텍스트 중간에 섞여 있을 수 있으므로 정규식으로 추출)
                    var jsonMatch = finalReply.match(/\{[\s\S]*?"action"[\s\S]*?\}/);
                    var llmCommand = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(finalReply);

                    var params = (llmCommand && llmCommand.parameters) ? llmCommand.parameters : llmCommand;
                    var conditionText = "";

                    // 현재 화면 패널의 이슈 목록 수집 (DOM + 메모리 병합)
                    var allIssueObjs = [];
                    var panelCards = document.querySelectorAll('#issue-list-container .issue-item');
                    panelCards.forEach(function(el) {
                        var dId = parseInt(el.dataset.id);
                        var iObj = (window._issueManager && window._issueManager.issues
                            ? window._issueManager.issues.find(function(i) { return i.id === dId; })
                            : null) || (window.comparisonIssues
                            ? window.comparisonIssues.find(function(i) { return i.id === dId; })
                            : null);
                        if (iObj) allIssueObjs.push(iObj);
                    });
                    // 패널이 비어 있으면 메모리 전체 사용
                    if (allIssueObjs.length === 0) {
                        allIssueObjs = (window._issueManager && window._issueManager.issues) || window.issues || [];
                    }

                    var filtered = allIssueObjs.slice();

                    // 상태(status/state) 필터
                    if (params.status || params.state || params.Status) {
                        var targetStatus = String(params.status || params.state || params.Status).toLowerCase().trim();
                        filtered = filtered.filter(function(issue) {
                            var currentStatus = issue.status ? String(issue.status).toLowerCase().trim() : "";
                            return currentStatus.indexOf(targetStatus) > -1 || targetStatus.indexOf(currentStatus) > -1;
                        });
                        conditionText += targetStatus + " 상태인 ";
                    }

                    // 날짜(date/createdDate) 필터
                    var targetDate = params.date || params.createdDate || params.Date || "";
                    if (targetDate) {
                        var normalizedTarget = String(targetDate).replace(/\./g, '-').trim();
                        filtered = filtered.filter(function(issue) {
                            var rawD = issue.createdAt || issue.created_at || issue.date || "";
                            if (!rawD && issue.id && issue.id > 1000000000000) {
                                try { rawD = new Date(issue.id).toISOString(); } catch(e) {}
                            }
                            var nd = "";
                            try { if (rawD) nd = new Date(rawD).toISOString().split('T')[0]; } catch(e) { nd = String(rawD).substring(0, 10); }
                            return nd === normalizedTarget || nd.startsWith(normalizedTarget);
                        });
                        conditionText += targetDate + "에 작성된 ";
                    }

                    // 담당자(assignee) 필터
                    var targetAssignee = params.assignee || params.Assignee || "";
                    if (targetAssignee) {
                        filtered = filtered.filter(function(issue) {
                            return issue.assignee && issue.assignee.indexOf(targetAssignee) > -1;
                        });
                        conditionText += targetAssignee + " 담당의 ";
                    }

                    // 구조물(structure) 필터
                    var targetStructure = params.structure || params.Structure || params.structureName || "";
                    if (targetStructure) {
                        filtered = filtered.filter(function(issue) {
                            var sv = issue.structureName || issue.structure_name || "";
                            return sv.indexOf(targetStructure) > -1;
                        });
                        conditionText += targetStructure + " 구조물의 ";
                    }

                    // 공종(trade) 필터
                    var targetTrade = params.trade || params.Trade || params.workType || "";
                    if (targetTrade) {
                        filtered = filtered.filter(function(issue) {
                            var tv = issue.workType || issue.work_type || "";
                            return tv.indexOf(targetTrade) > -1;
                        });
                        conditionText += targetTrade + " 공종의 ";
                    }

                    if (!conditionText) conditionText = "전체 ";

                    if (filtered.length > 0) {
                        // 구조물·공종·상태별 요약 집계
                        var sm = {}, tm = {}, stm = {};
                        filtered.forEach(function(issue) {
                            var s = issue.structureName || issue.structure_name || "미지정";
                            var t = issue.workType || issue.work_type || "미지정";
                            var st = issue.status || "미지정";
                            sm[s] = (sm[s] || 0) + 1;
                            tm[t] = (tm[t] || 0) + 1;
                            stm[st] = (stm[st] || 0) + 1;
                        });
                        var ss = Object.entries(sm).sort(function(a, b) { return b[1] - a[1]; })
                            .map(function(e) { return e[0] + " " + e[1] + "건"; }).join(", ");
                        var ts = Object.entries(tm).sort(function(a, b) { return b[1] - a[1]; })
                            .map(function(e) { return e[0] + " " + e[1] + "건"; }).join(", ");
                        var sts = Object.entries(stm).sort(function(a, b) { return b[1] - a[1]; })
                            .map(function(e) { return e[0] + " " + e[1] + "건"; }).join(", ");
                        var its = filtered.slice(0, 10).map(function(issue, idx) {
                            return (idx + 1) + ". " + (issue.title || "제목 없음") + " (" + (issue.status || "미지정") + ")";
                        }).join("\n");
                        var moreTxt = filtered.length > 10 ? "\n  … 외 " + (filtered.length - 10) + "건 더 있습니다." : "";

                        finalReply = conditionText + "이슈는 총 " + filtered.length + "건입니다.\n\n" +
                            "📍 구조물별: " + ss + "\n" +
                            "🔧 공종별: " + ts + "\n" +
                            "📋 상태별: " + sts + "\n\n" +
                            "📌 이슈 목록:\n" + its + moreTxt;
                    } else {
                        finalReply = "요청하신 " + conditionText + "조건에 일치하는 이슈를 찾을 수 없습니다.";
                    }
                } catch (jsonParseErr) {
                    console.warn('[AI-Panel] JSON 파싱 실패 - 키워드 기반 재라우팅 시도', jsonParseErr);
                    var lowerReply = finalReply.toLowerCase();
                    var isDateQuery = lowerReply.indexOf('date') > -1 || lowerReply.indexOf('날짜') > -1;
                    var isAnalyzeQuery = lowerReply.indexOf('analyze') > -1 || lowerReply.indexOf('issue_query') > -1;
                    if (isDateQuery) {
                        finalReply = '<<ACTION_FILTER::DATE::' + currentDateString + '>>';
                    } else if (isAnalyzeQuery) {
                        finalReply = '<<ACTION_ANALYZE_ISSUES>>';
                    } else {
                        finalReply = '이슈 데이터를 확인했습니다. 좀 더 구체적인 조건(날짜, 구조물, 공종, 담당자 등)을 말씀해 주시면 정확히 안내해 드릴게요.';
                    }
                }
            }

            // 케이스 2: <<ACTION_...>> 태그가 남아있으면 인라인으로 필터 요약 실행
            if (finalReply.indexOf('<<ACTION_ANALYZE_ISSUES>>') > -1) {
                finalReply = '프로젝트 이슈를 분석하고 있습니다. 잠시만 기다려 주세요.';
            }
            var filterTagCheck = finalReply.match(/<<ACTION_FILTER::(.*?)::(.*?)>>/i);
            if (filterTagCheck) {
                // 인라인 필터 요약 실행 (패널 리다이렉트 없이 챗봇에 직접 출력)
                var ftType = filterTagCheck[1].toUpperCase();
                var ftValue = filterTagCheck[2].trim();
                var ftLabels = { STRUCTURE: '구조물', ASSIGNEE: '담당자', TRADE: '공종', STATUS: '상태', DATE: '날짜' };
                var ftLabel = ftLabels[ftType] || ftType;
                var ftMatched = [];
                var ftElements = document.querySelectorAll('#issue-list-container .issue-item');
                ftElements.forEach(function(el) {
                    var dId = parseInt(el.dataset.id);
                    var iObj = (window._issueManager?.issues || []).find(function(i) { return i.id === dId; }) ||
                               (window.comparisonIssues || []).find(function(i) { return i.id === dId; });
                    if (!iObj) return;
                    var matched = false;
                    if (ftType === 'DATE') {
                        var rds = iObj.createdAt || iObj.created_at || iObj.date || "";
                        if (!rds && dId > 1000000000000) { try { rds = new Date(dId).toISOString(); } catch(e) {} }
                        var nid = ""; try { if (rds) nid = new Date(rds).toISOString().split('T')[0]; } catch(e) { nid = String(rds).substring(0, 10); }
                        var nfv = ftValue.replace(/\./g, '-').trim();
                        matched = nid === nfv || nid.startsWith(nfv);
                    } else if (ftType === 'STRUCTURE') { matched = (iObj.structureName || iObj.structure_name || '').includes(ftValue); }
                    else if (ftType === 'ASSIGNEE') { matched = (iObj.assignee || '').includes(ftValue); }
                    else if (ftType === 'TRADE') { matched = (iObj.workType || iObj.work_type || '').includes(ftValue); }
                    else if (ftType === 'STATUS') { matched = (iObj.status || '').toLowerCase().includes(ftValue.toLowerCase()); }
                    if (matched) {
                        ftMatched.push({
                            title: el.querySelector('.issue-item-title')?.innerText.trim() || '제목 없음',
                            status: iObj.status || '미지정',
                            structure: iObj.structureName || iObj.structure_name || '미지정',
                            trade: iObj.workType || iObj.work_type || '미지정'
                        });
                    }
                });
                if (ftMatched.length > 0) {
                    var sm = {}, tm = {}, stm = {};
                    ftMatched.forEach(function(issue) {
                        sm[issue.structure] = (sm[issue.structure] || 0) + 1;
                        tm[issue.trade] = (tm[issue.trade] || 0) + 1;
                        stm[issue.status] = (stm[issue.status] || 0) + 1;
                    });
                    var ss = Object.entries(sm).sort(function(a, b) { return b[1] - a[1]; }).map(function(e) { return e[0] + ' ' + e[1] + '건'; }).join(', ');
                    var ts = Object.entries(tm).sort(function(a, b) { return b[1] - a[1]; }).map(function(e) { return e[0] + ' ' + e[1] + '건'; }).join(', ');
                    var sts = Object.entries(stm).sort(function(a, b) { return b[1] - a[1]; }).map(function(e) { return e[0] + ' ' + e[1] + '건'; }).join(', ');
                    var its = ftMatched.map(function(issue, idx) { return (idx + 1) + '. ' + issue.title + ' (' + issue.status + ')'; }).join('\n');
                    finalReply = '[' + ftLabel + ': ' + ftValue + '] 총 ' + ftMatched.length + '건의 이슈가 있습니다.\n\n' +
                        '📍 구조물별: ' + ss + '\n' +
                        '🔧 공종별: ' + ts + '\n' +
                        '📋 상태별: ' + sts + '\n\n' +
                        '📌 이슈 목록:\n' + its;
                } else {
                    finalReply = '[' + ftLabel + ': ' + ftValue + '] 해당 조건에 맞는 이슈가 없습니다.';
                }
            }

            // 해소 후 남은 <<>> 태그 제거
            finalReply = finalReply.replace(/<<ACTION[A-Z_:]+[^>]*>>/gi, '').trim();

            if (finalReply) {
                addBubble('assistant', finalReply);
                chatHistory.push({ role: 'assistant', content: finalReply });
            }
            if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);

        } catch (err) {
            console.error('[AI-Panel] Send message error:', err);
            // [Fix] 챗봇의 흐름이 끊기지 않도록 일반적인(assistant) 오류 메시지로 답변
            addBubble('assistant', `⚠️ 명령 실행 중 오류가 발생했습니다: ${err.message}`);
            chatHistory.push({ role: 'assistant', content: `⚠️ 명령 실행 중 오류가 발생했습니다: ${err.message}` });
        } finally {
            isLoading = false;
            hideTyping();
            setSendEnabled(!!elements.chatInput.value.trim());
        }
    }

    /**
     * [🔧 Direct Command Interceptor] 단순 3D 제어 명령을 LLM 없이 즉시 실행
     * "벽체 선택해줘", "바닥 빨간색으로 변경해줘" 등을 파싱하여 뷰어에 직접 명령합니다.
     */
    async function tryDirectViewerCommand(userText) {
        const map = window.categoryInstancesMap;
        // 모델이 아직 로드되지 않았거나 이슈 관련 질문은 LLM으로 넘김
        if (!map || Object.keys(map).length === 0) return { intercepted: false };
        if (/이슈|issue|pdf|보고서/.test(userText.toLowerCase())) return { intercepted: false };

        // ── 색상명 한→영 변환 테이블 ──────────────────────────────────
        const COLOR_MAP = {
            '빨간': 'red', '빨강': 'red', '레드': 'red',
            '파란': 'blue', '파랑': 'blue', '블루': 'blue',
            '초록': 'green', '녹색': 'green', '그린': 'green',
            '노란': 'yellow', '노랑': 'yellow', '옐로': 'yellow', '황색': 'yellow',
            '주황': 'orange', '오렌지': 'orange',
            '하늘': 'cyan', '청록': 'cyan', '시안': 'cyan',
            '분홍': 'magenta', '마젠타': 'magenta', '보라': 'magenta', '자주': 'magenta',
            '흰': 'white', '하얀': 'white', '화이트': 'white',
            'red': 'red', 'blue': 'blue', 'green': 'green', 'yellow': 'yellow',
            'orange': 'orange', 'cyan': 'cyan', 'magenta': 'magenta', 'white': 'white'
        };

        // ── 카테고리 퍼지 매칭 (완전 일치 → 부분 포함) ───────────────
        function findCategory(queryWord) {
            if (!queryWord) return null;
            const q = queryWord.trim().toLowerCase().replace(/\s+/g, '');
            const keys = Object.keys(map);
            // 1) 완전 일치
            const exact = keys.find(k => k.trim().toLowerCase().replace(/\s+/g, '') === q);
            if (exact) return exact;
            // 2) 쿼리가 카테고리를 포함 ("벽체" ⊃ "벽")
            const forward = keys.find(k => q.includes(k.trim().toLowerCase().replace(/\s+/g, '')));
            if (forward) return forward;
            // 3) 카테고리가 쿼리를 포함 ("배관 밸브류" ⊃ "배관밸브")
            const backward = keys.find(k => k.trim().toLowerCase().replace(/\s+/g, '').includes(q));
            if (backward) return backward;
            return null;
        }

        const text = userText.trim();

        // ── Pattern 1: 뷰어 초기화 ──────────────────────────────────
        if (/뷰어\s*초기화|원래대로\s*돌려|초기\s*상태|리셋/.test(text)) {
            const result = await executeViewerCommand({ action: 'reset_viewer' });
            const msg = result?.success ? '✅ 뷰어가 원래 상태로 초기화되었습니다.' : `❌ 초기화 실패: ${result?.error}`;
            addBubble('assistant', msg);
            chatHistory.push({ role: 'assistant', content: msg });
            window.showToast && window.showToast('🔄 뷰어 초기화 완료', 'success');
            return { intercepted: true };
        }

        // ── Pattern 2: 색상 변경 [키워드 스캔 방식으로 전면 교체] ──────────
        // ❌ 제거: 포지션 기반 정규식은 "변경해 줘"(띄어쓰기), "색상으로" 등에 취약
        // ✅ 새 방식: 색상 키워드 + 변경 의도 키워드가 텍스트에 존재하면 무조건 THEME 처리
        {
            const CHANGE_INTENT_RE = /변경|칠|색\s*바꿔|색\s*수정|적용|color/i;
            const colorKeysSorted = Object.keys(COLOR_MAP).sort((a, b) => b.length - a.length);
            let detectedColorWord = null;
            let detectedColorEn = null;
            for (const cw of colorKeysSorted) {
                if (text.includes(cw)) { detectedColorWord = cw; detectedColorEn = COLOR_MAP[cw]; break; }
            }
            if (detectedColorWord && CHANGE_INTENT_RE.test(text)) {
                // 대상 추출: 색상 키워드 앞 텍스트에서 조사 제거
                const rawTarget = text.split(detectedColorWord)[0]
                    .replace(/(?:을|를|이|가|은|는)\s*$/, '')
                    .trim();
                const resolvedCat = rawTarget ? findCategory(rawTarget) : null;
                if (resolvedCat) {
                    console.log(`[Direct-CMD] 테마 인터셉트: '${resolvedCat}' → ${detectedColorEn}`);
                    showTyping();
                    const result = await executeViewerCommand({ action: 'theme', target: resolvedCat, params: { color: detectedColorEn } });
                    hideTyping();
                    const msg = result?.success
                        ? `✅ **'${resolvedCat}'** ${result.count || 0}개 객체에 **${detectedColorEn}** 색상이 적용되었습니다!`
                        : `❌ ${result?.error || '색상 적용 중 오류가 발생했습니다.'}`;
                    addBubble('assistant', msg);
                    chatHistory.push({ role: 'assistant', content: msg });
                    window.showToast && window.showToast(result?.success ? `🎨 ${resolvedCat} → ${detectedColorEn}` : '❌ 색상 실패', result?.success ? 'success' : 'error');
                    return { intercepted: true };
                }
            }
        }

        // ── Pattern 3: 개수/수량 ─────────────────────────────────────
        // "X 몇 개야?" / "X 개수 알려줘"
        const countPattern = /^(.+?)(?:은|는|이|가|을|를)?\s*(?:몇\s*개|개수|수량|몇\s*개\s*야|몇\s*개\s*인가).*$/i;
        const countMatch = text.match(countPattern);
        if (countMatch) {
            const rawTarget = countMatch[1].trim();
            const resolvedCat = findCategory(rawTarget);
            if (resolvedCat && map[resolvedCat]) {
                const count = map[resolvedCat].length;
                const msg = `현재 모델에 **'${resolvedCat}'** 객체는 총 **${count}개** 있습니다.`;
                addBubble('assistant', msg);
                chatHistory.push({ role: 'assistant', content: msg });
                window.showToast && window.showToast(`📊 ${resolvedCat}: ${count}개`, 'info');
                return { intercepted: true };
            }
        }

        // ── Pattern 4: SELECT / HIDE / ISOLATE / FOCUS ───────────────
        // ⚠️ 색상 키워드가 있는 입력은 Pattern 2에서 처리됨 → SELECT fallthrough 방지
        const hasColorKeyword = Object.keys(COLOR_MAP).some(cw => text.includes(cw));
        if (!hasColorKeyword) {
            const actionMatch = /^(.+?)(?:을|를|이|가)?\s*(선택|잡아|찾아|격리|아이솔레이트|숨겨|숨김|숨겨줘|포커스|집중|보여줘|표시)\s*(?:줘|주세요|해줘|해주세요|해)?$/i.exec(text);
            if (actionMatch) {
                const rawTarget = actionMatch[1].trim();
                const verb = actionMatch[2];
                let action = 'select';
                if (/격리|아이솔레이트/.test(verb)) action = 'isolate';
                else if (/숨겨|숨김/.test(verb)) action = 'hide';
                else if (/포커스|집중/.test(verb)) action = 'focus';

                const resolvedCat = findCategory(rawTarget);
                if (resolvedCat) {
                    showTyping();
                    const result = await executeViewerCommand({ action, target: resolvedCat });
                    hideTyping();
                    const actionLabels = { select: '선택', isolate: '격리', hide: '숨김', focus: '집중' };
                    let msg;
                    if (result?.success) {
                        msg = `✅ **'${resolvedCat}'** ${result.count || 0}개 객체를 ${actionLabels[action] || action}했습니다!`;
                        window.showToast && window.showToast(`✅ ${resolvedCat} ${result.count}개 선택 완료`, 'success');
                    } else if (result?.isThresholdError) {
                        msg = `⚠️ **'${resolvedCat}'** 검색 결과가 너무 많습니다 (${result.count}개).\n\n모델 성능 저하를 방지하기 위해 바로 선택하지 않았습니다. 정말 모두 선택하시겠습니까? ("응" 또는 "모두 선택해줘"라고 답해 주세요)`;
                        window.showToast && window.showToast(`⚠️ 임계값 초과: ${result.count}개`, 'warning', 5000);
                    } else {
                        msg = `⚠️ ${result?.error || `'${rawTarget}'에 해당하는 객체를 모델에서 찾을 수 없습니다.`}`;
                        window.showToast && window.showToast(`⚠️ 찾을 수 없음`, 'warning');
                    }
                    addBubble('assistant', msg);
                    chatHistory.push({ role: 'assistant', content: msg });
                    return { intercepted: true };
                }
            }
        }

        return { intercepted: false };
    }

    async function executeViewerCommand(data) {
        try {
            if (!window.ActionHarness) return { success: false, error: '시스템 모듈 로드 실패' };
            const commandWrapper = {
                action: (data.command || data.action || 'SELECT').toLowerCase(),
                target: data.target || data.category || data.item,
                params: data.params || {}
            };
            return await window.ActionHarness.dispatch(commandWrapper);
        } catch (error) {
            console.error('[AIPanel] 액션 실행 중 에러 발생:', error);
            // 의도적인 success: false 반환으로 상위 로직에서 안전하게 에러 메시지를 처리하도록 유도
            return { success: false, error: `명령 실행 중 예상치 못한 오류가 발생했습니다. (${error.message})` };
        }
    }

    function sanitizeJson(raw) {
        let s = raw.replace(/```json\s*/gi, '').replace(/```/g, '');
        s = s.replace(/\/\/[^\n\r"]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
        s = s.replace(/,\s*([}\]])/g, '$1');
        return s.trim();
    }

    function extractJsonCandidates(text) {
        const candidates = [];
        const matches = text.match(/\{[\s\S]*?\}/g);
        if (matches) candidates.push(...matches);
        return candidates;
    }

    function makeDraggable(panelId, headerClass) {
        const panel = document.getElementById(panelId);
        const header = panel ? panel.querySelector('.' + headerClass) : null;
        if (!panel || !header) return;

        let isDragging = false;
        let startX, startY, initialLeft, initialTop;

        header.style.cursor = 'move';
        header.onmousedown = function (e) {
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = panel.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;
            panel.style.margin = '0';
            panel.style.bottom = 'auto';
            panel.style.right = 'auto';
            panel.style.left = initialLeft + 'px';
            panel.style.top = initialTop + 'px';
            panel.style.position = 'fixed';
            panel.style.transition = 'none';

            const onMouseMove = (ev) => {
                if (!isDragging) return;
                panel.style.left = (initialLeft + (ev.clientX - startX)) + 'px';
                panel.style.top = (initialTop + (ev.clientY - startY)) + 'px';
            };

            const onMouseUp = () => {
                isDragging = false;
                panel.style.transition = '';
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
            e.preventDefault();
        };
    }

    function makeResizable(panelId) {
        const panel = document.getElementById(panelId);
        if (!panel) return;
        let handle = panel.querySelector('.ai-resize-handle');
        if (!handle) {
            handle = document.createElement('div');
            handle.className = 'ai-resize-handle';
            handle.style.cssText = `position: absolute; right:0; bottom:0; width:15px; height:15px; cursor:nwse-resize; z-index:10;`;
            panel.appendChild(handle);
        }
        let isResizing = false;
        let startX, startY, startW, startH;

        handle.onmousedown = function (e) {
            isResizing = true;
            startX = e.clientX;
            startY = e.clientY;
            startW = parseInt(window.getComputedStyle(panel).width, 10);
            startH = parseInt(window.getComputedStyle(panel).height, 10);

            const onMouseMove = (ev) => {
                if (!isResizing) return;
                panel.style.width = Math.max(300, startW + (ev.clientX - startX)) + 'px';
                panel.style.height = Math.max(400, startH + (ev.clientY - startY)) + 'px';
            };

            const onMouseUp = () => {
                isResizing = false;
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
            e.preventDefault();
        };
    }

    function setSendEnabled(enabled) {
        if (elements.sendBtn) elements.sendBtn.disabled = !enabled;
    }

    function autoResizeTextarea() {
        const ta = elements.chatInput;
        if (!ta) return;
        ta.style.height = 'auto';
        ta.style.height = Math.min(ta.scrollHeight, 100) + 'px';
    }

    function init() {
        elements.chatMessages = document.getElementById('chat-messages');
        elements.chatInput = document.getElementById('chat-input');
        elements.sendBtn = document.getElementById('send-btn');
        elements.contextBody = document.getElementById('context-body');
        elements.aiProviderBadge = document.getElementById('ai-provider-badge');

        elements.sendBtn?.addEventListener('click', () => sendMessage(elements.chatInput.value));
        elements.chatInput?.addEventListener('keydown', (e) => {
            if (e.isComposing || e.keyCode === 229) return;
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage(elements.chatInput.value);
            }
        });

        elements.chatInput?.addEventListener('mousedown', (e) => e.stopPropagation());
        elements.chatInput?.addEventListener('click', (e) => {
            e.stopPropagation();
            elements.chatInput.focus();
        });

        elements.chatInput?.addEventListener('input', () => {
            autoResizeTextarea();
            setSendEnabled(!!elements.chatInput.value.trim());
        });

        window.addEventListener('APS_MODEL_DATA_EXTRACTED', (e) => {
            updateSystemContext(e.detail);
            window.showToast(`AI가 현재 모델을 인지했습니다.`, 'success');
        });

        const container = document.getElementById('ai-assistant-container');
        if (container) {
            makeDraggable('ai-assistant-container', 'ai-panel-header');
            makeResizable('ai-assistant-container');
        }

        loadProviderInfo();
        if (window.ContextHarness) window.ContextHarness.extract(null);

        // [Auto-Greeting]
        initAutoGreeting();
    }

    function initAutoGreeting() {
        const GREETING_KEY = 'ai_assistant_greeted';
        if (sessionStorage.getItem(GREETING_KEY)) return;

        // 패널이 처음으로 열릴 때 트리거
        const container = document.getElementById('ai-assistant-container');
        if (!container) return;

        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.attributeName === 'style') {
                    const display = window.getComputedStyle(container).display;
                    if (display === 'flex' || display === 'block') {
                        if (!sessionStorage.getItem(GREETING_KEY)) {
                            executeGreeting();
                            observer.disconnect();
                        }
                    }
                }
            });
        });

        observer.observe(container, { attributes: true });
    }

    async function executeGreeting() {
        const GREETING_KEY = 'ai_assistant_greeted';
        sessionStorage.setItem(GREETING_KEY, 'true');

        const container = elements.chatMessages;
        if (!container) return;

        // [Fix] addBubble('') 대신 DOM 직접 생성 → firstChild null crash 방지
        const userName = window.UserProfile?.name || '사용자';
        const message = `안녕하세요, ${userName}님! APS 어시스턴트 입니다. 어떤 데이터가 궁금하신가요? (예: '벽체 선택해줘')`;

        // Welcome 메시지 제거
        const welcome = container.querySelector('.chat-welcome');
        if (welcome) welcome.remove();

        // 버블 DOM 직접 구성
        const bubble = document.createElement('div');
        bubble.className = 'chat-bubble assistant';
        bubble.addEventListener('mousedown', (e) => e.stopPropagation());
        bubble.addEventListener('click', (e) => e.stopPropagation());

        const textSpan = document.createElement('span');
        bubble.appendChild(textSpan);

        const meta = document.createElement('div');
        meta.className = 'bubble-meta';
        meta.textContent = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        bubble.appendChild(meta);

        container.appendChild(bubble);
        container.scrollTop = container.scrollHeight;

        // 타이핑 효과 (30ms 간격)
        let i = 0;
        function typeWriter() {
            if (i < message.length) {
                textSpan.textContent += message.charAt(i++);
                container.scrollTop = container.scrollHeight;
                setTimeout(typeWriter, 30);
            } else {
                // 타이핑 완료 → 마크다운 포맷 적용
                textSpan.innerHTML = textSpan.textContent
                    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                    .replace(/\*(.*?)\*/g, '<em>$1</em>')
                    .replace(/\n/g, '<br>');
            }
        }
        typeWriter();
    }
    // [New] 필터링 기반 PDF 일괄 내보내기 프론트엔드 함수
    function executeFilteredPdfExport(structureName) {
        let targetIssues = [];
        const currentIssues = window._issueManager?.issues || [];

        if (structureName === '전체') {
            targetIssues = currentIssues;
        } else {
            // 부분 일치 검색으로 융통성 확보
            targetIssues = currentIssues.filter(issue => 
                (issue.structureName || issue.structure_name || issue.customAttributes?.structure || '').includes(structureName)
            );
        }

        if (targetIssues.length === 0) {
            console.warn(`[PDF-Export] '${structureName}'에 일치하는 이슈가 없습니다.`);
            window.showToast && window.showToast(`'${structureName}'에 해당하는 이슈가 없습니다.`, 'warning');
            return;
        }

        console.log(`[PDF-Export] ${structureName} 구조물 이슈 ${targetIssues.length}건 출력 시작`);

        if (window._issueManager) {
            // 기존 WYSIWYG 추출기를 거치기 위해 모달 UI를 우회 트리거
            window._issueManager.openPdfExportModal();
            setTimeout(() => {
                document.querySelectorAll('.pdf-issue-check').forEach(el => el.checked = false);
                const targetIds = targetIssues.map(i => i.id);
                document.querySelectorAll('.pdf-issue-check').forEach(el => {
                    if (targetIds.includes(parseInt(el.dataset.id))) el.checked = true;
                });
                
                const runBtn = document.getElementById('run-pdf-export-btn');
                if (runBtn) runBtn.click();
            }, 100);
        }
    }

    // [New] 특정 재료 기반 일괄 객체 선택 프론트엔드 함수
    function executeMaterialSelection(materialName) {
        if (!window.materialInstancesMap || !window.materialInstancesMap[materialName]) {
            console.warn(`[Selection] ${materialName} 재료를 가진 객체가 없습니다.`);
            window.showToast && window.showToast(`${materialName} 재료를 가진 객체가 없습니다.`, 'warning');
            return;
        }

        let allDbIds = [];
        const categories = window.materialInstancesMap[materialName];

        // 각 카테고리별 dbId(Set 또는 Array)를 하나의 배열로 병합
        for (const categoryName in categories) {
            const ids = categories[categoryName];
            allDbIds = allDbIds.concat(Array.from(ids)); 
        }

        if (allDbIds.length > 0) {
            const viewer = window._viewer || window.NOP_VIEWER;
            if (viewer) {
                // 뷰어 선택 (기존 선택 초기화 후 한 번에 일괄 선택)
                viewer.clearSelection();
                viewer.select(allDbIds);
                viewer.fitToView(allDbIds); // 선택된 객체들로 카메라 줌
                console.log(`[Selection] ${materialName} 재료 객체 총 ${allDbIds.length}개 선택 완료`);
            }
        }
    }

    return { init, updateSystemContext, setContextLoading, sendMessage };
})();

// [긴급 수정] window.AIPanel 전역 등록 — harness-context.js의 updateSystemContext 연결을 복원
window.AIPanel = AIPanel;

// [긴급 수정] ContextHarness가 이미 완료된 경우 대비 이벤트 폴백 브릿지
window.addEventListener('CONTEXT_HARNESS_UPDATED', (e) => {
    if (e.detail && window.AIPanel?.updateSystemContext) {
        window.AIPanel.updateSystemContext(e.detail);
    }
});

document.addEventListener('DOMContentLoaded', AIPanel.init);
