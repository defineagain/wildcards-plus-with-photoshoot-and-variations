// -*- fill-column: 90; eval: (display-fill-column-indicator-mode 1); -*-
// @api-1.0
// Name: Sequential Wildcards
// Description: Process sequential shots [shot1|shot2] with wildcard and config definitions.
// Author: Gemini (based on wildcards-plus by ariane-emory)

// =============================================================================
// UI SELECTION
// =============================================================================

// Clone the current configuration
const originalConfig = JSON.parse(JSON.stringify(pipeline.configuration));

// Get prompt from Draw Things UI (correct property: pipeline.prompts.prompt)
const uiPrompt = pipeline.prompts.prompt;
console.log(`Raw UI Prompt Length: ${uiPrompt ? uiPrompt.length : 'undefined'}`);

const fallbackPrompt = `// Example:
@animal := { cat | dog }
#myconfig := { "steps": 25 }

[ A photo of a @animal #myconfig | A painting of a @animal ]`;

// Use UI prompt if available, otherwise fallback
let promptString;
if (uiPrompt && uiPrompt.trim().length > 0 && (uiPrompt.includes('{') || uiPrompt.includes('['))) {
    promptString = uiPrompt;
    console.log("Using prompt from Draw Things UI.");
} else {
    promptString = fallbackPrompt;
    console.log("WARNING: No valid prompt in Draw Things UI. Using fallback example.");
    console.log("TIP: Type your prompt with @wildcards and [shots] in the main prompt area, then run this script.");
}

const user_selection = requestFromUser("Sequential Wildcards", "Run", function() {
    return [
        this.section("Settings", "Enter your prompt in the main Draw Things prompt area first!", [
            this.slider(1, this.slider.fractional(0), 1, 20, "Batch Count (per shot)")
        ])
    ];
});

const batchCount = parseInt(user_selection[0][0]) || 1;

console.log(`Batch Count: ${batchCount}`);
console.log(`Prompt Length: ${promptString.length} characters`);
console.log(`Prompt Preview: ${promptString.substring(0, 300)}...`);




// =============================================================================
// CONTEXT CLASS
// =============================================================================
class Context {
    constructor(wildcards = new Map(), configs = new Map(), activeConfig = {}) {
        this.wildcards = wildcards;       // @name -> [option1, option2, ...]
        this.configs = configs;           // #name -> { configObject }
        this.activeConfig = activeConfig; // Currently applied config
    }

    clone() {
        return new Context(
            new Map(this.wildcards),
            new Map(this.configs),
            JSON.parse(JSON.stringify(this.activeConfig))
        );
    }
}

/**
 * Extracts balanced braces content starting from a given index.
 * Tracks both {} and [] for proper JSON support.
 * @param {string} str - The string to parse.
 * @param {number} start - The index of the opening brace.
 * @returns {{content: string, end: number}|null} - The content inside braces and the end index.
 */
function extractBalancedBraces(str, start) {
    if (str[start] !== '{') return null;
    let curlyDepth = 0;
    let squareDepth = 0;
    let i = start;
    for (; i < str.length; i++) {
        const char = str[i];
        if (char === '{') curlyDepth++;
        else if (char === '}') {
            curlyDepth--;
            // Only return when we've closed all nested braces AND brackets
            if (curlyDepth === 0 && squareDepth === 0) {
                return { content: str.substring(start, i + 1), end: i };
            }
        }
        else if (char === '[') squareDepth++;
        else if (char === ']') squareDepth--;
    }
    return null; // Unbalanced
}

/**
 * Parses the preamble for wildcard and config definitions, and returns cleaned text.
 * @param {string} preamble - The text before the [sequence].
 * @param {Context} context - The context to populate.
 * @returns {string} - The preamble with definitions removed.
 */
