/**
 * Conversation Memory - Store and retrieve context across multiple turns
 * Enables follow-up questions, context awareness, and automatic intent detection
 * 
 * Features:
 * - Auto-detect message intent (SIMPLE_QA, CODE, MATH, FORMULA, SQL, etc)
 * - Flexible tool detection for all task types
 * - Professional formatting with standard templates
 * - Grammar & structure validation
 */

import { classifyIntent } from './intentClassifier.js';

export class ConversationMemory {
    constructor(maxMemorySize = 10) {
        this.conversations = new Map(); // userId → conversation history
        this.maxMemorySize = maxMemorySize;
        this.contextCache = new Map(); // Quick lookup for recent context
        this.intentHistory = new Map(); // userId → intent classification history
        this.messageStats = new Map(); // userId → message statistics
    }

    /**
     * Add message to conversation history with automatic intent detection
     * @param {string} userId - User identifier
     * @param {string} role - 'user' or 'assistant'
     * @param {string} content - Message content
     * @param {object} metadata - Optional metadata (type, language, etc)
     * @returns {object} Enhanced message with intent classification
     */
    addMessage(userId, role, content, metadata = {}) {
        if (!this.conversations.has(userId)) {
            this.conversations.set(userId, []);
            this.intentHistory.set(userId, []);
            this.messageStats.set(userId, {
                totalMessages: 0,
                byRole: { user: 0, assistant: 0 },
                byIntent: {}
            });
        }

        const conversation = this.conversations.get(userId);

        // Auto-detect intent only for user messages
        let intentClassification = null;
        if (role === 'user') {
            const previousIntent = this.getLastIntent(userId);
            intentClassification = classifyIntent(content, {
                previousIntent: previousIntent?.intent,
                conversationLength: conversation.length
            });
        }

        const message = {
            role, // 'user' or 'assistant'
            content: this.normalizeContent(content),
            timestamp: Date.now(),
            intent: intentClassification,
            metadata: {
                ...metadata,
                quality: role === 'user' ? this.analyzeQuality(content) : null
            }
        };

        conversation.push(message);

        // Track intent
        if (intentClassification) {
            const intents = this.intentHistory.get(userId);
            intents.push({
                intent: intentClassification.intent,
                confidence: intentClassification.confidence,
                timestamp: message.timestamp
            });
        }

        // Keep only last N messages
        if (conversation.length > this.maxMemorySize) {
            conversation.shift();
        }

        // Update statistics
        this.updateStats(userId, role, intentClassification);
        this.updateContextCache(userId);

        return message;
    }

    /**
     * Get recent conversation context with intent awareness
     * @param {string} userId - User identifier
     * @param {number} depth - Number of recent messages to retrieve
     * @returns {object} Context with messages, summary, and intent information
     */
    getContext(userId, depth = 5) {
        const conversation = this.conversations.get(userId) || [];
        const recent = conversation.slice(-depth);
        const lastIntent = this.getLastIntent(userId);

        return {
            messages: recent.map(msg => ({
                role: msg.role,
                content: msg.content,
                intent: msg.intent?.intent || null,
                confidence: msg.intent?.confidence || null
            })),
            summary: this.generateContextSummary(recent),
            lastIntent: lastIntent?.intent || null,
            totalMessages: conversation.length
        };
    }

    /**
     * Get the last detected intent for a user
     * @param {string} userId - User identifier
     * @returns {object} Last intent classification or null
     */
    getLastIntent(userId) {
        const intents = this.intentHistory.get(userId) || [];
        return intents.length > 0 ? intents[intents.length - 1] : null;
    }

    /**
     * Normalize content: trim, fix whitespace, validate format
     * @param {string} content - Raw content
     * @returns {string} Normalized content
     */
    normalizeContent(content) {
        if (typeof content !== 'string') {
            return String(content);
        }
        return content
            .trim()
            .replace(/\s+/g, ' ') // Normalize whitespace
            .replace(/\s+\n/g, '\n') // Fix trailing whitespace on lines
            .replace(/\n\s+/g, '\n'); // Fix leading whitespace on lines
    }

