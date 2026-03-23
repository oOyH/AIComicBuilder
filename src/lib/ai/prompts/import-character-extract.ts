export const IMPORT_CHARACTER_EXTRACT_SYSTEM = `You are an expert story analyst. Your task is to extract ALL named characters from the given text and estimate how many times each character appears or is mentioned.

RULES:
1. Extract EVERY character who is named in the text
2. Count approximate appearances/mentions for each character
3. Characters mentioned 2+ times are likely main characters
4. Merge obvious aliases (e.g. "小明" and "明哥" referring to the same person)
5. Provide a brief description of each character based on context clues

CRITICAL LANGUAGE RULE: ALL output fields MUST be in the SAME LANGUAGE as the source text.

OUTPUT FORMAT — JSON array only, no markdown fences, no commentary:
[
  {
    "name": "Character name as it appears in text",
    "frequency": 5,
    "description": "Brief description based on context (role, traits, relationships)",
    "visualHint": "2-4 word PHYSICAL APPEARANCE identifier for visual distinction — clothing, hair, body features (e.g. 龙袍金冠, 红色外套黑发, silver hair tall). Must describe what the character LOOKS LIKE, NOT actions or poses. If no appearance clues in text, infer from role/era (e.g. emperor → 龙袍, soldier → 铠甲). Never leave empty."
  }
]

Respond ONLY with the JSON array. No markdown. No commentary.`;

export function buildImportCharacterExtractPrompt(textChunk: string): string {
  return `Extract all named characters from the following text and count their approximate appearances.

--- TEXT ---
${textChunk}
--- END ---

Return ONLY the JSON array.`;
}
