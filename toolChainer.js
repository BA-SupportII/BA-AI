/**
 * Tool Auto-Chaining - Execute multiple tools in sequence
 * Detects what tools are needed and chains them automatically
 */

export class ToolChainer {
  /**
   * Detect what tools are needed based on intent and prompt
   */
  static detectRequiredTools(intent, prompt) {
    const lower = prompt.toLowerCase();
    const tools = [];
    
    // Check for web search need
    if (/latest|current|news|trending|2025|recent|happening/.test(lower)) {
      tools.push('web_search');
    }
    
    // Check for code execution need
    if (/code|python|javascript|execute|run|example|script/.test(lower)) {
      tools.push('code_execute');
    }
    
    // Check for SQL/data need
    if (/sql|query|data|database|analyze|statistics/.test(lower)) {
      tools.push('sql_query');
    }
    
    // Check for math/calculation
    if (/calculate|compute|solve|equation|math|percentage/.test(lower)) {
      tools.push('python_execute');
    }

    if (/chart|graph|plot|visualize|visualisation/.test(lower)) {
      tools.push('visualize');
    }
    
    return tools;
  }

  /**
   * Plan tool chain for this request
   */
  static planChain(intent, prompt, detectedTools) {
    const chains = {
      'WORLD_KNOWLEDGE': ['web_search'],
      'CODE_TASK': ['code_execute'],
      'MATH_REASONING': ['python_execute'],
      'SQL_QUERY': ['sql_schema', 'sql_query'],
      'DATA_ANALYSIS': ['sql_query', 'python_execute', 'visualize'],
      'DECISION_MAKING': ['web_search'],
      'LEARNING': ['web_search', 'code_execute'],
      'SYSTEM_DESIGN': ['web_search', 'visualize'],
      'VISUALIZATION': ['visualize'],
      'MULTI_STEP': ['web_search', 'code_execute', 'sql_query', 'visualize'],
    };
    
    // Use intent-based chain or auto-detected tools
    const chain = chains[intent] || detectedTools;
    return this.deduplicateChain(chain);
  }

  /**
   * Remove duplicate tools, maintain order
   */
  static deduplicateChain(tools) {
    return [...new Set(tools)];
  }

  /**
   * Build execution plan with order
   */
  static buildExecutionPlan(tools) {
    const plan = [];
    
    for (const tool of tools) {
      plan.push({
        tool,
        status: 'pending',
        result: null,
        error: null,
        startTime: null,
        endTime: null,
        duration: 0
      });
    }
    
    return plan;
  }

  /**
   * Check if response contains tool calls
   */
  static extractToolCalls(response) {
    // Look for patterns like /python, /sql, /search in response
    const toolPattern = /\/(\w+)/g;
    const matches = response.matchAll(toolPattern);
    const tools = [];
    
    for (const match of matches) {
      const toolName = match[1].toLowerCase();
      if (['python', 'sql', 'search', 'code', 'execute'].includes(toolName)) {
        tools.push(toolName);
      }
    }
    
    return [...new Set(tools)];
  }

  /**
   * Should auto-chain for this intent?
   */
  static shouldAutoChain(intent) {
    const autoChainIntents = [
      'WORLD_KNOWLEDGE',
      'LEARNING',
      'MULTI_STEP',
      'DATA_ANALYSIS',
      'DECISION_MAKING'
    ];
    return autoChainIntents.includes(intent);
  }
}

/**
 * Tool Executor - Execute tools in sequence
 */
export class ToolExecutor {
  constructor(tools) {
    this.tools = tools; // Map of tool implementations
  }

  /**
   * Execute a single tool
   */
  async executeTool(toolName, input, previousResults = {}) {
    const tool = this.tools[toolName];
    if (!tool) {
      throw new Error(`Tool not found: ${toolName}`);
    }

    try {
      const startTime = Date.now();
      const result = await tool.execute(input, previousResults);
      const duration = Date.now() - startTime;
      
      return {
        success: true,
        result,
        duration,
        tool: toolName
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        tool: toolName
      };
    }
  }

  /**
   * Execute chain of tools
   */
  async executeChain(tools, input) {
    const results = {};
    const timeline = [];
    
    for (const toolName of tools) {
      const execution = await this.executeTool(toolName, input, results);
      
      timeline.push({
        tool: toolName,
        duration: execution.duration,
        success: execution.success
      });
      
      if (execution.success) {
        results[toolName] = execution.result;
      } else {
        console.error(`Tool ${toolName} failed:`, execution.error);
      }
    }
    
    return { results, timeline };
  }
}