function parseDefinitions(preamble, context) {
    let cleanedPreamble = preamble;
    
    // --- Parse Wildcard Definitions: @name := { opt1 | opt2 } ---
    const wildcardDefRegex = /@(\w+)\s*:=\s*\{/g;
    let match;
    const wildcardRanges = [];
    
    while ((match = wildcardDefRegex.exec(preamble)) !== null) {
        const name = match[1];
        const braceStart = match.index + match[0].length - 1; // Position of '{'
        const extracted = extractBalancedBraces(preamble, braceStart);
        if (extracted) {
            const inner = extracted.content.slice(1, -1); // Remove { and }
            const options = inner.split('|').map(s => s.trim()).filter(s => s.length > 0);
            context.wildcards.set(name, options);
            console.log(`Defined wildcard: @${name} with ${options.length} options.`);
            // Mark range for removal
            wildcardRanges.push({ start: match.index, end: extracted.end + 1 });
        }
    }

    // --- Parse Config Definitions: #name := { ... } (JSON with balanced braces) ---
    const configDefRegex = /#(\w+)\s*:=\s*\{/g;
    const configRanges = [];
    
    while ((match = configDefRegex.exec(preamble)) !== null) {
        const name = match[1];
        const braceStart = match.index + match[0].length - 1; // Position of '{'
        const extracted = extractBalancedBraces(preamble, braceStart);
        if (extracted) {
            try {
                const configObj = JSON.parse(extracted.content);
                context.configs.set(name, configObj);
                console.log(`Defined config: #${name}`);
                // Mark range for removal
                configRanges.push({ start: match.index, end: extracted.end + 1 });
            } catch (e) {
                console.log(`Warning: Could not parse config #${name}: ${e.message}`);
                console.log(`  Config text: ${extracted.content.substring(0, 100)}...`);
            }
        }
    }
    
    // Remove definitions from preamble (process in reverse order to maintain indices)
    const allRanges = [...wildcardRanges, ...configRanges].sort((a, b) => b.start - a.start);
    for (const range of allRanges) {
        cleanedPreamble = cleanedPreamble.substring(0, range.start) + cleanedPreamble.substring(range.end);
    }
    
    return cleanedPreamble.trim();
}



/**
 * Splits the [shot1 | shot2] sequence by | respecting braces.
 * @param {string} input - The content inside [...].
 * @returns {string[]} - Array of shot strings.
 */
function parsePhotoshootSequence(input) {
    input = input.trim();
    if (input.startsWith('[') && input.endsWith(']')) {
        input = input.substring(1, input.length - 1);
    }
    const shots = [];
    let currentShot = "";
    let braceDepth = 0;

    for (let i = 0; i < input.length; i++) {
        const char = input[i];
        if (char === '{') braceDepth++;
        else if (char === '}') braceDepth--;

        if (char === '|' && braceDepth === 0) {
            if (currentShot.trim()) shots.push(currentShot.trim());
            currentShot = "";
        } else {
            currentShot += char;
        }
    }
    if (currentShot.trim()) shots.push(currentShot.trim());
    return shots;
}

// =============================================================================
// EXPANSION FUNCTION
// =============================================================================

/**
 * Expands wildcards (@name) and applies configs (#name) in a shot.
 * @param {string} text - The shot text.
 * @param {Context} context - The context with definitions.
 * @returns {string} - The expanded prompt.
 */
function expandWildcards(text, context) {
    let result = text;
    let iterations = 0;
    const maxIterations = 50; // Prevent infinite loops

    while (iterations < maxIterations) {
        let changed = false;

        // 1. Apply config flags (#name)
        const configFlagRegex = /#(\w+)(?=\s|$|[,\.\!\?])/g;
        result = result.replace(configFlagRegex, (match, name) => {
            const configObj = context.configs.get(name);
            if (configObj) {
                // Merge config into activeConfig
                Object.assign(context.activeConfig, configObj);
                console.log(`Applied config: #${name}`);
                changed = true;
                return ''; // Remove the flag from the prompt
            }
            return match; // Keep if not found
        });

        // 2. Expand inline wildcards { opt1 | opt2 }
        const inlineWildcardRegex = /\{([^{}]+)\}/g;
        result = result.replace(inlineWildcardRegex, (match, optionsStr) => {
            const options = optionsStr.split('|').map(s => s.trim()).filter(s => s.length > 0);
            if (options.length > 0) {
                const pick = options[Math.floor(Math.random() * options.length)];
                changed = true;
                return pick;
            }
            return match;
        });

        // 3. Expand named wildcards (@name)
        const namedWildcardRegex = /@(\w+)/g;
        result = result.replace(namedWildcardRegex, (match, name) => {
            const options = context.wildcards.get(name);
            if (options && options.length > 0) {
                const pick = options[Math.floor(Math.random() * options.length)];
                changed = true;
                return pick;
            }
            return match; // Keep if not found
        });

        if (!changed) break;
        iterations++;
    }

    // Clean up extra whitespace
    result = result.replace(/\s+/g, ' ').trim();
    return result;
}

// =============================================================================
// MAIN EXECUTION
// =============================================================================

// Note: originalConfig is already declared at the top of the script
const baseContext = new Context();
let taskQueue = [];

// --- Detect Mode ---
// We need to find the SHOT SEQUENCE [shot1 | shot2] - NOT JSON arrays inside configs.
// Strategy: Find [ that is followed (at some point) by | and ]
let preamble = "";
let sequenceBlock = "";
let isPhotoshootMode = false;
let seqStart = -1;
let seqEnd = -1;

// Look for "PROMPT:" marker first (user's format)
const promptMarker = promptString.indexOf('PROMPT:');
if (promptMarker !== -1) {
    // Find [ after PROMPT:
    seqStart = promptString.indexOf('[', promptMarker);
} else {
    // Find the LAST [ that starts a valid shot sequence (contains | at depth 0)
    // Scan backwards from end to find the outermost [ ] pair
    let bracketStack = 0;
    for (let i = promptString.length - 1; i >= 0; i--) {
        if (promptString[i] === ']' && bracketStack === 0) {
            seqEnd = i;
            bracketStack++;
        } else if (promptString[i] === ']') {
            bracketStack++;
        } else if (promptString[i] === '[') {
            bracketStack--;
            if (bracketStack === 0 && seqEnd > i) {
                // Check if this bracket pair contains a pipe at depth 0
                const candidate = promptString.substring(i, seqEnd + 1);
                let depth = 0;
                let hasPipe = false;
                for (let j = 0; j < candidate.length; j++) {
                    if (candidate[j] === '[' || candidate[j] === '{') depth++;
                    else if (candidate[j] === ']' || candidate[j] === '}') depth--;
                    else if (candidate[j] === '|' && depth === 1) {
                        hasPipe = true;
                        break;
                    }
                }
                if (hasPipe) {
                    seqStart = i;
                    break;
                }
            }
        }
    }
}

// If we found a PROMPT: marker, find the closing ]
if (seqStart !== -1 && seqEnd === -1) {
    seqEnd = promptString.lastIndexOf(']');
}

if (seqStart !== -1 && seqEnd !== -1 && seqEnd > seqStart) {
    isPhotoshootMode = true;
    preamble = promptString.substring(0, seqStart).trim();
    sequenceBlock = promptString.substring(seqStart, seqEnd + 1).trim();
    console.log(`Found sequence from index ${seqStart} to ${seqEnd}`);
}

// --- Parse Definitions from Preamble ---
const cleanedPreamble = parseDefinitions(preamble, baseContext);
console.log(`Cleaned preamble length: ${cleanedPreamble.length}`);


if (isPhotoshootMode) {
    // --- PHOTOSHOOT MODE ---
    console.log("Mode: Sequential Shots");

    const shots = parsePhotoshootSequence(sequenceBlock);
    console.log(`Found ${shots.length} shots.`);

    for (let i = 0; i < shots.length; i++) {
        const rawShot = shots[i];
        for (let j = 0; j < batchCount; j++) {
            const context = baseContext.clone();
            const expandedPrompt = expandWildcards(rawShot, context);
            const mergedConfig = Object.assign({}, originalConfig, context.activeConfig);
            taskQueue.push({ prompt: expandedPrompt, config: mergedConfig });
        }
    }
} else {
    // --- STANDARD BATCH MODE ---
    console.log("Mode: Standard Batch (no sequence detected)");

    for (let i = 0; i < batchCount; i++) {
        const context = baseContext.clone();
        const expandedPrompt = expandWildcards(promptString, context);
        const mergedConfig = Object.assign({}, originalConfig, context.activeConfig);
        taskQueue.push({ prompt: expandedPrompt, config: mergedConfig });
    }
}

// --- Execute Tasks ---
console.log(`Executing ${taskQueue.length} tasks...`);

for (let i = 0; i < taskQueue.length; i++) {
    const task = taskQueue[i];
    console.log(`[${i + 1}/${taskQueue.length}] Generating: ${task.prompt.substring(0, 50)}...`);

    pipeline.run({
        configuration: task.config,
        prompt: task.prompt
    });
}

console.log("All tasks completed.");