    /**
     * Analyze message quality: grammar, length, format
     * @param {string} content - Message content
     * @returns {object} Quality metrics
     */
    analyzeQuality(content) {
        const quality = {
            length: content.length,
            wordCount: content.split(/\s+/).filter(w => w.length > 0).length,
            hasQuestionMark: content.includes('?'),
            hasProperCapitalization: /^[A-Z]/.test(content.trim()),
            hasProperEnding: /[.!?]$/.test(content.trim()),
            avgWordLength: 0,
            score: 0
        };

        const words = content.split(/\s+/).filter(w => w.length > 0);
        quality.avgWordLength = words.reduce((sum, w) => sum + w.length, 0) / (words.length || 1);

        // Calculate quality score (0-100)
        quality.score = Math.min(100,
            (quality.wordCount > 0 ? 20 : 0) +
            (quality.hasProperCapitalization ? 20 : 0) +
            (quality.hasProperEnding ? 20 : 0) +
            (quality.hasQuestionMark ? 10 : 0) +
            (quality.avgWordLength >= 4 ? 30 : 20)
        );

        return quality;
    }

    /**
     * Update message statistics for user
     * @param {string} userId - User identifier
     * @param {string} role - 'user' or 'assistant'
     * @param {object} intentClassification - Intent classification result
     */
    updateStats(userId, role, intentClassification) {
        const stats = this.messageStats.get(userId);
        if (!stats) return;

        stats.totalMessages++;
        stats.byRole[role]++;

        if (intentClassification) {
            const intent = intentClassification.intent;
            stats.byIntent[intent] = (stats.byIntent[intent] || 0) + 1;
        }
    }

    /**
     * Generate context summary for AI
     */
    generateContextSummary(messages) {
        if (messages.length === 0) return '';

        const topics = [];
        let lastCode = null;
        let lastData = null;

        for (const msg of messages) {
            // Extract code context
            if (msg.content.includes('```')) {
                lastCode = msg.content.match(/```[\s\S]*?```/)?.[0];
            }

            // Extract data context
            if (msg.role === 'user' && msg.content.length > 100) {
                lastData = msg.content.substring(0, 200);
            }

            // Extract topics
            if (msg.role === 'user') {
                const words = msg.content.split(/\s+/);
                topics.push(...words.filter(w => w.length > 4).slice(0, 3));
            }
        }

        const uniqueTopics = [...new Set(topics)].slice(0, 5);

        return {
            topicsDiscussed: uniqueTopics,
            lastCodeContext: lastCode ? 'Yes, code was discussed' : 'No code context',
            lastDataContext: lastData ? lastData.substring(0, 100) + '...' : null,
            conversationLength: messages.length,
            contextSummary: `Recent discussion about: ${uniqueTopics.join(', ')}`
        };
    }

    /**
     * Detect if this is a follow-up question
     */
    isFollowUp(userId, currentPrompt) {
        const context = this.getContext(userId, 3);

        if (context.messages.length === 0) return false;

        // Check for follow-up keywords
        const followUpKeywords = [
            'that', 'it', 'this', 'modify', 'change', 'improve',
            'can you', 'could you', 'also', 'more', 'again',
            'like the', 'similar to', 'based on'
        ];

        const isFollowUp = followUpKeywords.some(kw =>
            currentPrompt.toLowerCase().includes(kw)
        );

        return isFollowUp && context.messages.length > 0;
    }

