/**
 * Reasoning Engine - Show AI's thinking process in phases
 * Makes AI transparent like ChatGPT o1
 */

export class ReasoningEngine {
  /**
   * Generate reasoning phases for a prompt
   * Optimized for complexity: skip unnecessary phases for simple tasks
   */
  static generatePhases(prompt, intent, requiresWeb, complexity = null) {
    const phases = [];
    
    // OPTIMIZATION: Skip phases for trivial math problems
    if (intent === 'MATH_REASONING' && complexity === 'TRIVIAL') {
      console.log('[OPTIMIZATION] Skipping phases for trivial math problem');
      return [{
        phase: 'INSTANT_CALC',
        action: 'Computing result...',
        emoji: '⚡',
        duration: 50
      }];
    }
    
    // OPTIMIZATION: Reduce phases for simple math
    if (intent === 'MATH_REASONING' && complexity === 'SIMPLE') {
      console.log('[OPTIMIZATION] Reducing phases for simple math problem');
      phases.push({
        phase: 'SETUP',
        action: 'Setting up the equation...',
        emoji: '📐',
        duration: 75 + Math.random() * 50
      });
      
      phases.push({
        phase: 'SOLVE',
        action: 'Computing result...',
        emoji: '✓',
        duration: 75 + Math.random() * 50
      });
      
      return phases;
    }
    
    // OPTIMIZATION: Single phase for SIMPLE_QA (no web search needed, instant local answer)
    if (intent === 'SIMPLE_QA') {
      console.log('[OPTIMIZATION] Single phase for simple Q&A');
      return [{
        phase: 'THINKING',
        action: 'Processing your question...',
        emoji: '💭',
        duration: 100 + Math.random() * 50
      }];
    }
    
    // DEFAULT: Full phases for complex problems
    
    // Phase 1: Understanding
    phases.push({
      phase: 'UNDERSTANDING',
      action: `Analyzing your question about ${extractMainTopic(prompt)}...`,
      emoji: '🧠',
      duration: 150 + Math.random() * 100
    });
    
    // Phase 2: Planning
    phases.push({
      phase: 'PLANNING',
      action: `Planning approach for ${intent} task...`,
      emoji: '📋',
      duration: 150 + Math.random() * 100
    });
    
    // Phase 3: Research (if web search needed)
    if (requiresWeb) {
      phases.push({
        phase: 'RESEARCH',
        action: 'Searching web for latest information...',
        emoji: '🔍',
        duration: 2000 + Math.random() * 3000
      });
    }
    
    // Phase 4: Reasoning
    phases.push({
      phase: 'REASONING',
      action: `Reasoning through the solution...`,
      emoji: '⚙️',
      duration: 150 + Math.random() * 100
    });
    
    // Phase 5: Generating
    phases.push({
      phase: 'GENERATING',
      action: 'Generating response...',
      emoji: '✍️',
      duration: 150 + Math.random() * 100
    });
    
    return phases;
  }

  /**
   * Stream reasoning phases to WebSocket
   */
  static async streamPhases(ws, phases) {
    for (const phase of phases) {
      ws.send(JSON.stringify({
        type: 'reasoning_phase',
        data: {
          phase: phase.phase,
          action: phase.action,
          emoji: phase.emoji
        }
      }));
      
      // Small delay between phases (actual thinking happens in background)
      await new Promise(r => setTimeout(r, 100));
    }
  }

  /**
   * Get strategy for intent
   */
  static getStrategy(intent) {
    const strategies = {
      'CODE_TASK': 'Analyze → Break down problem → Write code → Test',
      'MATH_REASONING': 'Understand → Setup equation → Calculate → Verify',
      'DATA_ANALYSIS': 'Parse data → Identify patterns → Query → Visualize',
      'DECISION_MAKING': 'Gather info → List options → Weigh pros/cons → Recommend',
      'LEARNING': 'Research → Structure → Explain simply → Provide examples',
      'WORLD_KNOWLEDGE': 'Search latest → Synthesize → Contextualize → Answer',
      'CREATIVE': 'Brainstorm → Outline → Draft → Refine',
      'MULTI_STEP': 'Plan → Research → Code → Execute → Verify'
    };
    return strategies[intent] || 'Understand → Analyze → Respond';
  }

  /**
   * Extract main topic from prompt
   */
  static getMainTopic(prompt) {
    return extractMainTopic(prompt);
  }
}

/**
 * Helper: Extract main topic from prompt
 */
function extractMainTopic(prompt) {
  // Simple extraction: get first 3-4 words or up to first punctuation
  const words = prompt
    .toLowerCase()
    .split(/[\s.?!]+/)
    .filter(w => w.length > 0)
    .slice(0, 4);
  return words.join(' ');
}
