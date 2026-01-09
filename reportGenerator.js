/**
 * Report Generator - Async heavy analysis for dashboard data
 * Runs in background, emails results when complete
 */

import { streamOllamaGenerate } from './ollamaClient.js';

export class ReportGenerator {
  constructor() {
    this.activeReports = new Map();
    this.reportHistory = [];
  }

  /**
   * Generate comprehensive report asynchronously
   */
  async generateReportAsync(options) {
    const {
      reportId,
      prompt,
      data,
      model = 'qwen3',
      userId,
      onProgress,
      onComplete
    } = options;

    this.activeReports.set(reportId, {
      status: 'generating',
      progress: 0,
      startTime: Date.now(),
      userId
    });

    try {
      onProgress?.({ status: 'starting', progress: 5 });

      // Build comprehensive analysis prompt
      const analysisPrompt = this.buildAnalysisPrompt(prompt, data);

      onProgress?.({ status: 'analyzing', progress: 20 });

      let reportContent = '';
      let tokenCount = 0;
      let lastProgress = 20;

      // Stream the report generation
      await streamOllamaGenerate({
        model,
        prompt: analysisPrompt,
        options: { temperature: 0.5 },
        onToken: (token) => {
          reportContent += token;
          tokenCount++;
          // Update progress (rough estimate)
          const progress = Math.min(90, 20 + (tokenCount / 10));
          const flooredProgress = Math.floor(progress);
          
          // Only log when progress actually changes
          if (flooredProgress > lastProgress) {
            console.log(`[REPORT ${reportId}] Progress: ${flooredProgress}%`);
            onProgress?.({ status: 'generating', progress: flooredProgress });
            lastProgress = flooredProgress;
          }
        }
      });

      onProgress?.({ status: 'formatting', progress: 95 });

      // Format the report
      const formattedReport = this.formatReport(reportContent, {
        title: this.extractTitle(prompt),
        generatedAt: new Date().toISOString(),
        dataPoints: data?.length || 0
      });

      onProgress?.({ status: 'complete', progress: 100 });

      // Store report history
      this.reportHistory.push({
        reportId,
        userId,
        title: formattedReport.title,
        generatedAt: formattedReport.generatedAt,
        length: reportContent.length
      });

      onComplete?.({
        success: true,
        reportId,
        report: formattedReport,
        duration: Date.now() - this.activeReports.get(reportId).startTime
      });

      this.activeReports.delete(reportId);
      return formattedReport;
    } catch (error) {
      console.error('[REPORT] Error generating report:', error);
      onComplete?.({
        success: false,
        reportId,
        error: error.message
      });
      this.activeReports.delete(reportId);
      throw error;
    }
  }

  /**
   * Build comprehensive analysis prompt
   */
  buildAnalysisPrompt(userPrompt, data) {
    return `You are a professional data analyst. Analyze the following request and data comprehensively.

REQUEST: ${userPrompt}

DATA PROVIDED:
${JSON.stringify(data, null, 2)}

REQUIRED REPORT STRUCTURE:
1. Executive Summary (2-3 sentences of key findings)
2. Key Metrics & Analysis (bullet points with data)
3. Trends & Patterns (what's changing and why)
4. Insights & Observations (deeper analysis)
5. Recommendations (actionable next steps)
6. Caveats & Limitations (important context)

Provide detailed, professional analysis with specific numbers and percentages.`;
  }

  /**
   * Format report with structure
   */
  formatReport(content, metadata) {
    return {
      title: metadata.title || 'Data Analysis Report',
      generatedAt: metadata.generatedAt,
      dataPoints: metadata.dataPoints,
      sections: {
        executive: this.extractSection(content, 'Executive Summary'),
        metrics: this.extractSection(content, 'Key Metrics'),
        trends: this.extractSection(content, 'Trends'),
        insights: this.extractSection(content, 'Insights'),
        recommendations: this.extractSection(content, 'Recommendations'),
        caveats: this.extractSection(content, 'Caveats')
      },
      fullContent: content,
      metadata: {
        wordCount: content.split(/\s+/).length,
        estimatedReadTime: Math.ceil(content.split(/\s+/).length / 200) + ' min'
      }
    };
  }