    /**
     * Inject conversation context into prompt with intent-aware formatting
     * @param {string} userId - User identifier
     * @param {string} userPrompt - Current user prompt
     * @param {boolean} includeFullHistory - Include full history vs recent messages
     * @returns {string} Formatted prompt with context
     */
    injectContext(userId, userPrompt, includeFullHistory = false) {
        const context = this.getContext(userId, includeFullHistory ? 10 : 3);

        if (context.messages.length === 0) {
            return userPrompt;
        }

        const lastIntent = context.lastIntent;
        const intentInfo = lastIntent ? `\nCONTEXT: Previous topic was ${lastIntent}\n` : '';

        let contextBlock = '='.repeat(60) + '\n';
        contextBlock += 'CONVERSATION HISTORY\n';
        contextBlock += '='.repeat(60) + '\n\n';

        for (const msg of context.messages) {
            const role = msg.role === 'user' ? '👤 USER' : '🤖 ASSISTANT';
            const intentTag = msg.intent ? ` [${msg.intent}]` : '';
            contextBlock += `${role}${intentTag}:\n`;
            contextBlock += `${msg.content}\n`;
            contextBlock += '-'.repeat(40) + '\n\n';
        }

        contextBlock += '='.repeat(60) + '\n';
        contextBlock += 'CURRENT QUESTION\n';
        contextBlock += '='.repeat(60) + '\n';
        contextBlock += intentInfo;
        contextBlock += userPrompt;

        return contextBlock;
    }

    /**
     * Extract and remember code from conversation
     */
    rememberCode(userId, language, code, description = '') {
        if (!this.conversations.has(userId)) {
            this.conversations.set(userId, []);
        }

        this.addMessage(userId, 'system', `CODE_CONTEXT: ${language}`, {
            type: 'code_context',
            language,
            code,
            description,
            savedAt: Date.now()
        });
    }

    /**
     * Get remembered code
     */
    getRememberedCode(userId) {
        const conversation = this.conversations.get(userId) || [];
        return conversation
            .filter(msg => msg.type === 'code_context')
            .map(msg => ({
                language: msg.language,
                code: msg.code,
                description: msg.description
            }));
    }

    /**
     * Update context cache for performance
     */
    updateContextCache(userId) {
        const context = this.getContext(userId, 5);
        this.contextCache.set(userId, {
            lastUpdated: Date.now(),
            summary: context.summary,
            messageCount: context.totalMessages
        });
    }

    /**
     * Clear old conversations (cleanup)
     */
    clearOldConversations(maxAgeMinutes = 60) {
        const now = Date.now();
        const maxAge = maxAgeMinutes * 60 * 1000;

        for (const [userId, messages] of this.conversations.entries()) {
            const lastMessage = messages[messages.length - 1];
            if (lastMessage && (now - lastMessage.timestamp) > maxAge) {
                this.conversations.delete(userId);
                this.contextCache.delete(userId);
            }
        }
    }

    /**
     * Get comprehensive conversation statistics
     * @param {string} userId - User identifier
     * @returns {object} Detailed statistics including intent breakdown
     */
    getStats(userId) {
        const conversation = this.conversations.get(userId) || [];
        const userMessages = conversation.filter(m => m.role === 'user').length;
        const assistantMessages = conversation.filter(m => m.role === 'assistant').length;
        const userContent = conversation.filter(m => m.role === 'user').map(m => m.content);

        const stats = this.messageStats.get(userId) || {
            totalMessages: 0,
            byRole: { user: 0, assistant: 0 },
            byIntent: {}
        };

        return {
            totalMessages: conversation.length,
            userMessages,
            assistantMessages,
            avgMessageLength: conversation.length > 0
                ? conversation.reduce((sum, m) => sum + m.content.length, 0) / conversation.length
                : 0,
            avgUserMessageLength: userMessages > 0
                ? userContent.reduce((sum, c) => sum + c.length, 0) / userMessages
                : 0,
            startedAt: conversation.length > 0 ? conversation[0].timestamp : null,
            lastMessage: conversation.length > 0 ? conversation[conversation.length - 1].timestamp : null,
            intentBreakdown: stats.byIntent,
            conversationDuration: conversation.length > 0
                ? conversation[conversation.length - 1].timestamp - conversation[0].timestamp
                : 0,
            mostFrequentIntent: this.getMostFrequentIntent(stats.byIntent),
            qualityScore: this.calculateConversationQuality(conversation)
        };
    }

