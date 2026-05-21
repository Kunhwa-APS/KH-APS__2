/**
 * public/js/toolbar-utils.js
 * Shared utility functions for adding custom buttons to the APS Viewer toolbar.
 */
// Removed legacy clash imports

/**
 * Modularized function to add Issue and Clash buttons to any viewer instance.
 */
export function addCustomButtons(viewer) {
    if (!viewer) return;

    // 1. Clash Button is now handled by NavisClashExtension.js

    // 2. Add Issue Button — 클릭 시: MarkupsCore 활성화 → 이슈 생성 모드 진입
    addIssueToolbarButton(viewer, (e) => {
        if (e) {
            if (e.preventDefault) e.preventDefault();
            if (e.stopImmediatePropagation) e.stopImmediatePropagation();
            if (e.stopPropagation) e.stopPropagation();
        }
        _handleIssueToolClick(viewer);
    });

    // [DOM 직접 이벤트 제거] APS 버튼 onClick과 DOM 리스너가 중복되어 Double-firing 방지
    const domBtn = document.getElementById('add-issue-tool-btn');
    if (domBtn) {
        const clone = domBtn.cloneNode(true);
        domBtn.parentNode.replaceChild(clone, domBtn);
        
        clone.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopImmediatePropagation();
            _handleIssueToolClick(viewer);
        });
    }

    console.log('[ToolbarUtils] Custom buttons added to viewer instance.');
}

/**
 * [공통 핸들러] 이슈 버튼 클릭 시 실행되는 핵심 로직
 * 1. MarkupsCore 익스텐션 로드 및 편집 모드 진입
 * 2. IssueManager.toggleCreationMode() 호출 (캔버스 클릭 → 이슈 생성 플로우 시작)
 */
function _handleIssueToolClick(viewer) {
    console.log("🚨 [Issue Btn Clicked] 위치 선택 모드 진입...");

    if (window._issueManager) {
        window._issueManager.toggleCreationMode(true);
    } else {
        console.warn('[ToolbarUtils] ⚠️ _issueManager가 아직 초기화되지 않았습니다.');
    }
}


/**
 * Adds a custom button to the viewer toolbar for issue management.
 */
export function addIssueToolbarButton(viewer, onClick) {
    const toolbar = viewer.getToolbar(true);
    if (!toolbar) return;

    let navControl = toolbar.getControl('settingsControl');
    if (!navControl) {
        navControl = new Autodesk.Viewing.UI.ControlGroup('custom-issue-group');
        toolbar.addControl(navControl);
    }

    const btn = new Autodesk.Viewing.UI.Button('add-issue-tool-btn');

    // Custom SVG Location Pin for a premium look
    btn.icon.innerHTML = `
        <svg viewBox="0 0 24 24" width="20" height="20" style="margin-top: 4px;">
            <path fill="currentColor" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
        </svg>
    `;
    btn.addClass('adsk-viewing-viewer-toolbar-record-button');
    btn.setToolTip('Add Issue (Click on model)');
    btn.onClick = onClick;
    navControl.addControl(btn);
    return btn;
}
