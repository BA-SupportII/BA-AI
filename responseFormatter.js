/**
 * Response Formatter - Convert text responses to formatted tables/lists
 * Makes data more readable and visually appealing
 */

export class ResponseFormatter {
  /**
   * Detect if response contains tabular data and format it
   */
  static formatResponse(text) {
    if (this.hasChartPattern(text)) {
      const chart = this.extractAndFormatChart(text);
      if (chart.type === "chart") return chart;
    }

    // Try to detect and format tables
    if (this.hasTablePattern(text)) {
      return this.extractAndFormatTable(text);
    }

    // Try to detect rankings BEFORE lists (rankings are more specific)
    const hasRanking = this.hasRankingPattern(text);
    console.log('[FORMATTER] hasRankingPattern:', hasRanking);
    if (hasRanking) {
      const result = this.extractAndFormatRanking(text);
      console.log('[FORMATTER] Ranking extraction result:', result.type, 'items:', result.items?.length);
      return result;
    }

    // Try to detect and format lists
    if (this.hasListPattern(text)) {
      return this.extractAndFormatList(text);
    }

    // Return original if no patterns match
    return { type: 'text', content: text };
  }

  /**
   * Check if text contains table-like patterns
   */
  static hasTablePattern(text) {
    // Look for patterns like "Country | Value" or structured data
    return /\|.*\|/m.test(text) || /\d+\.\s+\w+.*:.*\d+/m.test(text);
  }

  /**
   * Check if text contains chart json patterns
   */
  static hasChartPattern(text) {
    return /CHART_JSON\s*:/i.test(text);
  }

