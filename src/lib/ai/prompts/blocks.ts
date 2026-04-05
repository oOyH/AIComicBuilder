/**
 * Reusable prompt building blocks.
 * Extracted from duplicated text across multiple prompt templates.
 */

export function artStyleBlock(): string {
  return `## ART STYLE CONSISTENCY
- Maintain the visual style defined in the project's "Visual Style" section throughout ALL generated images
- Style elements include: rendering technique, color palette, lighting mood, texture quality
- DO NOT mix styles within a single project (e.g., no photorealistic character in cartoon background)
- If a specific art style is declared (anime, realistic, watercolor, etc.), ALL frames must match`;
}

export function referenceImageBlock(): string {
  return `## REFERENCE IMAGE USAGE
- Reference images define the character's canonical appearance
- Match: face shape, hair style/color, eye color, skin tone, outfit details, accessories
- Adapt: pose, expression, angle — these change per shot
- NEVER contradict the reference image's core identity markers`;
}

export function languageRuleBlock(defaultLang?: string): string {
  return `## CRITICAL LANGUAGE RULE
Output MUST match the input language. If the user writes in Chinese, respond entirely in Chinese. If English, respond entirely in English. Do not mix languages in the output.${
    defaultLang ? `\nDefault language if ambiguous: ${defaultLang}` : ""
  }`;
}
