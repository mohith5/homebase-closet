import { supabase } from './supabase';
import Logger from './logger';

const EDGE_FN_URL = 'https://wpzgcwvjzhzurmbirdsj.supabase.co/functions/v1/closet-ai';

// Model tiers — Haiku for simple tasks, Sonnet for complex reasoning
const MODELS = {
  fast: 'claude-haiku-4-5-20251001',   // photo classification, simple tasks
  smart: 'claude-sonnet-4-6',           // outfit generation, full reasoning
};

// Monthly soft cap — warn user when approaching
const MONTHLY_SOFT_CAP = 100;

async function getMonthlyUsage() {
  try {
    const month = new Date().toISOString().slice(0, 7); // "2026-04"
    const { data } = await supabase
      .from('closet_ai_usage')
      .select('calls')
      .eq('month', month)
      .maybeSingle();
    return data?.calls || 0;
  } catch { return 0; }
}

async function incrementUsage() {
  try {
    const month = new Date().toISOString().slice(0, 7);
    const { data } = await supabase.from('closet_ai_usage').select('id,calls').eq('month', month).maybeSingle();
    if (data) {
      await supabase.from('closet_ai_usage').update({ calls: data.calls + 1 }).eq('id', data.id);
    } else {
      await supabase.from('closet_ai_usage').insert({ month, calls: 1 });
    }
  } catch (e) { Logger.warn('Claude', 'Usage increment failed', e); }
}

export async function callClaude({ system, messages, max_tokens = 2048, model = MODELS.smart }, retries = 2) {
  const done = Logger.perf('Claude', `callClaude(${model})`);
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  // Check monthly usage
  const usage = await getMonthlyUsage();
  if (usage >= MONTHLY_SOFT_CAP) {
    Logger.warn('Claude', `Monthly soft cap reached: ${usage} calls`);
    throw new Error(`Monthly AI limit reached (${usage} calls). Resets next month.`);
  }

  Logger.info('Claude', 'Calling AI', { model, usage: `${usage}/${MONTHLY_SOFT_CAP}` });

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
        Logger.error('Claude', `HTTP ${res.status} attempt ${attempt + 1}`, errText);
        if (attempt < retries && res.status >= 500) {
          await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 800));
          continue;
        }
        throw new Error(`Claude API error: ${res.status}`);
      }

      const data = await res.json();
      const text = data.content?.[0]?.text || '';
      Logger.info('Claude', `Response OK — ${text.length} chars`, {
        inputTokens: data.usage?.input_tokens,
        outputTokens: data.usage?.output_tokens,
        callsThisMonth: usage + 1,
      });
      await incrementUsage();
      done();
      return text;
    } catch (e) {
      if (attempt === retries) throw e;
      await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 800));
    }
  }
}

export function parseClaudeJSON(text) {
  try {
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned);
  } catch (e) {
    Logger.error('Claude', 'JSON parse failed', { preview: text.slice(0, 200) });
    throw new Error('Could not parse AI response');
  }
}

// Haiku — cheap, fast photo classification
export async function analyzeClothingPhoto(base64, mimeType = 'image/jpeg') {
  Logger.info('Claude', 'Analyzing clothing photo (Haiku)');
  const text = await callClaude({
    model: MODELS.fast,
    system: 'You are a fashion expert. Analyze this clothing item photo. Return ONLY valid JSON: { "name": string, "category": one of [Tops,Bottoms,Dresses,Outerwear,Shoes,Jewelry,Watches,Bags,Hats,Belts,Sunglasses,Activewear,Swimwear,Loungewear], "color": string, "colors": string[], "material": string, "fit": string }',
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
      { type: 'text', text: 'What clothing/accessory item is this? Return JSON only.' }
    ]}],
    max_tokens: 512,
  });
  return parseClaudeJSON(text);
}

// Haiku — splits a full outfit photo into individual items
export async function splitOutfitIntoItems(base64, mimeType = 'image/jpeg') {
  Logger.info('Claude', 'Splitting outfit into individual items (Haiku)');
  const text = await callClaude({
    model: MODELS.fast,
    system: 'You are a fashion expert. Analyze this photo of a person wearing an outfit. Identify EACH separate clothing item and accessory. Return ONLY valid JSON array: [{ "name": string, "category": string, "color": string, "material": string, "fit": string }]. Categories: Tops, Bottoms, Dresses, Outerwear, Shoes, Jewelry, Watches, Bags, Hats, Belts, Sunglasses, Activewear.',
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
      { type: 'text', text: 'List every clothing item and accessory this person is wearing as separate JSON objects.' }
    ]}],
    max_tokens: 1024,
  });
  const parsed = parseClaudeJSON(text);
  return Array.isArray(parsed) ? parsed : parsed.items || [];
}

