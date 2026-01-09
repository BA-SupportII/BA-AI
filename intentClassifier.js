/**
 * Intent Classifier - Determines what the user actually wants
 * Makes AI "smart" by routing to correct model and tools
 */

// Universal tool registry - all available tools
const UNIVERSAL_TOOLS = [
    'web_search',
    'summarize',
    'code_analysis',
    'code_execute',
    'python_execute',
    'sql_query',
    'sql_schema',
    'memory_save',
    'memory_recall',
    'visualize',
    'sympy'
];

/**
 * Get flexible tools for an intent based on context
 * Returns union of primary tools + contextual tools
 */
function getFlexibleTools(intentType, additionalContext = {}) {
    const baseTools = INTENT_TYPES[intentType]?.tools || [];
    const contextTools = additionalContext.suggestedTools || [];

    // Merge and deduplicate
    const merged = [...new Set([...baseTools, ...contextTools])];
    return merged.filter(tool => UNIVERSAL_TOOLS.includes(tool));
}

export const INTENT_TYPES = {
    RANKING_QUERY: {
        patterns: [
            'top', 'best', 'rank', 'ranking', 'ranked', 'leaderboard', 'top 10', 'top 5', 'top ten', 'top five',
            'best of', 'most popular', 'highest rated', 'most used', 'most used', 'by popularity', 'by score'
        ],
        requiresWeb: true,
        modelPreference: 'llama3.2',
        tools: ['web_search', 'summarize'],
        flexibleTools: true,
        advancedCheck: (prompt) => {
            if (/\b(top|best|rank|ranking|leaderboard)\b/i.test(prompt)) return true;
            if (/\btop\s*\d+\b/i.test(prompt)) return true;
            if (/\bmost\s+(popular|used|rated|cited)\b/i.test(prompt)) return true;
            return false;
        }
    },
    GRAMMAR_CORRECTION: {
        patterns: [
            'grammar', 'correct', 'fix', 'spell', 'typo', 'mistake', 'punctuation', 'capitalize',
            'sentence', 'word', 'phrase', 'rephrase', 'reword', 'improve', 'better way',
            'is this correct', 'is this right', 'check my', 'does this look good', 'review my',
            'proper', 'incorrect', 'should it be', 'right or wrong'
        ],
        requiresWeb: false,
        modelPreference: 'gemma:2b',
        tools: [],
        flexibleTools: false,
        advancedCheck: (prompt) => {
            // Pattern 1: Fixing/checking text
            if (/\b(fix|correct|improve|rephrase|reword|check)\b.*\b(sentence|word|phrase|text|grammar|spelling)\b/i.test(prompt)) return true;
            
            // Pattern 2: Grammar/spell keywords
            if (/\b(grammar|spelling|punctuation|typo|spell|capitali[sz]e|error|mistake)\b/i.test(prompt)) return true;
            
            // Pattern 3: Correctness questions
            if (/\b(is (this|that) (correct|right|proper|good)|should (it|this) be|does (this|that) look good)\b/i.test(prompt)) return true;
            
            // Pattern 4: Short text with correction request
            if (prompt.length < 300 && /\b(better way|better phrasing|sounds better|rephrase|reword|improve my)\b/i.test(prompt)) return true;
            
            return false;
        }
    },
    WORLD_KNOWLEDGE: {
        patterns: [
            // Time-based: news, updates, current info
            'latest', 'current', 'news', 'happening', 'recent', 'today', 'trending', 'update', 'breaking', 'just', 'announced', 'just happened',
            // Comparison/ranking
            'vs', 'versus', 'rank', 'ranking', 'ranked', 'top', 'best', 'worst', 'compare', 'comparison', 'list', 'statistics', 'data',
            'leaderboard', 'by number', 'by count', 'ordered by', 'versus', 'rate',
            // Global scope
            'around the world', 'global', 'worldwide', 'international', 'countries', 'nations', 'world', 'across globe',
            // Question starters for facts
            'what happened', 'what is', 'who is', 'where is', 'when did', 'how many', 'tell me about', 'inform me',
            // Conflict/geopolitical
            'war', 'conflict', 'attack', 'military', 'weapon', 'nuclear', 'tension', 'dispute', 'crisis', 'violence', 'geopolitical',
            // General events/facts
            'event', 'disaster', 'weather', 'earthquake', 'storm', 'accident', 'incident', 'discovery', 'breakthrough', 'announcement',
            // Current status
            'status', 'what happened', 'what about', 'any news', 'latest update', 'recent development'
        ],
        requiresWeb: true,
        modelPreference: 'mistral-small',
        tools: ['web_search', 'summarize'],
        flexibleTools: true,
        // Enhanced fact detection
        advancedCheck: (prompt) => {
            // Question marks often indicate fact-seeking
            if (prompt.includes('?')) {
                // Combined with news/current keywords
                if (/\b(what|who|where|when|why|how)\b.*\b(news|current|recent|latest|today|happening)\b/i.test(prompt)) return true;
                // General fact questions
                if (/\b(what happened|who is|where is|when did|how many|tell me)\b/i.test(prompt)) return true;
            }
            // Breaking news indicators
            if (/\b(breaking|breaking news|just announced|just happened|just released)\b/i.test(prompt)) return true;
            // Global scope keywords
            if (/\b(global|worldwide|international|world|across|around the world)\b/i.test(prompt)) return true;
            // News aggregation keywords
            if (/\b(headlines|trends|trending|rank|top|latest)\b/i.test(prompt)) return true;
            return false;
        }
    },
    CODE_TASK: {
        patterns: [
            'code', 'debug', 'fix', 'error', 'bug', 'write', 'script', 'function', 'syntax', 'fix this', 'doesn\'t work',
            'python', 'javascript', 'java', 'cpp', 'c++', 'typescript', 'golang', 'rust', 'php', 'ruby', 'swift', 'kotlin', 'scala',
            'html', 'css', 'react', 'vue', 'angular', 'node', 'express', 'django', 'flask', 'fastapi', 'spring',
            'compile', 'run', 'execute', 'test', 'import', 'export', 'function', 'class', 'method', 'module', 'package',
            'loop', 'condition', 'array', 'object', 'variable', 'algorithm', 'refactor', 'optimize', 'performance',
            'crash', 'failure', 'exception', 'stack trace', 'undefined', 'null', 'type error', 'syntax error', 'logic error',
            'build', 'deploy', 'version', 'git', 'merge', 'pull request', 'repository'
        ],
        requiresWeb: false,
        modelPreference: 'deepseek-coder-v2',
        tools: ['code_analysis', 'code_execute', 'python_execute'],
        flexibleTools: true,
        // Universal code detection - enhanced
        advancedCheck: (prompt) => {
            // Code blocks: ```code```, <code>, {code}, ``` markers
            if (/```[\s\S]*```|```[\s\S]*|<code>[\s\S]*<\/code>|{[\s\S]{5,}}/i.test(prompt)) return true;
            // Programming syntax: function {...}, class {...}, def ...:, => =>
            if (/\b(function|class|def|const|let|var|import|from|return|async|await|try|catch|finally)\b/i.test(prompt)) return true;
            // Arrow functions & lambda
            if (/=>|:=|\?|<-/i.test(prompt)) return true;
            // Code structure: method calls, property access
            if (/\.\w+\(|\/\/|\/\*|\*\/|#|--/i.test(prompt)) return true;
            // Error indicators
            if (/\b(throw|raise|fail|assert|error|exception|traceback)\b/i.test(prompt)) return true;
            // Language-specific syntax
            if (/;$|{$|:$|\(.*\)/i.test(prompt)) return true;
            return false;
        }
    },
    MATH_REASONING: {
        patterns: [
            'calculate', 'compute', 'solve', 'equation', 'math', 'algebra', 'geometry', 'solve for', 'how many',
            'percentage', 'ratio', 'fraction', 'decimal', 'prime', 'factor', 'multiply', 'divide', 'add', 'subtract',
            'integral', 'derivative', 'calculus', 'function', 'graph', 'plot', 'formula', 'theorem', 'exponential',
            'statistics', 'probability', 'mean', 'median', 'variance', 'standard deviation', 'distribution', 'z-score', 'confidence interval',
            'trigonometry', 'sine', 'cosine', 'tangent', 'angle', 'triangle', 'circle', 'polygon', 'area', 'perimeter',
            'matrix', 'vector', 'determinant', 'eigenvalue', 'complex number', 'sum', 'product', 'logarithm', 'exponent',
            // Universal math operators and keywords
            '+', '-', 'x', '×', '÷', '/', '=', 'plus', 'minus', 'times', 'divided by', 'equals', 'squared', 'cubed',
            'total', 'left', 'remaining', 'spent', 'bought', 'sell', 'cost', 'price', 'amount', 'balance', 'difference',
            'how many', 'how much', 'what is', 'result', 'compute', 'calculate'
        ],
        requiresWeb: false,
        modelPreference: 'deepseek-r1',
        tools: ['python_execute'],
        flexibleTools: true,
        // Enhanced word problem and math equation detection
        advancedCheck: (prompt) => {
            // Pattern 1: NATURAL LANGUAGE WORD PROBLEMS
            // Matches: "have 28 apples and eat 4" or "i have 5 and buy 2"
            // Key: multiple numbers + action/noun context words
            if (/\d+\s+\w+.*\d+.*\b(and|then|plus|minus|subtract|add|get|have|eat|buy|spend|earn|sell|cost|left|remaining)\b/i.test(prompt)) {
                return true;
            }
            
            // Pattern 1b: "number verb number" structure
            // Matches: "28 apples and eat 4" or "have 5 buy 2"
            if (/\d+\s+\w+.*\b(eat|buy|have|spend|earn|sell|get|plus|minus|add|subtract)\b.*\d+/i.test(prompt)) return true;
            
            // Pattern 1c: Traditional "number operator number"
            // Matches: "28 + 4" or "3 times 5" or "divide 20 by 4"
            if (/\d+\s*(?:\+|-|×|÷|\/|and|plus|minus|times|divided|multiplied)\s*\d+/i.test(prompt)) return true;
            
            // Pattern 2: Equations with = or variables
            if (/\b(x|y|z|a|b|c)\s*[=+\-*/]\s*\d+|\d+\s*[=+\-*/]\s*(x|y|z|a|b|c)/i.test(prompt)) return true;
            
            // Pattern 3: Math function calls
            if (/\b(sin|cos|tan|log|sqrt|pow|exp|factorial|abs)\s*\(/i.test(prompt)) return true;
            
            // Pattern 4: Statistics keywords
            if (/\b(standard deviation|variance|mean|median|mode|quartile|percentile|z-score|confidence|interval)\b/i.test(prompt)) return true;
            
            // Pattern 5: Percentage/ratio operations
            if (/\d+\s*%|ratio|proportion|scale|enlarge|shrink/i.test(prompt)) return true;
            
            // Pattern 6: Geometry with measurements
            if (/\b(area|perimeter|volume|radius|diameter|circumference|angle|degree)\b.*\d+/i.test(prompt)) return true;
            
            return false;
        }
    },
    SQL_QUERY: {
        patterns: [
            'sql', 'query', 'database', 'select', 'insert', 'update', 'delete', 'table', 'data retrieval',
            'where', 'join', 'group by', 'order by', 'aggregate', 'index', 'backup', 'restore',
            'mysql', 'postgresql', 'sqlite', 'oracle', 'mssql', 'mongodb', 'nosql', 'dynamodb', 'firestore',
            'schema', 'columns', 'primary key', 'foreign key', 'constraint', 'trigger', 'index',
            'stored procedure', 'view', 'transaction', 'commit', 'rollback', 'acid', 'normalize',
            'inner join', 'left join', 'right join', 'full join', 'cross join', 'union', 'subquery'
        ],
        requiresWeb: false,
        modelPreference: 'qwen3',
        tools: ['sql_query', 'sql_schema', 'python_execute'],
        flexibleTools: true,
        // Enhanced SQL detection
        advancedCheck: (prompt) => {
            // SQL keywords: SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, ALTER, TRUNCATE
            if (/\b(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|WITH|TRUNCATE|REPLACE)\b/i.test(prompt)) return true;
            // SQL syntax: table.column, WHERE, JOIN, GROUP BY, HAVING
            if (/\b(WHERE|JOIN|GROUP\s+BY|ORDER\s+BY|HAVING|UNION|INTERSECT|EXCEPT)\b/i.test(prompt)) return true;
            // SQL functions: COUNT(), SUM(), AVG(), MAX(), MIN(), DISTINCT
            if (/\b(COUNT|SUM|AVG|MAX|MIN|CONCAT|SUBSTR|ROUND|CAST|DISTINCT|COALESCE|CASE)\s*\(/i.test(prompt)) return true;
            // CTE (Common Table Expressions) and advanced syntax
            if (/\b(WITH\s+\w+\s+AS|RECURSIVE|WINDOW|OVER|PARTITION\s+BY)\b/i.test(prompt)) return true;
            // Database-specific patterns
            if (/\b(CREATE\s+(TABLE|INDEX|VIEW|DATABASE)|ALTER\s+TABLE|PRIMARY\s+KEY|FOREIGN\s+KEY)\b/i.test(prompt)) return true;
            // NoSQL query patterns
            if (/\b(find|insert|update|delete|aggregate|lookup|group|match|project)\b.*\{.*\}/i.test(prompt)) return true;
            return false;
        }
    },
    DATA_ANALYSIS: {
        patterns: [
            'analyze', 'query', 'data', 'trend', 'chart', 'graph', 'statistics', 'average', 'total', 'sum',
            'database', 'table', 'column', 'row', 'filter', 'sort', 'group', 'join', 'aggregate', 'flatten',
            'visualize', 'dashboard', 'report', 'metric', 'kpi', 'insight', 'pattern', 'correlation', 'compare',
            'outlier', 'anomaly', 'forecast', 'prediction', 'clustering', 'regression', 'classification', 'model',
            'pivot', 'cross tab', 'histogram', 'scatter', 'heatmap', 'distribution', 'median', 'percentile', 'quartile',
            'export', 'import', 'csv', 'json', 'excel', 'dataset', 'sample', 'subset', 'aggregate',
            // Spreadsheet & Formula Support
            'spreadsheet', 'sheet', 'google sheets', 'excel', 'formula', '=sum', '=average', '=count',
            '=vlookup', '=hlookup', '=if', '=match', '=index', '=filter', '=query', '=ifs', '=transpose',
            'cell', 'range', 'column', 'row', 'pivot table', 'conditional', 'format', 'data validation'
        ],
        requiresWeb: false,
        modelPreference: 'qwen3',
        tools: ['sql_query', 'python_execute', 'visualize'],
        flexibleTools: true,
        // Enhanced data detection with multiple patterns
        advancedCheck: (prompt) => {
            // Pattern 1: Excel/Sheets formulas (ANY formula starting with =)
            if (/[=]\s*[A-Za-z_]\w*\s*\(/i.test(prompt)) return true;

            // Pattern 2: Spreadsheet operations
            if (/\b(pivot|sort|group|aggregate|conditional format|freeze|merge|vlookup|hlookup|index|match)\b/i.test(prompt)) return true;

            // Pattern 3: Data transformation keywords
            if (/\b(flatten|reshape|transpose|unpivot|normalize|denormalize|aggregate|roll|summarize)\b/i.test(prompt)) return true;

            // Pattern 4: Statistical analysis
            if (/\b(std|variance|quartile|percentile|distribution|outlier|anomaly|correlation|covariance)\b/i.test(prompt)) return true;

            // Pattern 5: CSV/JSON data format indicators
            if (/,[\s\w"]+,|{\s*"[\w]+"\s*:|:\s*\[/i.test(prompt)) return true;

            // Pattern 6: Data aggregation
            if (/\b(group\s+by|order\s+by|count|sum|avg|min|max)\s+(by|as|on|from)/i.test(prompt)) return true;

            return false;
        }
    },
    CREATIVE: {
        patterns: [
            'write', 'create', 'design', 'story', 'poem', 'imagine', 'brainstorm', 'logo', 'image', 'describe', 'draft',
            'compose', 'author', 'script', 'dialogue', 'character', 'plot', 'narrative', 'scene', 'script', 'screenplay',
            'song', 'lyrics', 'music', 'melody', 'harmony', 'beat', 'rhythm', 'composition', 'arrangement',
            'art', 'painting', 'drawing', 'sketch', 'illustration', 'graphic', 'visual', 'render', 'artwork',
            'idea', 'concept', 'theme', 'mood', 'atmosphere', 'style', 'tone', 'voice', 'perspective',
            'advertisement', 'slogan', 'tagline', 'caption', 'headline', 'content', 'copy', 'content marketing',
            'novel', 'fiction', 'fantasy', 'mystery', 'romance', 'email', 'press release', 'blog post'
        ],
        requiresWeb: false,
        modelPreference: 'llama3.2',
        tools: [],
        flexibleTools: true,
        // Enhanced creative intent detection
        advancedCheck: (prompt) => {
            // Pattern 1: Creative action verbs
            if (/\b(write|create|design|compose|author|imagine|brainstorm|invent|craft|sketch|paint|draw)\b/i.test(prompt)) return true;

            // Pattern 2: Content type keywords
            if (/\b(story|poem|song|script|dialogue|article|blog|email|advertisement|novel|essay|book|chapter)\b/i.test(prompt)) return true;

            // Pattern 3: Creative descriptors
            if (/\b(character|plot|narrative|theme|mood|atmosphere|creative|artistic|imaginative|original)\b/i.test(prompt)) return true;

            // Pattern 4: Writing style requests
            if (/\b(tone|voice|style|perspective|first person|third person|humorous|serious|formal|informal)\b/i.test(prompt)) return true;

            // Pattern 5: Creative domains
            if (/\b(music|art|design|film|photography|illustration|graphic|animation|visual)\b/i.test(prompt)) return true;

            return false;
        }
    },
    DECISION_MAKING: {
        patterns: [
            'should', 'which', 'better', 'pros', 'cons', 'compare', 'choose', 'recommend', 'or',
            'advantage', 'disadvantage', 'benefit', 'risk', 'trade off', 'alternative', 'option', 'tradeoff',
            'prefer', 'best for', 'suitable', 'worth', 'value', 'cost', 'benefit analysis', 'roi', 'evaluation',
            'decision', 'choice', 'selection', 'pick', 'prefer', 'like', 'opinion', 'advice', 'suggest',
            'help me decide', 'what should i', 'which is better', 'is it good', 'would you recommend'
        ],
        requiresWeb: true,
        modelPreference: 'mistral-small',
        tools: ['web_search'],
        flexibleTools: true,
        // Enhanced decision-making detection
        advancedCheck: (prompt) => {
            // Pattern 1: Decision keywords
            if (/\b(should|which|better|choose|recommend|decision|prefer|advantage|disadvantage|compare)\b/i.test(prompt)) return true;

            // Pattern 2: Comparison requests
            if (/\b(\w+\s+vs\s+\w+|compare|comparison|versus|alternative|option)\b/i.test(prompt)) return true;

            // Pattern 3: Evaluation criteria
            if (/\b(pros|cons|benefit|risk|advantage|disadvantage|strength|weakness|cost|value|worth)\b/i.test(prompt)) return true;

            // Pattern 4: Recommendation requests
            if (/\b(recommend|suggest|advice|opinion|best|suitable|appropriate|suitable|fitting)\b/i.test(prompt)) return true;

            return false;
        }
    },
    LEARNING: {
        patterns: [
            'teach', 'explain', 'how to', 'tutorial', 'guide', 'learn', 'step by step', 'help me understand', 'show me',
            'what is', 'what does', 'define', 'definition', 'meaning', 'concept', 'principle', 'purpose',
            'introduce', 'get started', 'beginner', 'basics', 'fundamentals', 'foundation', 'overview',
            'example', 'case study', 'scenario', 'use case', 'demonstration', 'walkthrough', 'illustration',
            'best practices', 'tips', 'tricks', 'advice', 'recommendation', 'lesson', 'instruction',
            'course', 'training', 'education', 'skill', 'knowledge', 'understand', 'master', 'expertise'
        ],
        requiresWeb: true,
        modelPreference: 'mistral-small',
        tools: ['web_search'],
        flexibleTools: true,
        // Enhanced learning intent detection
        advancedCheck: (prompt) => {
            // Pattern 1: Teaching/explanation keywords
            if (/\b(teach|explain|clarify|illustrate|demonstrate|show|guide|instruct|educate)\b/i.test(prompt)) return true;

            // Pattern 2: Question marks with learning keywords
            if (/\?\s*(how|what|why|when|where)\b|\b(how to|how do|what is|what does)\b.*\?/i.test(prompt)) return true;

            // Pattern 3: Level indicators
            if (/\b(beginner|intermediate|advanced|basics|fundamentals|foundation|intro|introduction)\b/i.test(prompt)) return true;

            // Pattern 4: Learning resources
            if (/\b(tutorial|guide|course|lesson|training|education|example|case study|walkthrough)\b/i.test(prompt)) return true;

            // Pattern 5: Understanding requests
            if (/\b(understand|learn|master|grasp|comprehend|know|familiarize|get familiar)\b/i.test(prompt)) return true;

            return false;
        }
    },
    MEMORY: {
        patterns: [
            'remember', 'save', 'note', 'recall', 'remind', 'store', 'delete memory', 'my preferences', 'store info',
            'memorize', 'don\'t forget', 'keep in mind', 'take note', 'jot down', 'remind me', 'bookmark',
            'i like', 'i prefer', 'my favorite', 'i use', 'my project', 'my name', 'my info',
            'about me', 'my details', 'personal', 'profile', 'settings', 'preferences', 'context',
            'my knowledge', 'remember this', 'note this down', 'save this', 'my history', 'my data'
        ],
        requiresWeb: false,
        modelPreference: 'gemma:2b',
        tools: ['memory_save', 'memory_recall'],
        flexibleTools: true,
        // Enhanced memory/context detection
        advancedCheck: (prompt) => {
            // Pattern 1: Personal preference/memory keywords
            if (/\b(remember|save|store|recall|remind|memory|i like|i prefer|my favorite|about me)\b/i.test(prompt)) return true;

            // Pattern 2: Context setting
            if (/\b(context|note|remember|keep in mind|remind me|don't forget|bookmark)\b/i.test(prompt)) return true;

            // Pattern 3: Personal information
            if (/\b(my [\w]+|i am|call me|name is|my name|favorite|preference|like|dislike)\b/i.test(prompt)) return true;

            return false;
        }
    },
    MULTI_STEP: {
        patterns: [
            'build', 'project', 'complete', 'dashboard', 'architecture', 'system', 'end to end', 'full', 'entire', 'comprehensive',
            'implement', 'develop', 'create', 'design', 'plan', 'blueprint', 'roadmap', 'strategy', 'solution',
            'workflow', 'pipeline', 'integration', 'deployment', 'infrastructure', 'setup', 'provisioning',
            'complex', 'large', 'enterprise', 'scalable', 'production', 'deployment', 'migration',
            'multiple steps', 'sequential', 'step by step', 'process', 'flow', 'chain', 'orchestration',
            'api', 'backend', 'frontend', 'database', 'server', 'client', 'full stack', 'microservices'
        ],
        requiresWeb: true,
        modelPreference: 'deepseek-r1',
        tools: ['web_search', 'code_analysis', 'python_execute'],
        flexibleTools: true,
        // Enhanced multi-step/project detection
        advancedCheck: (prompt) => {
            // Pattern 1: Project scope keywords
            if (/\b(project|build|implement|develop|create|architecture|system|solution)\b/i.test(prompt)) return true;

            // Pattern 2: Complexity indicators
            if (/\b(end to end|full stack|microservices|complex|large scale|enterprise|production)\b/i.test(prompt)) return true;

            // Pattern 3: Process/workflow keywords
            if (/\b(workflow|pipeline|integration|deployment|orchestration|process|flow|sequential|step|phase)\b/i.test(prompt)) return true;

            // Pattern 4: Infrastructure/DevOps keywords
            if (/\b(infrastructure|deployment|scalable|cloud|server|database|backend|frontend|api)\b/i.test(prompt)) return true;

            // Pattern 5: Multiple technologies/components
            if (/\b(and|plus|with|using)\s+\w+\s+and\s+\w+\s+and\s+\w+/i.test(prompt)) return true;

            return false;
        }
    },
    DEBUG_LOG: {
        patterns: [
            'debug', 'log', 'console', 'error', 'warning', 'trace', 'verbose', 'output', 'logging',
            'print', 'stdout', 'stderr', 'breakpoint', 'stack trace', 'exception', 'crash', 'dump',
            'inspect', 'monitor', 'profile', 'benchmark', 'performance', 'memory leak', 'valgrind',
            'timeout', 'hang', 'freeze', 'latency', 'slow', 'stuck', 'bottleneck', 'profiling'
        ],
        requiresWeb: false,
        modelPreference: 'deepseek-coder-v2',
        tools: ['code_analysis', 'python_execute'],
        flexibleTools: true,
        // Enhanced debug/log detection
        advancedCheck: (prompt) => {
            // Pattern 1: Log function calls
            if (/\b(console\.(log|error|warn|info|debug)|print|logger|syslog|printf|println|Debug\.Log|log\.)\s*\(/i.test(prompt)) return true;

            // Pattern 2: Error/exception keywords
            if (/\b(error|exception|traceback|stacktrace|backtrace|crash|fatal|panic|fail|assertion)\b/i.test(prompt)) return true;

            // Pattern 3: Debug keywords
            if (/\b(debug|breakpoint|gdb|lldb|debugger|inspect|monitor|profile|benchmark|trace)\b/i.test(prompt)) return true;

            // Pattern 4: Stack trace or error output
            if (/at\s+\w+\s*\(|at line\s+\d+|Error:|Exception:|Traceback:|TypeError:|ValueError:/i.test(prompt)) return true;

            // Pattern 5: Performance/profiling
            if (/\b(profile|profiling|performance|latency|throughput|cpu|memory|leak|bottleneck)\b/i.test(prompt)) return true;

            return false;
        }
    },
    HTML_MARKUP: {
        patterns: [
            'html', 'markup', 'tag', 'element', 'attribute', 'css', 'style', 'class', 'id', 'sass', 'scss',
            'div', 'span', 'form', 'input', 'button', 'image', 'link', 'script', 'section', 'header', 'footer',
            'semantic', 'accessibility', 'wcag', 'aria', 'responsive', 'mobile', 'desktop', 'viewport',
            'web', 'frontend', 'ui', 'ux', 'design', 'template', 'component', 'layout', 'flexbox', 'grid',
            'bootstrap', 'tailwind', 'material', 'semantic ui', 'normalize', 'cross-browser'
        ],
        requiresWeb: false,
        modelPreference: 'deepseek-coder-v2',
        tools: ['code_analysis'],
        flexibleTools: true,
        // Enhanced HTML/markup detection
        advancedCheck: (prompt) => {
            // Pattern 1: HTML tags: <div>, <span>, <form>, etc.
            if (/<[a-z]+[\s/>]|<\/[a-z]+>|<\w+\s+\w+/i.test(prompt)) return true;

            // Pattern 2: HTML attributes: class=, id=, style=
            if (/\b(class|id|style|data-\w+|onclick|onload|href|src|alt|role|aria)\s*=\s*["']/i.test(prompt)) return true;

            // Pattern 3: HTML entities: &nbsp;, &lt;, &#123;
            if (/&\w+;|&#\d+;|&#x[0-9a-f]+;/i.test(prompt)) return true;

            // Pattern 4: CSS patterns: .class, #id, selector {}, color values
            if (/[.#]\w+\s*\{|:\w+\s*;|#[0-9a-f]{6}|rgb\s*\(|rgba\s*\(/i.test(prompt)) return true;

            // Pattern 5: HTML/CSS/web keywords
            if (/\b(html|markup|css|style|semantic|responsive|accessibility|viewport|bootstrap|tailwind|flexbox|grid)\b/i.test(prompt)) return true;

            // Pattern 6: CSS selectors and pseudo-classes
            if (/(:hover|:active|:focus|::before|::after|\s>\s|\s\+\s)/i.test(prompt)) return true;

            return false;
        }
    },
    ANALYSIS_REPORT: {
        patterns: [
            'report', 'analysis', 'summary', 'insight', 'visualization', 'chart', 'graph', 'dashboard', 'assessment',
            'generate report', 'create report', 'write report', 'produce', 'compile', 'aggregate', 'synthesize',
            'executive summary', 'business intelligence', 'bi', 'analytics', 'metric', 'kpi', 'objective',
            'performance', 'trend', 'pattern', 'finding', 'conclusion', 'recommendation', 'proposal',
            'pdf', 'html', 'markdown', 'docx', 'export', 'presentation', 'slide', 'deck',
            'infographic', 'visualization', 'data-driven', 'evidence-based', 'statistical', 'whitepaper'
        ],
        requiresWeb: false,
        modelPreference: 'qwen3',
        tools: ['python_execute', 'sql_query', 'visualize'],
        flexibleTools: true,
        // Enhanced analysis/report detection
        advancedCheck: (prompt) => {
            // Pattern 1: Report format keywords
            if (/\b(report|analysis|summary|presentation|infographic|dashboard|visualization|assessment)\b/i.test(prompt)) return true;

            // Pattern 2: Chart/graph types
            if (/\b(bar chart|line graph|pie chart|histogram|scatter plot|heatmap|treemap|sankey|gauge|bullet|map|waterfall)\b/i.test(prompt)) return true;

            // Pattern 3: Business intelligence keywords
            if (/\b(executive summary|business intelligence|bi|analytics|metric|kpi|performance|trend|insight|finding|conclusion|recommendation)\b/i.test(prompt)) return true;

            // Pattern 4: Export formats
            if (/\b(export|generate|create|produce|compile|format|as pdf|as html|as markdown|as json|as csv)\b/i.test(prompt)) return true;

            // Pattern 5: Statistical analysis
            if (/\b(statistical|correlation|regression|forecast|prediction|anomaly|outlier|cluster|segment|significant)\b/i.test(prompt)) return true;

            // Pattern 6: Data aggregation
            if (/\b(aggregate|summarize|rollup|pivot|cross-tab|drill-down|slice|dice|group|consolidate)\b/i.test(prompt)) return true;

            return false;
        }
    },
    VISUALIZATION: {
        patterns: [
            'chart', 'graph', 'plot', 'diagram', 'visualization', 'draw', 'illustrate', 'picture', 'render',
            'bar', 'line', 'pie', 'scatter', 'histogram', 'heatmap', 'tree map', 'sankey', 'gauge', 'bubble', 'funnel',
            'canvas', 'svg', 'd3', 'plotly', 'matplotlib', 'seaborn', 'ggplot', 'altair', 'bokeh',
            'tableau', 'power bi', 'looker', 'metabase', 'redash', 'superset', 'grafana',
            'visual', 'layout', 'design', 'ux', 'ui', 'interactive', 'animation', 'tooltip', 'legend'
        ],
        requiresWeb: false,
        modelPreference: 'qwen3',
        tools: ['python_execute', 'visualize'],
        flexibleTools: true,
        // Enhanced visualization detection
        advancedCheck: (prompt) => {
            // Pattern 1: Chart type keywords
            if (/\b(bar chart|line graph|pie chart|scatter plot|histogram|heatmap|treemap|sankey|gauge|bubble|donut|area|waterfall|slope|funnel|venn|sunburst)\b/i.test(prompt)) return true;

            // Pattern 2: Visualization libraries
            if (/\b(d3|plotly|matplotlib|seaborn|ggplot|altair|tableau|power\s*bi|looker|metabase|canvas|svg|bokeh|highcharts|chartjs)\b/i.test(prompt)) return true;

            // Pattern 3: Interactive/animation keywords
            if (/\b(interactive|animation|animate|transition|hover|tooltip|drill-down|zoom|pan|scroll|drag|click)\b/i.test(prompt)) return true;

            // Pattern 4: Visual design keywords
            if (/\b(color|palette|theme|style|layout|axis|legend|label|grid|scale|marker|symbol|appearance)\b/i.test(prompt)) return true;

            // Pattern 5: Data visualization requests
            if (/\b(visualize|display|show|render|draw|plot|map|represent|depict)\b.*\b(data|chart|graph|diagram)\b/i.test(prompt)) return true;

            return false;
        }
    },
    PROOF_SOLVING: {
        patterns: [
            'proof', 'prove', 'theorem', 'lemma', 'axiom', 'corollary', 'induction', 'contradiction', 'contrapositive',
            'logical deduction', 'derivation', 'verify', 'demonstrate', 'establish', 'show that', 'why is',
            'mathematical proof', 'rigorous', 'formal verification', 'qed', 'therefore', 'hence', 'thus'
        ],
        requiresWeb: false,
        modelPreference: 'deepseek-r1',
        tools: ['python_execute', 'sympy'],
        flexibleTools: true,
        advancedCheck: (prompt) => {
            // Pattern 1: Proof keywords
            if (/\b(proof|prove|theorem|lemma|prove that|show that|demonstrate|establish)\b/i.test(prompt)) return true;
            // Pattern 2: Logical deduction
            if (/\b(therefore|hence|thus|consequently|which implies|logically)\b/i.test(prompt)) return true;
            // Pattern 3: Mathematical rigor
            if (/\b(induction|contradiction|contrapositive|qed|rigorous|formal verification)\b/i.test(prompt)) return true;
            return false;
        }
    },
    SYSTEM_DESIGN: {
        patterns: [
            'design', 'architecture', 'system', 'scale', 'scalable', 'distributed', 'microservices', 'async', 'queue',
            'load balancing', 'caching', 'database design', 'api design', 'fault tolerance', 'redundancy',
            'high availability', 'performance', 'optimization', 'bottleneck', 'throughput', 'latency',
            'how would you build', 'design a', 'how to design', 'system design', 'architecture pattern'
        ],
        requiresWeb: true,
        modelPreference: 'deepseek-r1',
        tools: ['web_search', 'code_analysis', 'visualize'],
        flexibleTools: true,
        advancedCheck: (prompt) => {
            // Pattern 1: System design keywords
            if (/\b(design|architecture|system|scale|scalable|distributed|microservices)\b/i.test(prompt)) return true;
            // Pattern 2: Design patterns
            if (/\b(pattern|approach|strategy|framework|model)\b.*\b(system|architecture|design)\b/i.test(prompt)) return true;
            // Pattern 3: Infrastructure concerns
            if (/\b(load balancing|caching|database|replication|failover|redundancy|high availability|fault tolerance)\b/i.test(prompt)) return true;
            // Pattern 4: How would you questions
            if (/\bhow (would you|to|do you|can you) (design|build|architect|implement|scale)\b/i.test(prompt)) return true;
            return false;
        }
    },
    FORMULA_GENERATION: {
        patterns: [
            // Spreadsheet tool names (universal)
            'formula', 'spreadsheet', 'sheet', 'google', 'excel', 'libreoffice', 'calc', 'numbers',
            // General formula keywords
            'function', 'equation', 'calculate', 'condition', 'reference', 'cell', 'range'
        ],
        requiresWeb: false,
        modelPreference: 'deepseek-r1',
        tools: ['python_execute', 'sympy'],
        flexibleTools: true,
        // UNIVERSAL flexible formula detection - works for ANY function/tool/syntax
        advancedCheck: (prompt) => {
            // ===== PATTERN 1: Direct formula syntax =====
            // Matches: =SUM(...), =VLOOKUP(...), =LET(...), =IMPORTRANGE(...), =ANYTHING(...)
            // This catches ALL formulas regardless of function name
            if (/[=]\s*[A-Za-z_][A-Za-z0-9_]*\s*\(/i.test(prompt)) return true;

            // ===== PATTERN 2: Formula name with parentheses (no = sign) =====
            // Matches: SUM(A1:A10), VLOOKUP(A1, B:C, 2), LET(x, 5, x*2)
            if (/\b[A-Z_][A-Z0-9_]*\s*\(\s*[A-Za-z0-9:$,.\s\-\'"]*\)/i.test(prompt)) return true;

            // ===== PATTERN 3: Cell references (A1, B2:C5, $D$1, etc) =====
            // Indicates spreadsheet context
            if (/[\$]?[A-Z]+[\$]?\d+(:[\$]?[A-Z]+[\$]?\d+)?/i.test(prompt)) return true;

            // ===== PATTERN 4: Spreadsheet tool keywords =====
            // Matches any mention of spreadsheet tools
            if (/\b(excel|google\s*sheets?|spreadsheet|libreoffice|apple\s*numbers|ms\s*calc|gnumeric)\b/i.test(prompt)) return true;

            // ===== PATTERN 5: Operators & keywords common in formulas =====
            // Matches: nested formulas, references, operators
            if (/(\bIF\b|\bSUM\b|\bCOUNT\b|\bLOOKUP\b|\bVALUE\b)\s*\(/i.test(prompt)) return true;

            return false;
        }
    },
    RIDDLE: {
        patterns: [
            'riddle', 'puzzle', 'brainteaser', 'brain teaser', 'trick question',
            'logic puzzle', 'lateral thinking', 'common sense', 'shortcut',
            'riddle:', 'puzzle:', 'brainteaser:', 'trick:'
        ],
        requiresWeb: false,
        modelPreference: 'deepseek-r1',
        tools: [],
        flexibleTools: false,
        advancedCheck: (prompt) => {
            if (/\b(riddle|puzzle|brainteaser|brain teaser|trick question|logic puzzle|lateral thinking)\b/i.test(prompt)) return true;
            if (/\b(if|then)\b.*\bhow many\b/i.test(prompt)) return true;
            if (/\bhow many\b.*\b(left|remain|stay|still|on the|in the)\b/i.test(prompt)) return true;
            if (/\bshot|shoot|gun|loud\b/i.test(prompt) && /\bbird(s)?\b/i.test(prompt)) return true;
            if (/^what am i\b/i.test(prompt)) return true;
            return false;
        }
    },
    SIMPLE_QA: {
        patterns: [
            // Basic greetings & courtesies
            'hi', 'hello', 'hey', 'thanks', 'thank you', 'please', 'sorry', 'excuse me', 'goodbye', 'bye',
            'good morning', 'good afternoon', 'good evening', 'good night',
            
            // Definition & explanation
            'what is', 'who is', 'definition', 'meaning', 'what does', 'what\'s', 'define',
            'explain', 'describe', 'tell me about', 'what about',
            
            // Time questions
            'when', 'what time', 'what day', 'what year', 'how long', 'how old', 'what date',
            'current time', 'today', 'tomorrow', 'yesterday',
            
            // Location questions
            'where', 'where is', 'location of', 'which', 'which one',
            
            // Reason & Purpose
            'why', 'reason', 'purpose', 'cause', 'because',
            
            // Yes/No & Verification
            'is it', 'are they', 'do you', 'can you', 'could you', 'will you', 'would you',
            'yes or no', 'true or false', 'right or wrong', 'correct', 'verify', 'confirm',
            'is this', 'is that', 'is there', 'are there',
            
            // Quick answers & facts
            'fact', 'facts', 'trivia', 'quick answer', 'simple', 'basic', 'easy',
            'who', 'what', 'how', 'how much', 'how many',
            
            // Affirmative/Negative
            'yes', 'no', 'maybe', 'perhaps', 'probably', 'definitely', 'absolutely',
            'i agree', 'i disagree', 'i think', 'i believe', 'i know',
            
            // General info requests
            'information', 'info', 'details', 'list', 'name', 'example', 'sample',
            'type', 'kind', 'category', 'difference', 'difference between',
            
            // Conversational
            'how are you', 'how is', 'what\'s up', 'what\'s new', 'what\'s wrong',
            'you ok', 'you good', 'everything ok', 'everything good',
            
            // Simple commands
            'list', 'show', 'give me', 'provide', 'tell', 'share', 'help',
            'check', 'look at', 'see', 'view', 'read',
            
            // Math basics (simple)
            'count', 'add', 'plus', 'minus', 'multiply', 'divide', 'total',
            'sum', 'difference', 'product', 'quotient', 'average',
            
            // Common QA starters
            'question', 'ask', 'answer', 'respond', 'reply', 'comment',
            'thought', 'opinion', 'view', 'perspective'
        ],
        requiresWeb: false,
        modelPreference: 'gemma:2b',
        tools: [],
        flexibleTools: true,
        
        // Enhanced simple Q&A detection with more patterns
        advancedCheck: (prompt) => {
            // Pattern 1: Single word or very short (greeting-like)
            if (prompt.length < 10) {
                if (/^(hi|hey|hello|bye|ok|yes|no|yeah|nope|sure|thanks|please)$/i.test(prompt)) return true;
            }

            // Pattern 2: Greeting/courtesy phrases
            if (/^(hi|hello|hey|thanks|thank you|sorry|excuse me|goodbye|bye|good morning|good afternoon|good evening|good night)\b/i.test(prompt)) return true;

            // Pattern 3: Simple factual questions (starts with question words)
            if (/^\s*(who|what|where|when|why|how|is|does|can|will|would|should|are|did|have)\b/i.test(prompt)) return true;

            // Pattern 4: Definition/meaning requests
            if (/\b(what is|who is|what does|meaning of|definition of|explain|describe|tell me about)\b/i.test(prompt)) return true;

            // Pattern 5: Yes/no questions
            if (/\b(is|are|do|does|did|will|would|should|can|could)\b.*\?$/i.test(prompt)) return true;

            // Pattern 6: Short, direct questions (under 150 chars)
            if (prompt.length < 150 && prompt.includes('?')) {
                if (/\b(what|who|where|when|why|how|is|does|can|are|will)\b/i.test(prompt)) return true;
            }

            // Pattern 7: Affirmative/negative responses
            if (/^(yes|no|maybe|perhaps|probably|definitely|absolutely|true|false|correct|incorrect|right|wrong)[\s.!?]*$/i.test(prompt)) return true;

            // Pattern 8: Conversational questions about status
            if (/\b(how are you|how is|what\'s up|what\'s new|you ok|you good|everything ok|everything good)\b/i.test(prompt)) return true;

            // Pattern 9: List/show requests (simple)
            if (/\b(list|show|give me|provide|tell|share|help|check|look at|view)\b/i.test(prompt) && prompt.length < 100) return true;

            // Pattern 10: Simple opinion/comment requests
            if (/\b(what do you think|what\'s your|do you|can you|would you)\b/i.test(prompt) && prompt.length < 150) return true;

            return false;
        }
    }
};

/**
 * Classify user prompt intent - UNIVERSAL & FLEXIBLE
 * @param {string} prompt - User's input
 * @param {object} context - Optional context (history, user preferences, etc)
 * @returns {object} Intent classification result with detailed metadata
 */
export function classifyIntent(prompt, context = {}) {
    if (!prompt || typeof prompt !== 'string') {
        return {
            intent: 'SIMPLE_QA',
            confidence: 'LOW',
            score: 0,
            requiresWeb: false,
            modelPreference: 'llama3.2',
            tools: [],
            metadata: {
                error: 'Invalid prompt'
            }
        };
    }

    const lower = prompt.toLowerCase();
    const scores = {};

    // Score each intent type based on pattern matching
    for (const [intentType, config] of Object.entries(INTENT_TYPES)) {
        let score = 0;

        // Count pattern matches - UNIVERSAL: works for any pattern
        for (const pattern of config.patterns) {
            try {
                // Escape special regex characters
                const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(escaped, 'gi');
                const matches = (lower.match(regex) || []).length;
                
                // STRONGER boost for math context with numbers present
                if (intentType === 'MATH_REASONING' && (pattern === 'how many' || pattern === 'how much')) {
                    if (/\d+/.test(prompt)) {
                        score += Math.min(3, matches * 2); // 2x boost if numbers present
                    } else {
                        score += Math.min(2, matches);
                    }
                } else {
                    score += Math.min(2, matches);
                }
            } catch (e) {
                // Skip invalid patterns gracefully
                continue;
            }
        }

        // Apply advanced regex check if available (for FLEXIBLE matching)
        if (config.advancedCheck && typeof config.advancedCheck === 'function') {
            try {
                if (config.advancedCheck(prompt)) {
                    score += 5; // Strong boost for matching advanced pattern
                }
            } catch (e) {
                // Gracefully handle regex errors
                console.warn(`AdvancedCheck error for ${intentType}:`, e.message);
            }
        }

        // Boost score for context relevance (previous intent)
        if (context.previousIntent === intentType) {
            score += 1;
        }

        // Boost score for user preference (if saved)
        if (context.userPreference === intentType) {
            score += 2;
        }

        // Penalty for conflicting intents (negative score boost)
        if (context.excludeIntents && context.excludeIntents.includes(intentType)) {
            score -= 5;
        }

        scores[intentType] = Math.max(0, score); // Never negative scores
    }

    // Find top 5 intents (more comprehensive)
    const ranked = Object.entries(scores)
        .sort(([, a], [, b]) => b - a)
        .map(([intent, score]) => ({
            intent,
            score,
            ...INTENT_TYPES[intent]
        }));

    const topIntent = ranked[0];
    const secondIntent = ranked[1];
    const confidence = calculateConfidence(topIntent.score, secondIntent?.score || 0);

    // Enhanced metadata for debugging and analysis
    const complexity = determineComplexity(prompt);
    const metadata = {
        promptLength: prompt.length,
        complexity,
        hasQuestionMark: prompt.includes('?'),
        hasCode: /```|def |class |function |const |let /.test(prompt),
        hasSQL: /\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(prompt),
        hasHTML: /<[a-z]+[\s/>]/i.test(prompt),
        hasFormula: /[=]\s*[A-Za-z_][A-Za-z0-9_]*\s*\(/i.test(prompt),
        hasMath: /\d+\s*[\+\-×÷\/]\s*\d+/.test(prompt),
        wordCount: prompt.split(/\s+/).length,
        uniqueIntentScores: ranked.slice(0, 5).map(r => ({ intent: r.intent, score: r.score }))
    };

    return {
        intent: topIntent.intent,
        confidence,
        score: topIntent.score,
        requiresWeb: topIntent.requiresWeb,
        modelPreference: topIntent.modelPreference,
        tools: topIntent.tools,
        flexibleTools: topIntent.flexibleTools,
        availableTools: topIntent.flexibleTools ? UNIVERSAL_TOOLS : topIntent.tools,
        alternativeIntents: ranked.slice(1, 4).map(r => ({ intent: r.intent, score: r.score })),
        metadata,
        _debug: {
            allScores: scores
        }
    };
}

/**
 * Calculate confidence level based on scoring
 * Flexible: works for any score range, not hardcoded thresholds
 */
function calculateConfidence(topScore, secondScore) {
    if (topScore === 0) return 'LOW';

    const margin = topScore - secondScore;
    const ratio = secondScore > 0 ? topScore / secondScore : Infinity;

    // Dynamic thresholds based on absolute score and relative margin
    if (topScore >= 5 && margin >= 3) return 'VERY_HIGH';
    if (topScore >= 4 && margin >= 2) return 'HIGH';
    if (topScore >= 2 && ratio > 1.5) return 'HIGH';
    if (topScore >= 2 && margin >= 1) return 'MEDIUM';
    if (topScore >= 1) return 'MEDIUM';
    return 'LOW';
}

/**
 * Determine prompt complexity - UNIVERSAL detection
 * Analyzes multiple factors: length, structure, operators, nesting
 */
function determineComplexity(prompt) {
    let complexityScore = 0;

    // Factor 1: Length
    complexityScore += prompt.length > 1000 ? 3 : 0;
    complexityScore += prompt.length > 500 ? 2 : 0;
    complexityScore += prompt.length > 200 ? 1 : 0;

    // Factor 2: Code complexity (nested brackets, indentation)
    const bracketDepth = (prompt.match(/[({[]|[)}\]]/g) || []).length / 2;
    complexityScore += bracketDepth > 10 ? 3 : bracketDepth > 5 ? 2 : bracketDepth > 2 ? 1 : 0;

    // Factor 3: Operator count (SQL, formulas, code)
    const operators = (prompt.match(/(\bAND\b|\bOR\b|\bJOIN\b|,|;|\|\||&&|===|==)/gi) || []).length;
    complexityScore += operators > 5 ? 2 : operators > 2 ? 1 : 0;

    // Factor 4: Multiple code blocks or sections
    const codeBlocks = (prompt.match(/```/g) || []).length / 2;
    const sections = (prompt.match(/\n\n/g) || []).length;
    complexityScore += codeBlocks > 1 ? 2 : 0;
    complexityScore += sections > 3 ? 1 : 0;

    // Factor 5: Special complexity keywords
    if (/\b(recursive|nested|complex|multi-level|hierarchical|cascade)\b/i.test(prompt)) complexityScore += 2;
    if (/\b(edge case|corner case|optimization|algorithm|performance)\b/i.test(prompt)) complexityScore += 1;

    // Return complexity based on total score
    if (complexityScore >= 8) return 'VERY_HIGH';
    if (complexityScore >= 5) return 'HIGH';
    if (complexityScore >= 2) return 'MEDIUM';
    return 'LOW';
}

/**
 * Get model recommendation for an intent
 */
export function getModelForIntent(intent) {
    const config = INTENT_TYPES[intent];
    return config ? config.modelPreference : 'llama3.2';
}

/**
 * Get tools needed for an intent - supports flexible tools
 * @param {string} intent - Intent type
 * @param {object} context - Optional context with additional tool suggestions
 * @returns {array} Available tools for this intent
 */
export function getToolsForIntent(intent, context = {}) {
    const config = INTENT_TYPES[intent];
    if (!config) return [];

    // If intent supports flexible tools, merge with suggestions
    if (config.flexibleTools && context.suggestedTools) {
        return getFlexibleTools(intent, context);
    }

    return config.tools;
}

/**
 * Batch classify multiple prompts
 */
export function batchClassify(prompts) {
    return prompts.map(prompt => classifyIntent(prompt));
}

/**
 * Create a summary of the classification
 */
export function summarizeClassification(classification) {
    return `[INTENT: ${classification.intent}] ` +
        `Confidence: ${classification.confidence} | ` +
        `Uses Web: ${classification.requiresWeb ? 'YES' : 'NO'} | ` +
        `Model: ${classification.modelPreference}`;
}

/**
 * Intent Coverage Report - Show which intents are missing tools
 * and demonstrate flexibility across all intent types
 */
export function getIntentCoverageReport() {
    const report = {
        totalIntents: Object.keys(INTENT_TYPES).length,
        flexibleIntents: 0,
        intentsWithoutTools: 0,
        toolCoverage: {},
        intentDetails: []
    };

    // Count universal tools
    const toolUsage = {};
    UNIVERSAL_TOOLS.forEach(tool => {
        toolUsage[tool] = 0;
    });

    for (const [intentType, config] of Object.entries(INTENT_TYPES)) {
        const detail = {
            intent: intentType,
            flexible: config.flexibleTools,
            primaryTools: config.tools,
            availableTools: config.flexibleTools ? UNIVERSAL_TOOLS : config.tools,
            toolCount: config.tools.length,
            patterns: config.patterns.length,
            requiresWeb: config.requiresWeb,
            model: config.modelPreference
        };

        if (config.flexibleTools) {
            report.flexibleIntents++;
        }

        if (config.tools.length === 0) {
            report.intentsWithoutTools++;
        }

        // Track tool usage
        config.tools.forEach(tool => {
            if (toolUsage[tool]) {
                toolUsage[tool]++;
            }
        });

        report.intentDetails.push(detail);
    }

    report.toolCoverage = toolUsage;
    return report;
}

/**
 * Get intent recommendations based on prompt analysis
 * Analyzes what tools/functions would be needed
 */
export function getIntentRecommendations(prompt) {
    const classification = classifyIntent(prompt);
    const baseTools = classification.tools;
    const flexibleTools = classification.flexibleTools;

    return {
        intent: classification.intent,
        confidence: classification.confidence,
        recommendedTools: baseTools,
        flexibleTools: flexibleTools ? UNIVERSAL_TOOLS : [],
        toolRationale: {
            baseTools: `Primary tools for ${classification.intent} intent`,
            flexible: flexibleTools ? `${classification.intent} supports all universal tools for flexibility` : 'Not flexible'
        },
        model: classification.modelPreference,
        webRequired: classification.requiresWeb
    };
}


