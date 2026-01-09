/**
 * Web Synthesizer - Parse and format web search results
 * Converts raw web data into structured, readable format
 */

export class WebSynthesizer {
  /**
   * Synthesize web results into formatted response
   */
  static synthesizeResults(webResults, prompt) {
    if (!webResults || webResults.length === 0) {
      return null;
    }

    // Detect what kind of data the user is looking for
    const dataType = this.detectDataType(prompt);

    let synthesis = '';

    switch (dataType) {
      case 'ranking':
        synthesis = this.synthesizeRanking(webResults, prompt);
        break;
      case 'comparison':
        synthesis = this.synthesizeComparison(webResults, prompt);
        break;
      case 'factual':
        synthesis = this.synthesizeFactual(webResults, prompt);
        break;
      default:
        synthesis = this.synthesizeGeneral(webResults);
    }

    return synthesis;
  }

  /**
   * Detect what type of data user wants
   */
  static detectDataType(prompt) {
    const lower = prompt.toLowerCase();
    
    if (/rank|top|best|worst|list/.test(lower)) {
      return 'ranking';
    } else if (/compare|vs|versus|difference|better/.test(lower)) {
      return 'comparison';
    } else if (/how many|how much|statistics|data|number/.test(lower)) {
      return 'factual';
    }
    return 'general';
  }

  /**
   * Synthesize ranking data from web results
   */
  static synthesizeRanking(webResults, prompt) {
    const rankings = [];

    for (let i = 0; i < Math.min(webResults.length, 10); i++) {
      const result = webResults[i];
      // Extract top-level ranking items from title/snippet
      rankings.push({
        rank: i + 1,
        name: this.extractMainEntity(result.title),
        info: result.snippet || result.title
      });
    }

    // Format as table-friendly output
    return rankings
      .map(r => `${r.rank}. ${r.name}: ${r.info}`)
      .join('\n\n');
  }

  /**
   * Synthesize comparison data
   */
  static synthesizeComparison(webResults, prompt) {
    if (webResults.length < 2) {
      return this.synthesizeGeneral(webResults);
    }

    const entity1 = this.extractMainEntity(webResults[0].title);
    const entity2 = webResults.length > 1 
      ? this.extractMainEntity(webResults[1].title)
      : 'Alternative';

    let synthesis = `**Comparison: ${entity1} vs ${entity2}**\n\n`;
    
    synthesis += `**${entity1}:**\n`;
    synthesis += `- ${webResults[0].snippet}\n\n`;
    
    if (webResults.length > 1) {
      synthesis += `**${entity2}:**\n`;
      synthesis += `- ${webResults[1].snippet}\n\n`;
    }

    if (webResults.length > 2) {
      synthesis += `**Additional Context:**\n`;
      for (let i = 2; i < Math.min(webResults.length, 4); i++) {
        synthesis += `- ${webResults[i].snippet}\n`;
      }
    }

    return synthesis;
  }

  /**
   * Synthesize factual/statistical data
   */
  static synthesizeFactual(webResults, prompt) {
    const facts = [];

    for (const result of webResults.slice(0, 5)) {
      // Extract numbers from snippet
      const numbers = result.snippet.match(/\d+[,.]?\d*/g) || [];
      facts.push({
        title: result.title,
        snippet: result.snippet,
        stats: numbers.slice(0, 3)
      });
    }

    let synthesis = '';
    for (const fact of facts) {
      synthesis += `**${fact.title}**\n`;
      synthesis += `${fact.snippet}\n`;
      if (fact.stats.length > 0) {
        synthesis += `*Key numbers: ${fact.stats.join(', ')}*\n\n`;
      }
    }

    return synthesis;
  }

  /**
   * General synthesis of web results
   */
  static synthesizeGeneral(webResults) {
    return webResults
      .slice(0, 5)
      .map((result, idx) => {
        return `**${idx + 1}. ${result.title}**\n${result.snippet}`;
      })
      .join('\n\n');
  }

  /**
   * Extract main entity from title
   */
  static extractMainEntity(title) {
    // Remove common suffixes and clean up
    return title
      .replace(/\s*[-–|]\s*.*/i, '')
      .replace(/\s*\(.*\)/g, '')
      .trim();
  }

  /**
   * Format web results as markdown table
   */
  static toMarkdownTable(webResults) {
    if (webResults.length === 0) return '';

    let markdown = '| # | Title | Snippet |\n';
    markdown += '|---|-------|----------|\n';

    for (let i = 0; i < Math.min(webResults.length, 10); i++) {
      const result = webResults[i];
      const title = this.escapeMarkdown(result.title);
      const snippet = this.escapeMarkdown(result.snippet.substring(0, 100) + '...');
      markdown += `| ${i + 1} | ${title} | ${snippet} |\n`;
    }

    return markdown;
  }

  /**
   * Escape markdown special characters
   */
  static escapeMarkdown(text) {
    return text.replace(/[|`*[\]]/g, '\\$&');
  }
}