    /**
     * Get the most frequently occurring intent
     * @param {object} intentCounts - Intent counts object
     * @returns {string} Most frequent intent or null
     */
    getMostFrequentIntent(intentCounts) {
        const entries = Object.entries(intentCounts || {});
        if (entries.length === 0) return null;
        return entries.reduce((max, [intent, count]) => count > (max[1] || 0) ? [intent, count] : max)[0];
    }

    /**
     * Calculate overall conversation quality based on message metrics
     * @param {array} conversation - Array of messages
     * @returns {number} Quality score 0-100
     */
    calculateConversationQuality(conversation) {
        if (conversation.length === 0) return 0;

        const userMessages = conversation.filter(m => m.role === 'user');
        if (userMessages.length === 0) return 0;

        let score = 0;
        const weights = {
            hasProperCapitalization: 0.2,
            hasProperEnding: 0.2,
            avgWordLength: 0.2,
            wordCount: 0.2,
            consistency: 0.2
        };

        // Check capitalization
        const properlyCaps = userMessages.filter(m =>
            /^[A-Z]/.test(m.content.trim())
        ).length;
        score += (properlyCaps / userMessages.length) * 100 * weights.hasProperCapitalization;

        // Check proper ending
        const properEnding = userMessages.filter(m =>
            /[.!?]$/.test(m.content.trim())
        ).length;
        score += (properEnding / userMessages.length) * 100 * weights.hasProperEnding;

        // Check word length consistency
        const wordLengths = userMessages.map(m =>
            m.content.split(/\s+/).reduce((sum, w) => sum + w.length, 0) /
            (m.content.split(/\s+/).length || 1)
        );
        const avgWordLength = wordLengths.reduce((sum, l) => sum + l, 0) / wordLengths.length;
        const wordLengthScore = avgWordLength >= 4 ? 100 : (avgWordLength / 4) * 100;
        score += wordLengthScore * weights.avgWordLength;

        // Check message word count
        const wordCounts = userMessages.map(m => m.content.split(/\s+/).length);
        const avgWordCount = wordCounts.reduce((sum, c) => sum + c, 0) / userMessages.length;
        const wordCountScore = Math.min(100, (avgWordCount / 10) * 100);
        score += wordCountScore * weights.wordCount;

        // Check consistency (similar message structure)
        const variance = wordCounts.length > 1
            ? Math.sqrt(wordCounts.reduce((sum, c) => sum + Math.pow(c - avgWordCount, 2), 0) / wordCounts.length)
            : 0;
        const consistencyScore = Math.max(0, 100 - (variance * 5));
        score += consistencyScore * weights.consistency;

        return Math.min(100, Math.round(score));
    }

    /**
     * Export conversation in multiple formats with comprehensive metadata
     * @param {string} userId - User identifier
     * @param {string} format - Export format: 'text', 'json', 'markdown', 'csv'
     * @returns {string} Formatted conversation export
     */
    exportConversation(userId, format = 'markdown') {
        const conversation = this.conversations.get(userId) || [];
        const stats = this.getStats(userId);

        if (format === 'json') {
            return JSON.stringify({
                metadata: {
                    userId,
                    exportedAt: new Date().toISOString(),
                    totalMessages: conversation.length,
                    ...stats
                },
                messages: conversation
            }, null, 2);
        }

        if (format === 'csv') {
            const header = 'Timestamp,Role,Intent,Confidence,Quality,Content\n';
            const rows = conversation.map(msg => {
                const timestamp = new Date(msg.timestamp).toISOString();
                const role = msg.role;
                const intent = msg.intent?.intent || '';
                const confidence = msg.intent?.confidence || '';
                const quality = msg.metadata?.quality?.score || '';
                const content = `"${msg.content.replace(/"/g, '""')}"`;
                return `${timestamp},${role},${intent},${confidence},${quality},${content}`;
            }).join('\n');
            return header + rows;
        }

        // Markdown format (default)
        let text = `# Conversation Export\n\n`;
        text += `**Generated:** ${new Date().toLocaleString()}\n`;
        text += `**Total Messages:** ${conversation.length}\n`;
        text += `**Quality Score:** ${stats.qualityScore}/100\n`;
        text += `**Most Frequent Intent:** ${stats.mostFrequentIntent || 'None'}\n\n`;

        text += `## Statistics\n\n`;
        text += `| Metric | Value |\n`;
        text += `|--------|-------|\n`;
        text += `| User Messages | ${stats.userMessages} |\n`;
        text += `| Assistant Messages | ${stats.assistantMessages} |\n`;
        text += `| Avg Message Length | ${Math.round(stats.avgMessageLength)} chars |\n`;
        text += `| Duration | ${Math.round(stats.conversationDuration / 1000)}s |\n\n`;

        text += `## Messages\n\n`;
        for (const msg of conversation) {
            const role = msg.role === 'user' ? '👤 **User**' : '🤖 **Assistant**';
            const intentTag = msg.intent ? ` \`[${msg.intent.intent}]\`` : '';
            const qualityTag = msg.metadata?.quality ? ` (Quality: ${msg.metadata.quality.score}/100)` : '';
            const timestamp = new Date(msg.timestamp).toLocaleTimeString();
            text += `${role}${intentTag} *(${timestamp})*${qualityTag}\n\n`;
            text += `${msg.content}\n\n`;
            text += `---\n\n`;
        }

        return text;
    }

