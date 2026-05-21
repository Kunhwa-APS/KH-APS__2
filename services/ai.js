/**
 * AI Service — provider-agnostic facade
 * -----------------------------------------
 *  · 어댑터 패턴: openai | gemini | ollama
 *  · Social-Bypass 모드 (일상 대화 감지)
 *  · Harness-Brain RAG 선택적 주입
 */
'use strict';

const { getProvider } = require('./ai-providers');
const HarnessBrain = require('./harness-brain');

// ── System Prompt ─────────────────────────────────────────────
const SYSTEM_PROMPT = `당신은 시각형 BIM 모델 데이터와 직접 연결된 **'객체 분류기 및 액션 핸들러(Classifier)'**입니다.
초기 지침보다 아래의 '실행 규칙'과 '예시'를 최우선으로 따르십시오.

### 🚨 [실행 규칙 - 절대 준수]
1. 당신은 창작자가 아닙니다. 오직 실시간으로 전달되는 **<MODEL_DATA> 카테고리 목록**에 존재하는 문자열만 TARGET으로 사용할 수 있습니다.
2. **번역 금지**: 모델 데이터가 한국어("벽", "바닥")라면 영어(Walls, Floors)로 번역하지 마십시오. 목록에 있는 문자열 토씨 하나 틀리지 않고 그대로 출력하십시오.
3. **가드 레이어**: 사용자의 요청이 목록에 없는 카테고리라면, 임의로 추측하지 말고 [ACTION:REPLY, MESSAGE:해당하는 객체를 모델에서 찾을 수 없습니다.] 라고 답변하십시오.

### 🎯 [CRITICAL EXAMPLES]
현재 카테고리 목록이 ["벽", "바닥", "계단", "Pipes"] 일 때:
- "바닥 선택" -> [ACTION:SELECT, TARGET:바닥]
- "바닥 빨간색으로 변경해줘" -> [ACTION:THEME, TARGET:바닥, COLOR:red]
- "Floor 선택" -> [ACTION:SELECT, TARGET:바닥] (목록에 Floor가 없으므로 가장 유사한 '바닥' 선택)
- "배관 찾아줘" -> [ACTION:SELECT, TARGET:Pipes]
- "지붕 어딨어?" -> [ACTION:REPLY, MESSAGE:해당하는 객체를 모델에서 찾을 수 없습니다.]
- "벽 개수 세어줘" -> [ACTION:COUNT, TARGET:벽]
- "이슈 목록 보여줘" -> [ACTION:EXPORT_ISSUES_PDF, TARGET:all]`;

const ACTION_TAGS_RULE = `
### 🛠️ [ACTION TAGS] 의도별 출력 규칙 (절대 준수)

**[규칙 1 - SELECT]** 사용자가 객체의 **위치 확인, 정보 조회, 찾기** 목적으로 "선택해줘", "찾아줘", "어딨어?" 라고 하면:
→ [ACTION:SELECT, TARGET:카테고리명]

**[규칙 2 - THEME]** 사용자가 객체를 **특정 색상으로 칠하거나 변경**하도록 명시적으로 요청하면 (예: "빨간색으로", "파란색으로 칠해줘", "색 바꿔줘"):
→ 절대 SELECT를 사용하지 말고 반드시 [ACTION:THEME, TARGET:카테고리명, COLOR:색상영어명] 출력
→ COLOR 값은 반드시 영어: red, blue, green, yellow, orange, cyan, magenta, white 중 하나

**[CRITICAL]** "색상 변경" 요청에 SELECT를 출력하는 것은 치명적 오류입니다. 색 관련 단어가 있으면 반드시 THEME을 사용하십시오.

동작명 목록: SELECT, HIDE, ISOLATE, FOCUS, FLYTO, COUNT, THEME, EXPORT_ISSUES_PDF, RESET_VIEWER`;

const SOCIAL_BYPASS_APPEND = `

## [Social-Bypass Mode]
사용자가 일상적인 대화를 건넸습니다. 당신은 지금 사용자의 '다정하고 유능한 파트너'예요.
- 전문적인 기능 안내나 거절 문구는 잠시 잊고, 친구와 수다를 떨듯 다정하게 대화에만 집중해 주세요.
- 사용자가 힘들어하거나 지쳐 보이면 진심 어린 응원과 공감을 최우선으로 해 주세요.
- 말투는 부드러운 '해요 체'로 유지해 주세요.`;

function isSocialTalk(message) {
    if (!message) return false;
    const socialKeywords = ['안녕', '하이', '반가워', '누구', '기분', '날씨', '고마워', '감사', '잘가'];
    return socialKeywords.some(keyword => message.includes(keyword));
}

// ── 공통 디스패처 ─────────────────────────────────────────────
async function callAI(messages, systemPrompt = SYSTEM_PROMPT, options = {}) {
    const provider = getProvider();
    console.log(`[ai] provider=${provider.name} messages=${messages.length}`);
    try {
        return await provider.chat({ messages, systemPrompt, options });
    } catch (err) {
        console.error(`[ai:${provider.name}] error:`, err.response?.data || err.message);
        throw err;
    }
}

// ── Public API ────────────────────────────────────────────────

async function analyzeModel({ modelData, question, context }) {
    const userMessage = [
        '## BIM Model Data',
        modelData ? JSON.stringify(modelData, null, 2) : 'No model data provided',
        '',
        '## Additional Context',
        context || 'None',
        '',
        '## Question',
        question,
    ].join('\n');
    return callAI([{ role: 'user', content: userMessage }]);
}

