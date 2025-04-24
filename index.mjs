// === Lambda Handler for Syllabl Word Info API ===

// === Lambda Entry Point ===
export async function handler(event) {
  let state = {
    syllableOverrideUsed: false
  };
  try {
    console.log("Received event:", JSON.stringify(event, null, 2));
    console.log("[INFO] Starting validation and processing for input word...");

    // --- Input Validation & Logging ---
    const word = event.queryStringParameters?.word?.toLowerCase();
    if (!word) {
      console.warn("Request missing 'word' parameter.");
      return errorResponse('please enter a word to begin.', 400);
    }
    
    console.log(`[INFO] Word to process: '${word}'`);

    // --- Environment Setup ---
    const mwApiKey = process.env.MW_API_KEY;
    if (!mwApiKey) {
      console.error("Missing Merriam-Webster API key in environment variables.");
      return errorResponse('something went wrong on our end. try again in a bit?', 500);
    }
    console.log("[INFO] MW API key found. Preparing dictionary request...");

    // --- MW API Request ---
    const mwUrl = `https://www.dictionaryapi.com/api/v3/references/collegiate/json/${encodeURIComponent(word)}?key=${mwApiKey}`;
    console.log("Fetching syllables from Merriam-Webster...");
    const mwRes = await fetch(mwUrl);

    if (!mwRes.ok) {
      console.error(`Failed to fetch syllables. Status: ${mwRes.status}`);
      return errorResponse('we couldn’t look that one up right now. mind trying again?', 500);
    }

    const mwData = await mwRes.json();
    console.log("[INFO] Received dictionary response from MW.");

    // --- MW Data Sanity Checks ---
    if (Array.isArray(mwData) && typeof mwData[0] === "string") {
      console.warn(`Word '${word}' not found. MW returned suggestions only.`);
      return errorResponse('we couldn’t find this word in the dictionary. try something else?', 400);
    }

    if (!Array.isArray(mwData) || mwData.length === 0) {
      console.warn(`Word '${word}' is invalid (no valid entries found).`);
      console.warn("[WARN] All MW entries invalid for this word.");
      return errorResponse('we couldn’t find this word in the dictionary. try something else?', 400);
    }

    // --- Offensive Content Filtering ---
    const offensiveCount = mwData.filter(entry => entry.meta?.offensive === true).length;
    const offensiveRatio = offensiveCount / mwData.length;

    if (offensiveRatio >= 0.35) {
      console.warn(`Word '${word}' is rejected — ${Math.round(offensiveRatio * 100)}% of entries are offensive.`);
      console.warn(`[WARN] Offensive content ratio too high (${Math.round(offensiveRatio * 100)}%). Rejecting word.`);
      return errorResponse('this word was flagged as inappropriate for gameplay. keep it kid-friendly for everyone, please?', 400);
    }

    // --- Headword Validity Filtering ---
    const allEntriesInvalid = mwData.every(entry => {
      const hw = entry?.hwi?.hw?.replace(/\*/g, '');
      const firstChar = hw?.charAt(0);

      if (!hw) return true;
      if (firstChar === firstChar.toUpperCase()) return true;
      if (hw.includes(" ") || hw.includes("-") || hw.includes("'") || /\d/.test(hw)) return true;

      return false;
    });

    if (allEntriesInvalid) {
      return errorResponse('only single, common words are allowed — no names, no phrases, no hyphens.', 400);
    }

    // --- Syllable Resolution via MW Entry Matching ---
    let syllableCount = 0;
    let syllableList = [];
    let baseWordUsed = false;
    const wordLower = word.toLowerCase();

    for (const entry of mwData) {
      const baseHeadword = entry.hwi?.hw?.toLowerCase().replace(/\*/g, "");
      const rawHeadword = entry.hwi?.hw;
      const firstChar = rawHeadword?.replace(/\*/g, '')?.charAt(0);

      if (
        baseHeadword === wordLower &&
        rawHeadword &&
        firstChar === firstChar.toLowerCase()
      ) {
        if (rawHeadword.includes("*")) {
          syllableList = rawHeadword.split("*");
          syllableList = overrideWithPhonemeMismatch(wordLower, entry.hwi?.prs?.[0]?.mw, syllableList, state);
          syllableCount = syllableList.length;
          console.log(`[MATCH] Headword matched: '${rawHeadword}'`);
          continue;
        }
      }

      if (entry.meta?.stems?.includes(wordLower) && entry.ins && wordLower !== baseHeadword) {
        const inflected = entry.ins.find(inf =>
          inf.if.toLowerCase().replace(/\*/g, "") === wordLower
        );
        if (inflected?.if.includes("*")) {
          console.log(`[MATCH] Inflected form matched: '${inflected.if}'`);
          syllableList = inflected.if.split("*");

          // Use inflected.prs if available, otherwise fall back to entry.prs
          const phonemeSource = inflected.prs?.[0]?.mw
            ? inflected.prs[0].mw
            : entry.hwi?.prs;

          syllableList = overrideWithPhonemeMismatch(wordLower, phonemeSource, syllableList, state);
          syllableCount = syllableList.length;
          continue;
        }
      }

      if (Array.isArray(entry.uros)) {
        const pluralRunOnMatch = matchPluralRunOn(wordLower, entry.uros);
        if (pluralRunOnMatch) {
          const { runon, suffix } = pluralRunOnMatch;
          console.log(`[MATCH] Run-on matched: '${runon.ure}'`);
          syllableList = runon.ure.split("*");
          syllableList = overrideWithPhonemeMismatch(wordLower, runon.prs?.[0]?.mw, syllableList, state);
          syllableCount = syllableList.length;
          baseWordUsed = true;
        } else {
          for (const runon of entry.uros) {
            const baseForms = [runon.ure, ...(runon.vrs?.map(v => v.va) || [])]
              .filter(Boolean)
              .map(form => form.toLowerCase().replace(/\*/g, ""));

            for (const baseForm of baseForms) {
              if (baseForm === wordLower) {
                syllableList = runon.ure.split("*");
                syllableList = overrideWithPhonemeMismatch(wordLower, runon.prs?.[0]?.mw, syllableList, state);
                syllableCount = syllableList.length;
                baseWordUsed = true;
                break;
              }
            }

            if (syllableCount > 0) break;
          }
        }
      }
    }

    // --- Final Fallback Using MW 'hw' ---
    if (syllableCount === 0) {
      const fallbackEntry = mwData.find(entry => {
        const hw = entry?.hwi?.hw;
        const firstChar = hw?.replace(/\*/g, '')?.charAt(0);
        return firstChar && firstChar === firstChar.toLowerCase();
      });

      if (fallbackEntry?.hwi?.hw) {
        const firstChar = fallbackEntry.hwi.hw.replace(/\*/g, '')?.charAt(0);
        if (firstChar === firstChar.toUpperCase()) {
          return errorResponse('Only single, common words are allowed — no names or phrases.', 400);
        }

        syllableList = fallbackEntry.hwi.hw.split("*");
        syllableList = overrideWithPhonemeMismatch(wordLower, fallbackEntry.hwi.prs, syllableList, state);
        syllableCount = syllableList.length;
        baseWordUsed = true;
        console.log("[FALLBACK] Using MW headword field for syllables.");
      }
    }

    // --- Suffix Logic (Plurals & Past Tense) ---
    if (baseWordUsed) {
      const pluralSuffixes = [
        { match: "ies", syllables: 0, replaceY: true },
        { match: "es", syllables: 1, test: (base) => /(?:s|x|z|ch|sh)$/.test(base) },
        { match: "s", syllables: 0 }
      ];

      const matched = pluralSuffixes.find(sfx => wordLower.endsWith(sfx.match));
      if (matched) {
        const baseJoin = syllableList.join("").toLowerCase();
        const base = wordLower.slice(0, -matched.match.length);

        if (matched.match === "ies") {
          const baseLast = syllableList.at(-1);
          if (baseLast.endsWith("y")) {
            syllableList[syllableList.length - 1] = baseLast.slice(0, -1) + "ies";
          } else {
            syllableList[syllableList.length - 1] += "ies";
          }
        } else if (!matched.test || matched.test(base)) {
          if (baseJoin === base) {
            if (matched.syllables > 0) {
              syllableList.push(matched.match);
              syllableCount += matched.syllables;
              console.log(`[ADJUST] Applied plural suffix '${matched.match}' to base.`);
            } else {
              syllableList[syllableList.length - 1] += matched.match;
            }
          }
        }
      }

      const joinedWord = syllableList.join("").toLowerCase();
      if (joinedWord !== wordLower) {
        const pastTenseSuffixes = [
          { match: "ied", syllables: 0, replaceY: true },
          { match: "ed", syllables: 1, test: (base) => /[td]$/.test(base) },
          { match: "ed", syllables: 0, test: (base) => /[^td]$/.test(base) },
          { match: "d", syllables: 0 }
        ];

        for (const rule of pastTenseSuffixes) {
          if (!wordLower.endsWith(rule.match)) continue;

          const baseCandidate = wordLower.slice(0, -rule.match.length);
          const joinedBase = syllableList.join("").toLowerCase();

          if (baseCandidate !== joinedBase) continue;

          if (rule.replaceY && joinedBase.endsWith("y")) {
            syllableList[syllableList.length - 1] = syllableList.at(-1).slice(0, -1) + rule.match;
            console.log(`[ADJUST] Applied past-tense suffix '${rule.match}' to base.`);
            break;
          }

          if (!rule.test || rule.test(baseCandidate)) {
            if (rule.syllables > 0) {
              syllableList.push(rule.match);
              syllableCount += rule.syllables;
            } else {
              syllableList[syllableList.length - 1] += rule.match;
            }
            break;
          }
        }
      }
    }

    // --- Naive Fallback Based on MW Pronunciation Field ---
    const fallbackEntry = mwData.find(entry => entry?.hwi?.hw && entry?.hwi?.prs?.[0]?.mw);
    if (fallbackEntry) {
      const fallbackWordForm = fallbackEntry.hwi?.hw?.replace(/\*/g, "").toLowerCase();
      const phonemeSyllables = Math.max(...fallbackEntry.hwi.prs.map(p => (p.mw.match(/-/g) || []).length + 1));
      if (fallbackWordForm !== wordLower) {
        console.log(`[FALLBACK] Skipping fallback: MW pronunciation belongs to '${fallbackWordForm}', not '${wordLower}'.`);
      } else if (!state.syllableOverrideUsed && syllableCount !== phonemeSyllables) {
        console.log("[FALLBACK] Attempting naive estimation via MW pronunciation...");
        const syllableEstimate = Math.max(...fallbackEntry.hwi.prs.map(p => (p.mw.match(/-/g) || []).length + 1));
        console.log("[FALLBACK] Estimated syllable count from MW pronunciation:", syllableEstimate);
 
        const chunkSize = Math.ceil(fallbackWordForm.length / syllableEstimate);
        const chunks = [];
        let cursor = 0;
        for (let i = 0; i < syllableEstimate; i++) {
          const remaining = fallbackWordForm.length - cursor;
          const size = Math.ceil(remaining / (syllableEstimate - i));
          chunks.push(fallbackWordForm.slice(cursor, cursor + size));
          console.log(`[FALLBACK] Chunk ${i + 1}:`, fallbackWordForm.slice(cursor, cursor + size));
          cursor += size;
        }
 
        console.log("[FALLBACK] Final chunked syllableList:", chunks);
        syllableList = chunks;
        syllableCount = syllableList.length;
        console.log("[FALLBACK] Overriding previous syllable data based on MW pronunciation.");
      }
    }

    if (syllableCount === 0) {
      return errorResponse('we couldn’t figure out the syllables for that word. try a simpler one?', 400);
    }

    // --- Datamuse Frequency Lookup ---
    const datamuseUrl = `https://api.datamuse.com/words?sp=${encodeURIComponent(word)}&md=f`;
    const datamuseRes = await fetch(datamuseUrl);

    if (!datamuseRes.ok) {
      return errorResponse('couldn’t get scoring info for that word. want to try again?', 500);
    }

    const datamuseData = await datamuseRes.json();
    let frequency = 0;

    if (datamuseData.length > 0 && datamuseData[0].tags) {
      const freqTag = datamuseData[0].tags.find(tag => tag.startsWith("f:"));
      if (freqTag) {
        frequency = parseFloat(freqTag.replace("f:", ""));
      }
    }

    console.log(`[INFO] Frequency retrieved: ${frequency}`);

    if (frequency === 0) {
      return errorResponse('This word is so rare, we couldn’t score it. Try something else.', 400);
    }

    // --- Always Extract All Syllable Parses ---
    const parseSourceEntry = mwData.find(entry => entry?.hwi?.hw && entry?.hwi?.prs?.length > 0);
    let syllableParses = extractSyllableParses(wordLower, parseSourceEntry?.hwi?.prs || []);
    
    // Include hw-based parse if available and not already in list
    if (syllableList.length > 0) {
      const hwParseKey = syllableList.join("-");
      const alreadyIncluded = syllableParses.some(p => p.syllables.join("-") === hwParseKey);
      if (!alreadyIncluded) {
        syllableParses.unshift({
          count: syllableList.length,
          syllables: syllableList
        });
      }
    }
    // --- Final Response Assembly ---
    const responseBody = {
      isValid: true,
      word,
      frequency,
      syllables: syllableCount,
      syllableList,
      baseWordUsed,
      syllableParses
    };

    console.log("[SUCCESS] Word validated and processed successfully.");
    console.log("[RESPONSE] Final response body:");
    console.log(JSON.stringify(responseBody, null, 2));
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(responseBody)
    };
  } catch (err) {
    console.error('Lambda function error:', err);
    console.error("[RESPONSE] Returning fallback error response to frontend:");
    console.error(JSON.stringify({ isValid: false, error: 'Internal server error' }, null, 2));
    return errorResponse('something went wrong — mind giving it another shot?', 500);
  }
}