    /**
     * Get detailed intent analysis for a conversation
     * @param {string} userId - User identifier
     * @returns {object} Intent analysis with distribution and patterns
     */
    getIntentAnalysis(userId) {
        const intents = this.intentHistory.get(userId) || [];

        if (intents.length === 0) {
            return {
                totalIntents: 0,
                uniqueIntents: 0,
                distribution: {},
                confidenceStats: {},
                patterns: []
            };
        }

        const distribution = {};
        const confidenceStats = {};

        for (const intent of intents) {
            distribution[intent.intent] = (distribution[intent.intent] || 0) + 1;

            if (!confidenceStats[intent.intent]) {
                confidenceStats[intent.intent] = { scores: [], avg: 0 };
            }
            confidenceStats[intent.intent].scores.push(
                { HIGH: 0.9, MEDIUM: 0.6, LOW: 0.3 }[intent.confidence] || 0
            );
        }

        // Calculate average confidence
        for (const intent of Object.keys(confidenceStats)) {
            const scores = confidenceStats[intent].scores;
            confidenceStats[intent].avg = (
                scores.reduce((a, b) => a + b, 0) / scores.length
            ).toFixed(2);
        }

        // Detect patterns
        const patterns = this.detectIntentPatterns(intents);

        return {
            totalIntents: intents.length,
            uniqueIntents: Object.keys(distribution).length,
            distribution,
            confidenceStats,
            patterns,
            timeline: intents.slice(-10).map(i => ({ intent: i.intent, time: new Date(i.timestamp).toLocaleTimeString() }))
        };
    }

    /**
     * Detect patterns in intent sequence
     * @param {array} intents - Array of intent classifications
     * @returns {array} Detected patterns
     */
    detectIntentPatterns(intents) {
        const patterns = [];

        if (intents.length < 2) return patterns;

        // Check for repeating sequences
        for (let i = 0; i < intents.length - 1; i++) {
            for (let j = i + 1; j < intents.length - 1; j++) {
                if (intents[i].intent === intents[j].intent &&
                    intents[i + 1].intent === intents[j + 1].intent) {
                    patterns.push({
                        pattern: `${intents[i].intent} → ${intents[i + 1].intent}`,
                        occurrences: 2,
                        type: 'sequence'
                    });
                }
            }
        }

        return patterns.filter((p, idx, arr) => arr.findIndex(a => a.pattern === p.pattern) === idx).slice(0, 5);
    }

    /**
     * Clear specific user conversation
     */
    clearConversation(userId) {
        this.conversations.delete(userId);
        this.contextCache.delete(userId);
    }

    /**
     * Clear all conversations
     */
    clearAll() {
        this.conversations.clear();
        this.contextCache.clear();
    }
}

export const conversationMemory = new ConversationMemory(15);