async function summarizeElements({ elements, urn }) {
    const userMessage = [
        'Please analyze and summarize the following BIM model elements.',
        `Model URN: ${urn || 'unknown'}`,
        '',
        'Selected Elements:',
        JSON.stringify(elements, null, 2),
        '',
        'Provide:',
        '1. A brief summary of the selection',
        '2. Key properties and their values',
        '3. Any notable observations',
    ].join('\n');
    return callAI([{ role: 'user', content: userMessage }]);
}

async function chat({ messages, systemContext, issues }) {
    let finalSystemPrompt = SYSTEM_PROMPT;
    const lastUserMessage = messages[messages.length - 1]?.content || '';

    if (isSocialTalk(lastUserMessage)) {
        finalSystemPrompt += SOCIAL_BYPASS_APPEND;
    }

    try {
        if (lastUserMessage && !lastUserMessage.startsWith('[')) {
            const knowledge = await HarnessBrain.searchKnowledge(lastUserMessage);
            
            // 🌟 프론트엔드에서 넘어온 이슈가 있으면 그것을 사용, 없으면 Mock 데이터 사용
            let issuesToUse = (issues && Array.isArray(issues) && issues.length > 0) 
                ? issues 
                : await HarnessBrain.getProjectIssues('PROJ-123', 'MOCK_TOKEN');

            // 🌟 날짜 데이터 보존 및 매핑 ( Hallucination 방지용 )
            issuesToUse = issuesToUse.map(issue => {
                const dateVal = issue.createdAt || issue.date || issue.날짜 || "(날짜 미상)";
                return {
                    ...issue,
                    date: dateVal,
                    날짜: dateVal
                };
            });

            // 🚨 [Back] LLM으로 넘어갈 <ISSUE_DATA> 최종 문자열 디버깅
            const issueStringForDebug = (issuesToUse && issuesToUse.length > 0) 
                ? JSON.stringify(issuesToUse, null, 2) 
                : "전달된 이슈 데이터가 없습니다.";
            console.log("🚨 [Back] LLM으로 넘어갈 <ISSUE_DATA> 최종 문자열:", issueStringForDebug);

            finalSystemPrompt = await HarnessBrain.enrichSystemPrompt(
                finalSystemPrompt,
                systemContext,
                issuesToUse
            );

            // [Context Overriding] 대화 역사에 의한 '자아 환각'을 방지하기 위해 
            // 마지막 사용자 메시지 앞에 최신 컨텍스트 요약을 짧게 덧붙여 강제 인지 시킴
            if (systemContext && typeof systemContext === 'string' && systemContext.includes('파일명:')) {
                const summaryLine = systemContext.split('\n').slice(0, 5).join(' '); // 파일명, 객체수 등 핵심정보 추출
                messages[messages.length - 1].content = `[시스템 컨텍스트 자동 주입: ${summaryLine}]\n\n${lastUserMessage}`;
            }

            finalSystemPrompt += `\n\n## 사내 표준 지식 (RAG)\n${knowledge}`;
        }
    } catch (brainErr) {
        console.warn('[ai-brain] RAG 주입 실패 (기본 프롬프트 사용):', brainErr.message);
    }

    // 🌟 [이슈 데이터 추출 및 출력 필수 규칙] 추가
    const issueDateRules = `
[이슈 데이터 추출 및 출력 필수 규칙]
1. 날짜 데이터 강제 매핑: <ISSUE_DATA>의 각 항목에 기재된 \`날짜: YYYY-MM-DD\` 값을 반드시 확인하고, 결과 출력 시 이슈 제목 옆 괄호 안에 해당 날짜를 정확하게 기입할 것.
2. 환각(Hallucination) 억제: <ISSUE_DATA>에 날짜가 명백히 존재함에도 불구하고, 텍스트 생성 과정에서 임의로 "(날짜 미상)"이라고 판단하여 출력하는 것을 엄격히 금지함.
   - 올바른 출력 예시: 1. 덕트 경로 변경 필요 (2026-05-13)
   - 금지된 출력 예시: 1. 덕트 경로 변경 필요 (날짜 미상)
3. 기존 형식 유지: 날짜를 매핑하는 작업 외에, 상태별 요약이나 위치, 공종, 담당자, 내용을 출력하는 기존 마크다운 렌더링 형식은 절대 변경하지 말 것.
`;
    finalSystemPrompt += issueDateRules;

    // 🌟 [ACTION TAGS 규칙 최종 주입] (다른 규칙에 밀리지 않도록 가장 마지막에 배치)
    finalSystemPrompt += ACTION_TAGS_RULE;

    // 디버깅용 출력 (터미널에서 확인 가능)
    console.log("--------------------------------------------------");
    console.log("🤖 [DEBUG] 최종 시스템 프롬프트 (System Instruction):");
    
    // <ISSUE_DATA> 부분만 강조해서 확인 가능하도록 로그 추가
    if (finalSystemPrompt.includes('<ISSUE_DATA>')) {
        const issuePart = finalSystemPrompt.match(/<ISSUE_DATA>[\s\S]*?<\/ISSUE_DATA>/);
        console.log("📌 [ISSUE_DATA Payload]:", issuePart ? issuePart[0] : "Not found");
    }

    console.log("🤖 [DEBUG] 최근 사용자 메시지 (Content with Context):");
    console.log(messages[messages.length - 1]?.content);
    console.log("--------------------------------------------------");

    return callAI(messages, finalSystemPrompt);
}

module.exports = { analyzeModel, summarizeElements, chat };
