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
        // 503 = edge function cold start — wait longer and retry
        if (attempt < retries && (res.status >= 500 || res.status === 503)) {
          const delay = res.status === 503 ? 3000 + attempt * 1000 : Math.pow(2, attempt) * 800;
          Logger.warn('Claude', `Retrying in ${delay}ms (cold start or server error)`);
          await new Promise(r => setTimeout(r, delay));
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

// Haiku — single item photo classification with brand detection
export async function analyzeClothingPhoto(base64, mimeType = 'image/jpeg') {
  Logger.info('Claude', 'Analyzing clothing photo (Haiku)');
  const text = await callClaude({
    model: MODELS.fast,
    system: `You are a fashion expert and brand identifier. Analyze this clothing/accessory item photo.
RULES:
- Only describe what is CLEARLY VISIBLE in the image
- Look for brand logos, labels, text, distinctive design patterns to identify brand and model
- Ignore the person's face, skin, background
- Do NOT guess accessories that aren't visible
Return ONLY valid JSON: { "name": string (include brand+model if identified e.g. "Nike Air Force 1"), "category": one of [Tops,Bottoms,Dresses,Outerwear,Shoes,Jewelry,Watches,Bags,Hats,Belts,Sunglasses,Activewear,Swimwear,Loungewear], "color": string, "colors": string[], "material": string, "fit": string, "brand": string (empty string if not identifiable), "model": string (empty string if not identifiable) }`,
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
      { type: 'text', text: 'What clothing/accessory item is this? Identify brand and model if visible. Return JSON only.' }
    ]}],
    max_tokens: 512,
  });
  return parseClaudeJSON(text);
}

/**
 * Splits a photo into individual clothing items WITH bounding boxes for cropping.
 * Returns each item with crop coordinates so we can auto-crop a clean product shot.
 * Uses Sonnet for accuracy on the bounding box task — Haiku struggles with coordinates.
 */
export async function splitOutfitIntoItems(base64, mimeType = 'image/jpeg') {
  Logger.info('Claude', 'Splitting outfit into items with bounding boxes (Sonnet)');
  const text = await callClaude({
    model: MODELS.smart,
    system: `You are a computer vision expert and fashion analyst. Analyze this photo and detect every clothing item and accessory that is CLEARLY VISIBLE.

For each item return its location in the image as a bounding box using percentage coordinates (0-100) from top-left corner.

CRITICAL RULES:
- ONLY include items you are 90%+ confident are present
- Do NOT guess accessories not clearly visible (no sunglasses, watch, ring unless clearly shown)
- Ignore the person's face and skin
- Detect brand logos, text, labels on items
- Bounding box must TIGHTLY surround just the item, not the whole body
- For shoes: crop just the foot/shoe area
- For tops: crop just the torso/shirt area
- For pants: crop just the legs/pants area

Return ONLY valid JSON array:
[{
  "name": "brand+model name e.g. On Running Cloud 5 White",
  "category": "Tops|Bottoms|Dresses|Outerwear|Shoes|Jewelry|Watches|Bags|Hats|Belts|Sunglasses|Activewear|Swimwear|Loungewear",
  "color": "primary color",
  "colors": ["all colors visible"],
  "material": "fabric type if identifiable",
  "fit": "slim|regular|loose|oversized|tailored",
  "brand": "brand if logo visible",
  "model": "model name if identifiable",
  "fingerprint": "unique descriptor for dedup e.g. 'on-running-cloud5-white-mens-shoe'",
  "bbox": {
    "left": 0-100,
    "top": 0-100,
    "width": 0-100,
    "height": 0-100
  }
}]`,
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
      { type: 'text', text: 'Detect all clearly visible clothing items and accessories. Include tight bounding boxes for each item so I can crop them individually.' }
    ]}],
    max_tokens: 2000,
  });
  const parsed = parseClaudeJSON(text);
  const items = Array.isArray(parsed) ? parsed : parsed.items || [];
  Logger.info('Claude', `Detected ${items.length} items with bounding boxes`);
  return items;
}