// Sonnet — Jarvis-level outfit generation with weather + trends + wardrobe
export async function generateOutfits({ profile, wardrobeItems, occasion, location, weather, previousOutfitIds = [] }, extraSuggestions = false) {
  Logger.info('Claude', 'Generating Jarvis outfits', {
    occasion,
    wardrobeCount: wardrobeItems.length,
    hasWeather: !!weather,
    extraSuggestions,
  });

  const wardrobeText = wardrobeItems.length > 0
    ? wardrobeItems.map((i, idx) =>
        `[${idx}] ${i.name || i.category}: ${i.color} ${i.category}${i.fit ? `, ${i.fit} fit` : ''}${i.material ? `, ${i.material}` : ''}${i.brand ? ` (${i.brand})` : ''}${i.occasions?.length ? ` — worn for: ${i.occasions.join('/')}` : ''}`
      ).join('\n')
    : 'Wardrobe is empty — suggest ideal outfit concepts based on style profile and occasion.';

  const weatherContext = weather
    ? `CURRENT WEATHER (${weather.city}): ${weather.summary}\nDressing advice: ${weather.dressingAdvice}`
    : 'Weather: Not provided — assume mild conditions.';

  const currentMonth = new Date().toLocaleString('en-US', { month: 'long' });
  const currentSeason = getSeason();

  const system = `You are JARVIS — an elite personal AI stylist with the knowledge of a Vogue editor, a personal shopper, and a fashion psychologist combined.

YOUR JOB: Generate ${extraSuggestions ? '3 fresh alternative' : '3 perfect'} outfit suggestions from this person's wardrobe that account for EVERYTHING — weather, occasion, body type, skin tone, color theory, current trends, and personal style.

━━ PERSON PROFILE ━━
Name: ${profile.display_name || 'User'}
Body type: ${profile.body_type || 'not specified'}
Skin tone: ${profile.skin_tone || 'not specified'}
Style vibe: ${(profile.style_vibe || []).join(', ') || 'not specified'}
Hair: ${profile.hair_type || ''} ${profile.hair_length || ''}

━━ WEATHER INTELLIGENCE ━━
${weatherContext}

━━ CURRENT TRENDS (${currentSeason} ${new Date().getFullYear()}) ━━
- Season: ${currentSeason}, Month: ${currentMonth}
- Apply current seasonal color palettes and layering trends
- Consider what's trending for ${occasion} occasions right now
- Factor in weather-appropriate fabrics and textures

━━ WARDROBE ━━
${wardrobeText}

━━ RULES ━━
1. ONLY use items from the wardrobe above (reference by name/description)
2. If wardrobe is empty, suggest what they should wear conceptually
3. NEVER repeat the same combination${previousOutfitIds.length ? ` — avoid outfits similar to previous suggestions` : ''}
4. Each outfit MUST be weather-appropriate
5. Apply color theory: complementary colors, skin tone contrast, seasonal palette
6. Body type flattery: suggest fits and cuts that work for ${profile.body_type || 'their body type'}
7. Include accessories if available (jewelry, watches, bags, belts)
8. Return ONLY valid JSON — no markdown, no explanation outside JSON

━━ RESPONSE FORMAT ━━
{
  "weather_note": "one sentence on how weather shaped these choices",
  "trend_note": "one sentence on current trend applied",
  "outfits": [
    {
      "name": "Creative outfit name",
      "tagline": "Short punchy descriptor",
      "description": "2 sentence description of the look and why it works",
      "items": ["exact item names from wardrobe"],
      "colors": ["hex or color names in this outfit"],
      "occasion_fit": "why this works for the occasion",
      "weather_fit": "why this is right for the weather",
      "why_it_works": "color theory + body type + skin tone explanation",
      "styling_tip": "one specific tip to elevate this look",
      "confidence": 8
    }
  ],
  "hair": {
    "suggestion": "Specific hairstyle name",
    "how_to": "Brief how-to",
    "why": "Why this works for the occasion + face/hair type"
  },
  "avoid_today": "What NOT to wear today and why (weather/occasion based)",
  "shopping_gap": "One item missing from wardrobe that would elevate these looks"
}`;

  const text = await callClaude({
    model: MODELS.smart,
    system,
    messages: [{ role: 'user', content: `Generate ${extraSuggestions ? '3 fresh alternative' : '3 perfect'} outfits for: ${occasion}${location ? `, at/in ${location}` : ''}. Be specific and use items from my wardrobe.` }],
    max_tokens: 3500,
  });

  return parseClaudeJSON(text);
}

function getSeason() {
  const month = new Date().getMonth();
  if (month >= 2 && month <= 4) return 'Spring';
  if (month >= 5 && month <= 7) return 'Summer';
  if (month >= 8 && month <= 10) return 'Fall';
  return 'Winter';
}

export { MODELS };
