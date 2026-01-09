/**
 * Multi-Step Problem Solver - Break complex questions into manageable steps
 * Solves step-by-step with feedback
 */

import { classifyIntent } from './intentClassifier.js';

export class MultiStepSolver {
  /**
   * Detect if question requires multi-step solving
   */
  static detectComplexQuery(prompt) {
    const complexKeywords = [
      'build', 'create', 'design', 'implement', 'develop',
      'plan', 'strategy', 'architecture', 'system',
      'step by step', 'how to', 'guide me through',
      'multiple', 'combination', 'integrate'
    ];

    const hasComplexKeyword = complexKeywords.some(kw => 
      prompt.toLowerCase().includes(kw)
    );

    const isLongPrompt = prompt.length > 150;
    const hasMultipleSentences = (prompt.match(/[.!?]/g) || []).length > 2;

    return hasComplexKeyword && (isLongPrompt || hasMultipleSentences);
  }

  /**
   * Break complex query into steps
   */
  static breakDownQuery(prompt) {
    const steps = [];

    // Analyze prompt to identify steps
    if (prompt.toLowerCase().includes('build') || prompt.toLowerCase().includes('create')) {
      steps.push({
        order: 1,
        title: 'Understand Requirements',
        prompt: `What are the key requirements for: ${prompt}? List the main components or features needed.`,
        type: 'analysis'
      });

      steps.push({
        order: 2,
        title: 'Plan Architecture',
        prompt: `Based on the requirements, outline the architecture and structure needed.`,
        type: 'planning'
      });

      steps.push({
        order: 3,
        title: 'Design Solution',
        prompt: `Design the detailed solution with code/diagrams. ${prompt}`,
        type: 'implementation'
      });

      steps.push({
        order: 4,
        title: 'Explain & Optimize',
        prompt: `Explain the solution and suggest optimizations or improvements.`,
        type: 'review'
      });
    } else if (prompt.toLowerCase().includes('analyze')) {
      steps.push({
        order: 1,
        title: 'Identify Key Metrics',
        prompt: `What metrics and dimensions are relevant for analyzing: ${prompt}?`,
        type: 'analysis'
      });

      steps.push({
        order: 2,
        title: 'Gather Data Insights',
        prompt: `Analyze the data and identify key patterns and trends.`,
        type: 'analysis'
      });

      steps.push({
        order: 3,
        title: 'Generate Insights',
        prompt: `Based on the analysis, what are the key insights and findings?`,
        type: 'synthesis'
      });

      steps.push({
        order: 4,
        title: 'Recommendations',
        prompt: `Provide actionable recommendations based on the analysis.`,
        type: 'recommendation'
      });
    } else if (prompt.toLowerCase().includes('how to')) {
      steps.push({
        order: 1,
        title: 'Overview & Context',
        prompt: `Briefly explain what we're trying to accomplish: ${prompt}`,
        type: 'context'
      });

      steps.push({
        order: 2,
        title: 'Prerequisites',
        prompt: `What do you need before starting?`,
        type: 'preparation'
      });

      steps.push({
        order: 3,
        title: 'Step-by-Step Instructions',
        prompt: `Provide detailed step-by-step instructions for: ${prompt}`,
        type: 'instructions'
      });

      steps.push({
        order: 4,
        title: 'Tips & Troubleshooting',
        prompt: `What are common pitfalls and how to avoid them?`,
        type: 'support'
      });
    } else {
      // Generic breakdown
      steps.push({
        order: 1,
        title: 'Understanding',
        prompt: `Understand and clarify: ${prompt}`,
        type: 'analysis'
      });

      steps.push({
        order: 2,
        title: 'Analysis',
        prompt: `Analyze and break down the key components.`,
        type: 'analysis'
      });

      steps.push({
        order: 3,
        title: 'Solution',
        prompt: `Provide the solution or answer.`,
        type: 'solution'
      });

      steps.push({
        order: 4,
        title: 'Summary',
        prompt: `Summarize and provide final thoughts.`,
        type: 'summary'
      });
    }

    return steps;
  }

  /**
   * Create execution plan
   */
  static createExecutionPlan(prompt) {
    const isComplex = this.detectComplexQuery(prompt);

    if (!isComplex) {
      return {
        type: 'simple',
        steps: [{
          order: 1,
          title: 'Answer',
          prompt,
          type: 'direct'
        }]
      };
    }

    const steps = this.breakDownQuery(prompt);

    return {
      type: 'multi-step',
      totalSteps: steps.length,
      steps,
      estimatedTime: steps.length * 10 + 's',
      originalPrompt: prompt
    };
  }

  /**
   * Format step presentation
   */
  static formatStepPresentation(step, stepNumber, totalSteps) {
    return {
      stepNumber,
      totalSteps,
      title: step.title,
      description: this.getStepDescription(step.type),
      prompt: step.prompt,
      type: step.type
    };
  }

  /**
   * Get user-friendly step description
   */
  static getStepDescription(type) {
    const descriptions = {
      'analysis': 'Analyzing the problem...',
      'planning': 'Planning the approach...',
      'implementation': 'Implementing the solution...',
      'review': 'Reviewing and optimizing...',
      'synthesis': 'Synthesizing findings...',
      'recommendation': 'Generating recommendations...',
      'context': 'Providing context...',
      'preparation': 'Identifying requirements...',
      'instructions': 'Creating instructions...',
      'support': 'Adding guidance...',
      'direct': 'Processing your request...',
      'solution': 'Solving the problem...',
      'summary': 'Creating summary...'
    };

    return descriptions[type] || 'Processing...';
  }

  /**
   * Combine step results
   */
  static combineResults(stepResults) {
    return {
      executedAt: new Date().toISOString(),
      totalStepsCompleted: stepResults.length,
      totalDuration: stepResults.reduce((sum, r) => sum + (r.duration || 0), 0),
      results: stepResults.map((result, idx) => ({
        stepNumber: idx + 1,
        title: result.title,
        content: result.content,
        duration: result.duration
      })),
      finalAnswer: this.synthesizeFinalAnswer(stepResults)
    };
  }

  /**
   * Synthesize final answer from all steps
   */
  static synthesizeFinalAnswer(stepResults) {
    if (stepResults.length === 0) return '';

    // Return the last substantive result
    for (let i = stepResults.length - 1; i >= 0; i--) {
      if (stepResults[i].content && stepResults[i].content.length > 50) {
        return stepResults[i].content;
      }
    }

    // If no substantive result, combine all
    return stepResults
      .map(r => r.content)
      .filter(c => c && c.length > 0)
      .join('\n\n');
  }

  /**
   * Format multi-step response for UI
   */
  static formatForUI(executionPlan, stepResults) {
    return {
      type: 'multi-step',
      planType: executionPlan.type,
      steps: executionPlan.steps.map((step, idx) => ({
        order: step.order,
        title: step.title,
        status: stepResults[idx] ? 'completed' : 'pending',
        result: stepResults[idx]?.content || null,
        duration: stepResults[idx]?.duration || null
      })),
      summary: {
        totalSteps: executionPlan.steps.length,
        completedSteps: stepResults.length,
        totalDuration: stepResults.reduce((sum, r) => sum + (r.duration || 0), 0),
        progress: Math.floor((stepResults.length / executionPlan.steps.length) * 100)
      }
    };
  }
}

export default MultiStepSolver;