// Sonnet — Couple outfit generation for date night occasions
export async function generateCoupleOutfits({ hisProfile, herProfile, hisWardrobe, herWardrobe, occasion, location, weather }) {
  Logger.info('Claude', 'Generating couple outfits', { occasion, his: hisProfile?.display_name, hers: herProfile?.display_name });

  const formatWardrobe = (items, name) => items.length > 0
    ? items.map(i => `  - ${i.name || i.category}: ${i.color} ${i.category}${i.brand ? ` (${i.brand})` : ''}${i.fit ? `, ${i.fit}` : ''}`).join('\n')
    : `  (${name}'s wardrobe is empty — suggest conceptually)`;

  const weatherContext = weather ? `WEATHER: ${weather.summary}\n${weather.dressingAdvice}` : 'Weather: mild';

  const systemText = `You are Stylie — an elite couples stylist. Generate 3 coordinated couple outfit combinations for ${hisProfile?.display_name || 'Him'} & ${herProfile?.display_name || 'Her'} going out together.

OCCASION: ${occasion}${location ? ` at ${location}` : ''}
${weatherContext}

HIS PROFILE: Body: ${hisProfile?.body_type}, Skin: ${hisProfile?.skin_tone}, Style: ${(hisProfile?.style_vibe||[]).join(', ')}
HIS WARDROBE:
${formatWardrobe(hisWardrobe, hisProfile?.display_name || 'His')}

HER PROFILE: Body: ${herProfile?.body_type}, Skin: ${herProfile?.skin_tone}, Style: ${(herProfile?.style_vibe||[]).join(', ')}
HER WARDROBE:
${formatWardrobe(herWardrobe, herProfile?.display_name || 'Her')}

COUPLE STYLING RULES:
- Outfits must COMPLEMENT each other (coordinated colors, matching vibe, same formality level)
- Do NOT make them match exactly (that looks tacky) — complement, not clone
- Consider how they look standing together as a couple
- Apply color harmony between both outfits
- Match energy: if he's smart casual, she shouldn't be in a ball gown
- Return ONLY valid JSON

JSON format:
{
  "couple_outfits": [
    {
      "name": "Couple look name",
      "vibe": "e.g. Coordinated Elegance",
      "his": { "items": [], "description": "", "styling_tip": "" },
      "her": { "items": [], "description": "", "styling_tip": "" },
      "why_together": "Why these two outfits work as a couple look",
      "color_story": "How the colors interact between both outfits",
      "confidence": 8
    }
  ],
  "his_hair": { "suggestion": "", "how_to": "", "time_needed": "" },
  "her_hair": { "suggestion": "", "how_to": "", "time_needed": "" },
  "couple_tip": "One golden tip for looking great together"
}`;

  const text = await callClaude({
    model: MODELS.smart,
    system: [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: `Generate 3 coordinated couple outfit options for: ${occasion}` }],
    max_tokens: 4000,
  });
  return parseClaudeJSON(text);
}

// Sonnet — Stylie-level outfit generation with weather + trends + wardrobe
export async function generateOutfits({ profile, wardrobeItems, occasion, location, weather, previousOutfitIds = [] }, extraSuggestions = false) {
  Logger.info('Claude', 'Generating Stylie outfits', {
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

  const system = `You are Stylie — — an elite personal AI stylist with the knowledge of a Vogue editor, a personal shopper, and a fashion psychologist combined.

YOUR JOB: Generate ${extraSuggestions ? '3 fresh alternative' : '3 perfect'} outfit suggestions from this person's wardrobe that account for EVERYTHING — weather, occasion, body type, skin tone, color theory, current trends, and personal style.

━━ PERSON PROFILE ━━
Name: ${profile.display_name || 'User'}
Body type: ${profile.body_type || 'not specified'}
Skin tone: ${profile.skin_tone || 'not specified'}
Style vibe: ${(profile.style_vibe || []).join(', ') || 'not specified'}
Hair type: ${profile.hair_type || 'not specified'}, Length: ${profile.hair_length || 'not specified'}
Hair styling method: ${profile.hair_styling_method || 'not specified'}
Hair tools available: ${(profile.hair_styling_tools || []).join(', ') || 'not specified'}

━━ WEATHER INTELLIGENCE ━━
${weatherContext}
${weather?.alerts?.length ? `WEATHER ALERTS: ${weather.alerts.map(a=>`[${a.level.toUpperCase()}] ${a.message}`).join(' | ')}` : ''}
${location && /hike|trail|mountain|rainier|outdoor|park|camp/i.test(location) ? `OUTDOOR ACTIVITY DETECTED: "${location}" — prioritize weather protection, layers, and activity-appropriate footwear. Mention trail conditions if weather is severe.` : ''}

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
    "suggestion": "Specific hairstyle name achievable with their tools",
    "how_to": "Step-by-step using ONLY tools they own (blowdryer/straightener etc)",
    "time_needed": "e.g. 10 mins",
    "cap_recommendation": "Should they wear a cap/hat today? Yes/No and which type if yes",
    "why": "Why this style works for the occasion, weather, and their hair type"
  },
  "avoid_today": "What NOT to wear today and why (weather/occasion based)",
  "shopping_gap": "One item missing from wardrobe that would elevate these looks"
}`;

  // Send system as array with cache_control on the static block
  // The profile + wardrobe block is cached for 5 min — same content = cache hit = ~90% cost reduction
  const systemBlocks = [
    {
      type: 'text',
      text: system,
      cache_control: { type: 'ephemeral' }, // cache this expensive context
    }
  ];

  const text = await callClaude({
    model: MODELS.smart,
    system: systemBlocks,
    messages: [{ role: 'user', content: `Generate ${extraSuggestions ? '3 fresh alternative' : '3 perfect'} outfits for: ${occasion}${location ? `, at/in ${location}` : ''}${weather ? `. Weather: ${weather.summary}` : ''}. Be specific and use items from my wardrobe.` }],
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
