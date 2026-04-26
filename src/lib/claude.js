import { supabase } from './supabase';
import Logger from './logger';

const EDGE_FN_URL = 'https://wpzgcwvjzhzurmbirdsj.supabase.co/functions/v1/claude-ai';

/**
 * Call Claude via Supabase Edge Function.
 * Supports text and image (base64) messages.
 * Implements retry with exponential backoff for transient errors.
 */
export async function callClaude({ system, messages, max_tokens = 2048, model = 'claude-sonnet-4-6' }, retries = 2) {
  const done = Logger.perf('Claude', `callClaude(${model})`);
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    Logger.error('Claude', 'No auth session — cannot call Claude');
    throw new Error('Not authenticated');
  }

  Logger.info('Claude', 'Calling edge function', { model, max_tokens, messageCount: messages.length });

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(EDGE_FN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ model, max_tokens, system, messages }),
      });

      if (!res.ok) {
        const errText = await res.text();
        Logger.error('Claude', `HTTP ${res.status} on attempt ${attempt + 1}`, errText);
        if (attempt < retries && res.status >= 500) {
          const delay = Math.pow(2, attempt) * 800;
          Logger.warn('Claude', `Retrying in ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw new Error(`Claude API error: ${res.status}`);
      }

      const data = await res.json();
      const text = data.content?.[0]?.text || '';
      Logger.info('Claude', `Response received — ${text.length} chars`, {
        inputTokens: data.usage?.input_tokens,
        outputTokens: data.usage?.output_tokens,
      });
      done();
      return text;
    } catch (e) {
      if (attempt === retries) throw e;
      Logger.warn('Claude', `Attempt ${attempt + 1} failed, retrying`, e.message);
      await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 800));
    }
  }
}

/**
 * Parse JSON safely from Claude response (handles markdown code fences)
 */
export function parseClaudeJSON(text) {
  try {
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);
    Logger.debug('Claude', 'JSON parsed OK');
    return parsed;
  } catch (e) {
    Logger.error('Claude', 'JSON parse failed', { text: text.slice(0, 200), error: e.message });
    throw new Error('Could not parse AI response');
  }
}

/**
 * Analyze a clothing item photo — returns { name, category, color, material, fit }
 */
export async function analyzeClothingPhoto(base64, mimeType = 'image/jpeg') {
  Logger.info('Claude', 'Analyzing clothing photo');
  const text = await callClaude({
    system: 'You are a fashion expert and image analyst. Analyze the clothing item in this photo. Return ONLY valid JSON with these fields: name (string), category (one of: Tops/Bottoms/Dresses/Outerwear/Shoes/Accessories/Activewear/Swimwear/Loungewear), color (primary color), colors (array of all colors), material (guess from appearance), fit (slim/regular/loose/oversized/tailored). No markdown, no explanation.',
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
        { type: 'text', text: 'Analyze this clothing item and return JSON.' }
      ]
    }],
    max_tokens: 512,
  });
  return parseClaudeJSON(text);
}

/**
 * Analyze a full worn-outfit photo — returns array of recognized items
 */
export async function analyzeWornOutfit(base64, mimeType = 'image/jpeg') {
  Logger.info('Claude', 'Analyzing worn outfit photo');
  const text = await callClaude({
    system: 'You are a fashion expert. Analyze this photo of a person in an outfit. Return ONLY valid JSON: { "items": [{ "name", "category", "color", "fit" }], "overall_style": string, "occasion_suitability": string }. No markdown.',
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
        { type: 'text', text: 'What is this person wearing? List all clothing items.' }
      ]
    }],
    max_tokens: 1024,
  });
  return parseClaudeJSON(text);
}

/**
 * Generate 3 outfit suggestions from wardrobe + profile
 */
export async function generateOutfits({ profile, wardrobeItems, occasion, location, weather }) {
  Logger.info('Claude', 'Generating outfits', { occasion, itemCount: wardrobeItems.length });

  const wardrobeText = wardrobeItems.length > 0
    ? wardrobeItems.map(i =>
        `- ${i.name || i.category}: ${i.color} ${i.category}${i.fit ? `, ${i.fit} fit` : ''}${i.material ? `, ${i.material}` : ''}${i.brand ? ` (${i.brand})` : ''}${i.occasions?.length ? `, worn for: ${i.occasions.join('/')}` : ''}`
      ).join('\n')
    : 'Wardrobe is empty — suggest ideal outfit concepts based on the profile and occasion.';

  const system = `You are a world-class personal AI stylist. Generate 3 complete outfit suggestions.

PROFILE:
- Name: ${profile.display_name || 'User'}
- Body type: ${profile.body_type || 'not specified'}
- Skin tone: ${profile.skin_tone || 'not specified'}
- Style vibe: ${(profile.style_vibe || []).join(', ') || 'not specified'}
- Hair: ${profile.hair_type || ''} ${profile.hair_length || ''}

WARDROBE:
${wardrobeText}

RULES:
- Prefer items from the wardrobe above
- Apply color theory (complementary, neutral anchors, skin tone contrast)
- Consider body type flattery and occasion appropriateness
- Each outfit must include: top or dress, bottom (if not dress), shoes, optional accessories
- Return ONLY valid JSON, no markdown

JSON structure:
{
  "outfits": [
    {
      "name": string,
      "tagline": string (e.g. "Sharp and effortless"),
      "description": string,
      "items": string[],
      "colors": string[],
      "why_it_works": string,
      "confidence": number (1-10)
    }
  ],
  "hair": {
    "suggestion": string,
    "style_detail": string,
    "why": string
  },
  "styling_tip": string,
  "avoid": string
}`;

  const text = await callClaude({
    system,
    messages: [{
      role: 'user',
      content: `Generate 3 outfits for: ${occasion}${location ? `, at ${location}` : ''}${weather ? `, weather: ${weather}` : ''}`
    }],
    max_tokens: 3000,
  });

  return parseClaudeJSON(text);
}
