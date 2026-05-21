/**
 * AI Routes — OpenAI / Gemini / Ollama 통합 엔드포인트
 */
'use strict';

const express = require('express');
const aiService = require('../services/ai');
const config = require('../config.js');
const { asyncHandler, AppError, rateLimit } = require('../middleware');

const router = express.Router();

// AI 엔드포인트는 비용이 높으므로 IP 당 분당 30회로 제한
router.use(rateLimit({ windowMs: 60_000, max: 30, message: 'AI 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' }));

// ── POST /api/ai/analyze ───────────────────────────────────────
router.post('/analyze', asyncHandler(async (req, res) => {
    const { modelData, question, context } = req.body || {};
    if (!question) throw new AppError('question is required', 400, 'VALIDATION_ERROR');
    const answer = await aiService.analyzeModel({ modelData, question, context });
    res.json({ answer, timestamp: new Date().toISOString() });
}));

// ── POST /api/ai/summarize ─────────────────────────────────────
router.post('/summarize', asyncHandler(async (req, res) => {
    const { elements, urn } = req.body || {};
    if (!Array.isArray(elements) || elements.length === 0) {
        throw new AppError('elements array is required', 400, 'VALIDATION_ERROR');
    }
    const summary = await aiService.summarizeElements({ elements, urn });
    res.json({ summary, timestamp: new Date().toISOString() });
}));

// ── POST /api/ai/chat  → Multi-turn conversation
router.post('/chat', async (req, res, next) => {
    try {
        // 🚨 [Back] 프론트에서 받은 전체 body 디버깅
        console.log("🚨 [Back] 프론트에서 받은 전체 body:", JSON.stringify(req.body, null, 2));

        const { messages, systemContext, issues } = req.body;
        if (!messages || !messages.length) {
            return next({ status: 400, message: 'messages array is required' });
        }
        const reply = await aiService.chat({ messages, systemContext, issues });
        res.json({ reply, timestamp: new Date().toISOString() });
    } catch (err) {
        console.error('[AI] chat error:', err.message);
        next({ status: 500, message: 'AI chat failed: ' + err.message });
    }
});

// ── GET /api/ai/provider ───────────────────────────────────────
router.get('/provider', (req, res) => {
    res.json({
        provider: process.env.AI_PROVIDER || 'not configured',
        hasOpenAI: !!config.ai.openaiKey,
        hasGemini: !!config.ai.geminiKey,
        ollama: {
            configured: !!process.env.OLLAMA_HOST,
            host: config.ai.ollamaHost,
            model: process.env.OLLAMA_MODEL || 'llama3',
        },
    });
});

module.exports = router;