  /**
   * Check if text contains list patterns
   */
  static hasListPattern(text) {
    // Look for numbered lists or bullet points
    return /^\d+[\.\)]\s+/m.test(text) || /^[-•*]\s+/m.test(text);
  }

  /**
   * Check if text contains ranking patterns
   */
  static hasRankingPattern(text) {
    // Check for explicit numbered ranking: "1. Country ... 2. Country ..."
    if (/\b[1-9][\.\)]\s+.+?((?:\n|,|\s+(?:and|or))\s*[2-9][\.\)]\s+.+?){1,}/i.test(text)) {
      return true;
    }
    
    // Check for implicit ranking in prose (keywords + country/entity names)
    // e.g., "United States and Russia are at the top"
    const hasRankKeywords = /\b(rank|ranking|top|leader|first|second|third|leading|follows|rank)/i.test(text);
    const hasCountries = /\b(United States|Russia|China|France|UK|India|Pakistan|Israel|Germany|Japan|Brazil)\b/i.test(text);
    const hasNumbers = /\b\d+\s*(warhead|nuclear|arsenal|inventory|weapon|bomb)/i.test(text);
    
    return hasRankKeywords && (hasCountries || hasNumbers);
  }

  /**
   * Extract and format table from text
   */
  static extractAndFormatTable(text) {
    const lines = text.split('\n').filter(l => l.trim());
    const tableData = [];

    for (const line of lines) {
      // Check for pipe-separated format
      if (line.includes('|')) {
        const cells = line.split('|').map(c => c.trim()).filter(c => c);
        if (cells.length > 1) {
          tableData.push(cells);
        }
      }
    }

    if (tableData.length > 0) {
      return {
        type: 'table',
        headers: tableData[0],
        rows: tableData.slice(1),
        content: text
      };
    }

    return { type: 'text', content: text };
  }

  /**
   * Extract chart data from text
   */
  static extractAndFormatChart(text) {
    const marker = /CHART_JSON\s*:\s*([\s\S]+)$/i;
    const match = text.match(marker);
    if (!match) return { type: "text", content: text };
    const raw = match[1].trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { type: "text", content: text };
    try {
      const chart = JSON.parse(jsonMatch[0]);
      if (!chart || !Array.isArray(chart.data)) {
        return { type: "text", content: text };
      }
      return { type: "chart", chart, content: text };
    } catch (err) {
      return { type: "text", content: text };
    }
  }

  /**
   * Extract and format list from text
   */
  static extractAndFormatList(text) {
    const lines = text.split('\n').filter(l => l.trim());
    const items = [];

    for (const line of lines) {
      // Remove list markers
      const cleaned = line.replace(/^[\d]+[\.\)]\s+|^[-•*]\s+/, '').trim();
      if (cleaned) {
        items.push(cleaned);
      }
    }

    if (items.length > 0) {
      return {
        type: 'list',
        items,
        content: text
      };
    }

    return { type: 'text', content: text };
  }

  /**
   * Extract and format ranking from text
   */
  static extractAndFormatRanking(text) {
    // Try both strict and flexible patterns
    let rankPattern = /^(\d+)[\.\)]\s+(.+?):\s*(.+?)$/gm;
    const rankings = [];
    let match;

    // First try strict pattern
    while ((match = rankPattern.exec(text)) !== null) {
      rankings.push({
        rank: parseInt(match[1]),
        name: match[2].trim(),
        value: match[3].trim()
      });
    }

    // If no matches, try flexible pattern for embedded rankings
    if (rankings.length === 0) {
      rankPattern = /(\d+)[\.\)]\s+([A-Z][^:\n]*?)(?:\s*[-–]\s*|:\s*)([^.\n]+(?:\.[^.\n]*)?)/g;
      while ((match = rankPattern.exec(text)) !== null) {
        const rank = parseInt(match[1]);
        if (rank <= 20) { // Only consider first 20 rankings
          rankings.push({
            rank: rank,
            name: match[2].trim(),
            value: match[3].trim()
          });
        }
      }
    }

    // If still no matches, try pipe-separated format (Rank | Name | Value)
    if (rankings.length === 0) {
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.includes('|')) {
          const parts = line.split('|').map(p => p.trim());
          if (parts.length >= 2 && /^\d+/.test(parts[0])) {
            const rank = parseInt(parts[0]);
            if (rank <= 100) {
              rankings.push({
                rank: rank,
                name: parts[1] || '',
                value: parts.slice(2).join(' - ') || ''
              });
            }
          }
        }
      }
    }

    // If still no matches, try extracting from prose (e.g., "United States and Russia are at the top")
    if (rankings.length === 0) {
      rankings.push(...this.extractProseRankings(text));
    }

    if (rankings.length > 0) {
      // Sort by rank
      rankings.sort((a, b) => a.rank - b.rank);
      return {
        type: 'ranking',
        items: rankings,
        content: text
      };
    }

    return { type: 'text', content: text };
  }

  /**
   * Extract rankings from prose text (without explicit numbering)
   */
  static extractProseRankings(text) {
    const rankings = [];
    const countryOrder = [
      'United States', 'Russia', 'China', 'France', 
      'United Kingdom', 'India', 'Pakistan', 'Israel',
      'Germany', 'Japan', 'Brazil', 'North Korea'
    ];
    
    // Look for mentions of these countries in order
    let rank = 1;
    for (const country of countryOrder) {
      if (text.includes(country)) {
        // Try to extract warhead count if mentioned
        const countPattern = new RegExp(`${country}[^.]*?(\\d+)\\s*(warhead|nuclear|arsenal|weapon)`, 'i');
        const countMatch = text.match(countPattern);
        const value = countMatch ? `~${countMatch[1]} warheads` : 'Nuclear-armed state';
        
        rankings.push({
          rank: rank++,
          name: country,
          value: value
        });
        
        if (rank > 10) break; // Limit to top 10
      }
    }
    
    return rankings;
  }

  /**
   * Generate HTML for formatted response
   */
  static toHTML(formatted) {
    if (formatted.type === 'table') {
      return this.tableToHTML(formatted);
    } else if (formatted.type === 'list') {
      return this.listToHTML(formatted);
    } else if (formatted.type === 'ranking') {
      return this.rankingToHTML(formatted);
    } else if (formatted.type === 'chart') {
      return this.chartToHTML(formatted.chart);
    }
    return `<p>${this.escapeHtml(formatted.content)}</p>`;
  }

  /**
   * Convert table to HTML with light mode styling
   */
  static tableToHTML(data) {
    const headerCells = data.headers
      .map(h => `<th>${this.escapeHtml(h)}</th>`)
      .join('');
    
    const rowsHTML = data.rows
      .map(row => {
        const cells = row
          .map(cell => `<td>${this.escapeHtml(cell)}</td>`)
          .join('');
        return `<tr>${cells}</tr>`;
      })
      .join('');

    return `
      <table class="formatted-table">
        <thead>
          <tr>${headerCells}</tr>
        </thead>
        <tbody>
          ${rowsHTML}
        </tbody>
      </table>
    `;
  }

  /**
   * Convert list to HTML with light mode styling
   */
  static listToHTML(data) {
    const items = data.items
      .map(item => `<li>${this.escapeHtml(item)}</li>`)
      .join('');

    return `<ul class="formatted-list">${items}</ul>`;
  }

  /**
   * Convert ranking to HTML with light mode styling
   */
  static rankingToHTML(data) {
    const items = data.items
      .map(item => `
        <div class="ranking-item">
          <span class="ranking-badge">${item.rank}</span>
          <span class="ranking-name">${this.escapeHtml(item.name)}</span>
          <span class="ranking-value">${this.escapeHtml(item.value)}</span>
        </div>
      `)
      .join('');

    return `<div class="formatted-ranking">${items}</div>`;
  }

  /**
   * Render a simple SVG bar chart
   */
  static chartToHTML(chart) {
    const data = Array.isArray(chart.data) ? chart.data : [];
    const title = chart.title ? this.escapeHtml(chart.title) : "";
    const series = Array.isArray(chart.series) ? chart.series : null;
    const labels = Array.isArray(chart.labels) ? chart.labels : null;
    const colors = ["#2563eb", "#16a34a", "#f97316", "#8b5cf6", "#14b8a6"];
    const type = String(chart.type || "bar").toLowerCase();

    if (type === "pie") {
      const total = data.reduce((sum, item) => sum + (Number(item.value) || 0), 0) || 1;
      let current = 0;
      const gradient = data
        .map((item, index) => {
          const value = Number(item.value) || 0;
          const start = (current / total) * 360;
          const end = ((current + value) / total) * 360;
          current += value;
          return `${colors[index % colors.length]} ${start}deg ${end}deg`;
        })
        .join(", ");
      const legend = data
        .map((item, index) => `
          <div class="chart-legend-item">
            <span class="chart-legend-swatch" style="background:${colors[index % colors.length]}"></span>
            <span>${this.escapeHtml(String(item.label ?? `Item ${index + 1}`))}</span>
          </div>
        `)
        .join("");
      return `
        <div class="chart-block">
          ${title ? `<div class="chart-title">${title}</div>` : ""}
          <div class="chart-pie">
            <div class="chart-pie-circle" style="background: conic-gradient(${gradient});"></div>
            <div class="chart-legend">${legend}</div>
          </div>
        </div>
      `;
    }

    if (type === "line") {
      const resolvedSeries = series && series.length > 0
        ? series
        : [{ name: "Series 1", data: data.map((item) => Number(item.value) || 0) }];
      const labelCount = Math.max(...resolvedSeries.map((s) => (Array.isArray(s.data) ? s.data.length : 0)), 0);
      const resolvedLabels = labels && labels.length >= labelCount
        ? labels
        : Array.from({ length: labelCount }, (_, i) => `Item ${i + 1}`);
      const maxValue = resolvedSeries.reduce((max, s) => {
        const values = Array.isArray(s.data) ? s.data : [];
        return Math.max(max, ...values.map((v) => Number(v) || 0));
      }, 0) || 1;
      const width = 600;
      const height = 200;
      const padding = 24;
      const toPoint = (value, index) => {
        const x = padding + (index / Math.max(1, resolvedLabels.length - 1)) * (width - padding * 2);
        const y = height - padding - (value / maxValue) * (height - padding * 2);
        return `${x},${y}`;
      };
      const lines = resolvedSeries
        .map((s, idx) => {
          const values = Array.isArray(s.data) ? s.data : [];
          const points = values.map((val, i) => toPoint(Number(val) || 0, i)).join(" ");
          return `<polyline fill="none" stroke="${colors[idx % colors.length]}" stroke-width="2" points="${points}" />`;
        })
        .join("");
      const legend = resolvedSeries
        .map((s, idx) => `
          <div class="chart-legend-item">
            <span class="chart-legend-swatch" style="background:${colors[idx % colors.length]}"></span>
            <span>${this.escapeHtml(String(s.name || `Series ${idx + 1}`))}</span>
          </div>
        `)
        .join("");
      return `
        <div class="chart-block">
          ${title ? `<div class="chart-title">${title}</div>` : ""}
          <div class="chart-legend">${legend}</div>
          <div class="chart-line">
            <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
              ${lines}
            </svg>
          </div>
        </div>
      `;
    }

    if (series && series.length > 0) {
      const maxValue = series.reduce((max, s) => {
        const values = Array.isArray(s.data) ? s.data : [];
        return Math.max(max, ...values.map((v) => Number(v) || 0));
      }, 0) || 1;
      const labelCount = Math.max(...series.map((s) => (Array.isArray(s.data) ? s.data.length : 0)), 0);
      const resolvedLabels = labels && labels.length >= labelCount
        ? labels
        : Array.from({ length: labelCount }, (_, i) => `Item ${i + 1}`);
      const legend = series
        .map((s, idx) => `
          <div class="chart-legend-item">
            <span class="chart-legend-swatch" style="background:${colors[idx % colors.length]}"></span>
            <span>${this.escapeHtml(String(s.name || `Series ${idx + 1}`))}</span>
          </div>
        `)
        .join("");
      const groups = resolvedLabels
        .map((label, labelIdx) => {
          const rows = series
            .map((s, seriesIdx) => {
              const values = Array.isArray(s.data) ? s.data : [];
              const value = Number(values[labelIdx]) || 0;
              const width = Math.round((value / maxValue) * 100);
              return `
                <div class="chart-series-bar">
                  <span class="chart-series-name">${this.escapeHtml(String(s.name || `Series ${seriesIdx + 1}`))}</span>
                  <div class="chart-bar">
                    <div class="chart-bar-fill" style="width:${width}%; background:${colors[seriesIdx % colors.length]}"></div>
                  </div>
                  <span class="chart-value">${value}</span>
                </div>
              `;
            })
            .join("");
          return `
            <div class="chart-group">
              <div class="chart-group-label">${this.escapeHtml(String(label))}</div>
              <div class="chart-group-bars">${rows}</div>
            </div>
          `;
        })
        .join("");
      return `
        <div class="chart-block">
          ${title ? `<div class="chart-title">${title}</div>` : ""}
          <div class="chart-legend">${legend}</div>
          ${groups || "<div>No chart data.</div>"}
        </div>
      `;
    }

    const maxValue = data.reduce((max, item) => Math.max(max, Number(item.value) || 0), 0) || 1;
    const bars = data
      .map((item, index) => {
        const label = this.escapeHtml(String(item.label ?? `Item ${index + 1}`));
        const value = Number(item.value) || 0;
        const width = Math.round((value / maxValue) * 100);
        return `
          <div class="chart-row">
            <span class="chart-label">${label}</span>
            <div class="chart-bar">
              <div class="chart-bar-fill" style="width:${width}%"></div>
            </div>
            <span class="chart-value">${value}</span>
          </div>
        `;
      })
      .join("");

    return `
      <div class="chart-block">
        ${title ? `<div class="chart-title">${title}</div>` : ""}
        ${bars || "<div>No chart data.</div>"}
      </div>
    `;
  }

  /**
   * Escape HTML special characters
   */
  static escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }
}