  /**
   * Extract section from report
   */
  extractSection(content, sectionName) {
    const regex = new RegExp(`${sectionName}[:\\s]([^\\n]*(?:\\n(?!\\d\\.|\\*\\*)[^\\n]*)*)`, 'i');
    const match = content.match(regex);
    return match ? match[1].trim() : '';
  }

  /**
   * Extract title from prompt
   */
  extractTitle(prompt) {
    // Try to extract meaningful title from prompt
    if (prompt.includes('report')) return 'Analysis Report';
    if (prompt.includes('dashboard')) return 'Dashboard Analysis';
    if (prompt.includes('sales')) return 'Sales Analysis Report';
    if (prompt.includes('forecast')) return 'Forecast Report';
    return 'Data Analysis Report';
  }

  /**
   * Get report status
   */
  getReportStatus(reportId) {
    return this.activeReports.get(reportId) || { status: 'not_found' };
  }

  /**
   * Get report history
   */
  getReportHistory(userId, limit = 10) {
    return this.reportHistory
      .filter(r => r.userId === userId)
      .slice(-limit)
      .reverse();
  }

  /**
   * Export report to HTML
   */
  exportToHTML(report) {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${report.title}</title>
  <style>
    body { font-family: 'Segoe UI', sans-serif; margin: 32px; line-height: 1.6; background: #f8fafc; color: #0f172a; }
    .page { max-width: 960px; margin: 0 auto; background: #ffffff; padding: 32px; border-radius: 16px; box-shadow: 0 12px 30px rgba(15, 23, 42, 0.08); }
    h1 { color: #0f172a; border-bottom: 4px solid #2563eb; padding-bottom: 10px; margin-bottom: 8px; }
    h2 { color: #0f766e; margin-top: 28px; }
    .meta { background: linear-gradient(135deg, #eff6ff 0%, #ecfeff 100%); padding: 16px; border-radius: 10px; margin: 20px 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
    .meta p { margin: 0; font-size: 0.95rem; }
    .section { margin: 18px 0; padding: 14px 16px; border: 1px solid #e2e8f0; border-radius: 10px; background: #f8fafc; }
    ul { margin: 10px 0; padding-left: 20px; }
    li { margin: 8px 0; }
    .footer { color: #64748b; font-size: 12px; margin-top: 36px; }
  </style>
</head>
<body>
  <div class="page">
    <h1>${report.title}</h1>
    <div class="meta">
      <p><strong>Generated:</strong> ${new Date(report.generatedAt).toLocaleString()}</p>
      <p><strong>Data Points:</strong> ${report.dataPoints}</p>
      <p><strong>Reading Time:</strong> ${report.metadata.estimatedReadTime}</p>
    </div>

    <h2>Executive Summary</h2>
    <div class="section">${report.sections.executive}</div>

    <h2>Key Metrics & Analysis</h2>
    <div class="section">${report.sections.metrics}</div>

    <h2>Trends & Patterns</h2>
    <div class="section">${report.sections.trends}</div>

    <h2>Insights & Observations</h2>
    <div class="section">${report.sections.insights}</div>

    <h2>Recommendations</h2>
    <div class="section">${report.sections.recommendations}</div>

    <h2>Caveats & Limitations</h2>
    <div class="section">${report.sections.caveats}</div>

    <div class="footer">
      <p>This report was generated automatically. Always verify findings with primary sources.</p>
    </div>
  </div>
</body>
</html>
    `;
  }

  /**
   * Export report to PDF (requires additional library)
   */
  exportToPDF(report) {
    // Would require: npm install pdfkit
    // For now, return HTML format
    return this.exportToHTML(report);
  }
}

export const reportGenerator = new ReportGenerator();