// --- Helper: Extract Syllable Parses ---
function extractSyllableParses(word, mwPronunciations) {
  if (!Array.isArray(mwPronunciations)) return [];

  const parses = mwPronunciations.map(p => {
    const raw = p.mw;
    if (!raw) return null;

    const cleaned = raw.replace(/\(.*?\)/g, ""); // remove optional syllables like (-ə)
    const count = (cleaned.match(/-/g) || []).length + 1;

    const chunks = [];
    let cursor = 0;
    for (let i = 0; i < count; i++) {
      const remaining = word.length - cursor;
      const size = Math.ceil(remaining / (count - i));
      chunks.push(word.slice(cursor, cursor + size));
      cursor += size;
    }

    return {
      count,
      syllables: chunks
    };
  }).filter(Boolean);

  const seen = new Set();
  return parses.filter(p => {
    const key = p.syllables.join("-");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// === Helper: Override with Phoneme Mismatch ===
function overrideWithPhonemeMismatch(originalWord, mwPronunciation, currentSyllables, state) {
  const phonemeSyllables = Array.isArray(mwPronunciation)
    ? Math.max(...mwPronunciation.map(p => (p.mw?.match(/-/g) || []).length + 1))
    : (mwPronunciation?.match(/-/g) || []).length + 1;
  if (
    phonemeSyllables > 0 &&
    currentSyllables.length < phonemeSyllables &&
    !state.syllableOverrideUsed
  ) {
    state.syllableOverrideUsed = true;
    console.log("[FALLBACK] Syllable mismatch detected. Rebuilding from MW pronunciation...");
    const chunkSize = Math.ceil(originalWord.length / phonemeSyllables);
    const chunks = [];
    let cursor = 0;
    for (let i = 0; i < phonemeSyllables; i++) {
      const remaining = originalWord.length - cursor;
      const size = Math.ceil(remaining / (phonemeSyllables - i));
      chunks.push(originalWord.slice(cursor, cursor + size));
      cursor += size;
    }
    console.log("[FALLBACK] Adjusted syllableList:", chunks);
    return chunks;
  }
  return currentSyllables;
}

// === Helper: Match Plural Run-on ===
function matchPluralRunOn(wordLower, runonList) {
  for (const runon of runonList || []) {
    const rootForms = [runon.ure, ...(runon.vrs?.map(v => v.va) || [])]
      .filter(Boolean)
      .map(f => f.toLowerCase().replace(/\*/g, ""));

    for (const root of rootForms) {
      if (wordLower === root) return { runon, suffix: "" };
      if (wordLower === root + "s") return { runon, suffix: "s" };
      if (wordLower === root + "es") return { runon, suffix: "es" };
      if (wordLower === root.replace(/y$/, "ies")) return { runon, suffix: "ies", replacedY: true };
    }
  }
  return null;
}

// === Helper: Error Response ===
function errorResponse(message, statusCode) {
  console.warn("[RESPONSE] Returning error response to frontend:");
  console.warn(JSON.stringify({ isValid: false, error: message }, null, 2));
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      isValid: false,
      error: message
    })
  };
}